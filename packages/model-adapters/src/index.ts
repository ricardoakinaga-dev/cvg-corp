import { createHash } from "node:crypto";
import type { DataClass } from "@cvg/contracts";
import {
  ModelProviderError,
  type ModelCompleteOptions,
  type ModelFinishReason,
  type ModelProvider,
  type ModelProviderCapabilities,
  type ModelProviderDataPolicy,
  type ModelProviderHealth,
  type ModelReply,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
  type ModelUsage
} from "@cvg/model-runtime";

/**
 * CVG-owned model adapters.  Adapters only map schemas, transport, streaming,
 * tool calls, usage, finish reason, errors, timeout and cancellation.  They
 * carry no business rules.
 */

export const MODEL_ADAPTERS_VERSION = "model-adapters/1.0.0";

export const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 4_096;
export const DEFAULT_MODEL_RESPONSE_BODY_BYTES = 1 * 1024 * 1024;
export const MAX_MODEL_RESPONSE_BODY_BYTES = 4 * 1024 * 1024;

const DEFAULT_CAPABILITIES: ModelProviderCapabilities = {
  toolCalling: false,
  structuredOutput: false,
  streaming: false,
  reasoning: false,
  vision: false,
  contextWindow: 32_768,
  maxOutput: DEFAULT_MODEL_MAX_OUTPUT_TOKENS
};

export interface ModelOutputLimits {
  readonly maxOutputTokens: number;
  readonly maxResponseBodyBytes: number;
}

/** Deterministic provider for CI, evals and local development. */
export type MockModelStep = ModelResponse | ((request: ModelRequest) => ModelResponse);

export interface MockModelProviderOptions {
  script?: readonly MockModelStep[];
  capabilities?: Partial<ModelProviderCapabilities>;
  dataPolicy?: Partial<ModelProviderDataPolicy>;
  /** When true, health reports UNAVAILABLE and complete throws. */
  unavailable?: boolean;
  latencyMs?: number | ((request: ModelRequest) => number);
  clock?: { now(): number };
  sleep?: (ms: number) => Promise<void>;
  maxOutputTokens?: number;
  maxResponseBodyBytes?: number;
}

export class MockModelProvider implements ModelProvider {
  readonly providerId = "mock-model";
  private index = 0;

  constructor(private readonly options: MockModelProviderOptions = {}) {}

  async health(): Promise<ModelProviderHealth> {
    if (this.options.unavailable) return { status: "UNAVAILABLE", checkedAt: this.iso(), reason: "MOCK_UNAVAILABLE", latencyMs: null };
    return { status: "READY", checkedAt: this.iso(), reason: null, latencyMs: 0 };
  }

  capabilities(): ModelProviderCapabilities {
    const configured = { ...DEFAULT_CAPABILITIES, toolCalling: true, structuredOutput: true, ...(this.options.capabilities ?? {}) };
    return { ...configured, maxOutput: Math.min(configured.maxOutput, modelOutputLimits(this.options).maxOutputTokens) };
  }

  dataPolicy(): ModelProviderDataPolicy {
    return { allowedDataClasses: ["D0", "D1", "D2", "D3"], region: "local", retention: "SESSION", training: "NONE", ...(this.options.dataPolicy ?? {}) };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (this.options.unavailable) throw new ModelProviderError("MODEL_UNAVAILABLE", "mock provider is unavailable", this.providerId);
    const limits = modelOutputLimits(this.options);
    assertModelRequestWithinLimits(request, limits);
    const latency = typeof this.options.latencyMs === "function" ? this.options.latencyMs(request) : (this.options.latencyMs ?? 0);
    if (latency > 0) await (this.options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(latency);
    const step = this.options.script?.length ? this.options.script[Math.min(this.index, this.options.script.length - 1)] : undefined;
    this.index += 1;
    const result = step === undefined
      ? this.response({ kind: "MESSAGE", content: `[mock] ${request.purpose}` }, request, { inputTokens: estimateRequestTokens(request), outputTokens: 8, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC", pricingRevision: "local-no-charge-v1" })
      : typeof step === "function" ? step(request) : step;
    return validateModelResponse(result, this.providerId, limits);
  }

  cancel(): boolean {
    return false;
  }

  private response(reply: ModelReply, _request: ModelRequest, usage: ModelUsage): ModelResponse {
    return {
      reply,
      usage,
      providerId: this.providerId,
      model: "mock-1",
      responseDigest: createHash("sha256").update(JSON.stringify(reply)).digest("hex"),
      finishReason: reply.kind === "TOOL_CALL" ? "tool_calls" : "stop",
      providerRequestId: `mock-${this.index}`,
      retryable: false
    };
  }

  private iso(): string {
    return new Date(this.options.clock ? this.options.clock.now() : Date.now()).toISOString();
  }
}

export interface ModelPricing {
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
  currency: string;
  revision: string;
}

export interface OpenAiCompatibleProviderConfig {
  providerId: string;
  baseUrl: string;
  model: string;
  /** Optional operator-supplied pricing; without it cost stays explicitly unknown. */
  pricing?: ModelPricing | null;
  /** Resolved per call from the SecretProvider; never stored on the provider object. */
  apiKeyResolver: () => string | null | Promise<string | null>;
  capabilities?: Partial<ModelProviderCapabilities>;
  dataPolicy: ModelProviderDataPolicy;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
  clock?: { now(): number };
  maxOutputTokens?: number;
  maxResponseBodyBytes?: number;
}

interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

interface WireResponseBody {
  id?: string;
  model?: string;
  choices?: { message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface WireStreamChunk {
  id?: string;
  model?: string;
  choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * OpenAI-compatible chat-completions adapter.  Used by both the DeepSeek
 * provider and the local endpoint provider; only configuration differs.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  private readonly controllers = new Map<string, AbortController>();
  private readonly limits: ModelOutputLimits;

  constructor(readonly providerId: string, private readonly config: OpenAiCompatibleProviderConfig) {
    if (!/^https?:\/\//.test(config.baseUrl)) throw new Error("provider baseUrl must be http(s)");
    if (config.baseUrl.startsWith("http:") && !config.allowInsecureHttp) throw new Error("insecure provider baseUrl requires explicit allowInsecureHttp");
    this.limits = modelOutputLimits(config);
  }

  async health(signal?: AbortSignal): Promise<ModelProviderHealth> {
    const started = this.now();
    const key = await this.config.apiKeyResolver();
    if (!key) return { status: "UNAVAILABLE", checkedAt: this.iso(), reason: "CREDENTIAL_UNAVAILABLE", latencyMs: null };
    try {
      const response = await this.doFetch(`${this.config.baseUrl}/models`, { method: "GET", headers: this.headers(key) }, signal);
      if (!response.ok) return { status: response.status === 401 || response.status === 403 ? "DISABLED" : "DEGRADED", checkedAt: this.iso(), reason: `HTTP_${response.status}`, latencyMs: this.now() - started };
      return { status: "READY", checkedAt: this.iso(), reason: null, latencyMs: this.now() - started };
    } catch {
      return { status: "UNAVAILABLE", checkedAt: this.iso(), reason: "PROVIDER_UNREACHABLE", latencyMs: this.now() - started };
    }
  }

  capabilities(): ModelProviderCapabilities {
    const configured = { ...DEFAULT_CAPABILITIES, streaming: true, ...(this.config.capabilities ?? {}) };
    return { ...configured, maxOutput: Math.min(configured.maxOutput, this.limits.maxOutputTokens) };
  }

  dataPolicy(): ModelProviderDataPolicy {
    return this.config.dataPolicy;
  }

  async complete(request: ModelRequest, options: ModelCompleteOptions = {}): Promise<ModelResponse> {
    assertModelRequestWithinLimits(request, this.limits);
    const requestId = options.requestId ?? `req-${this.now()}`;
    const key = await this.config.apiKeyResolver();
    if (!key) throw new ModelProviderError("MODEL_DEPENDENCY_UNAVAILABLE", "provider credential is unavailable", this.providerId);
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(new Error("PROVIDER_TIMEOUT")), timeoutMs);
    const onAbort = () => controller.abort(new Error("CALLER_ABORTED"));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const body = this.serialize(request);
      const response = await this.doFetch(`${this.config.baseUrl}/chat/completions`, { method: "POST", headers: { ...this.headers(key), "content-type": "application/json" }, body: JSON.stringify(body) }, controller.signal);
      const text = await readBoundedResponseText(response, this.limits.maxResponseBodyBytes);
      if (!response.ok) throw this.errorFromStatus(response.status, text);
      let parsed: WireResponseBody;
      try {
        parsed = parseWireResponseBody(JSON.parse(text) as unknown, this.providerId);
      } catch {
        throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider returned malformed JSON", this.providerId, { status: response.status });
      }
      return validateModelResponse(this.mapResponse(request, parsed, text), this.providerId, this.limits);
    } catch (error) {
      throw this.normalizeError(error, options.signal);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      this.controllers.delete(requestId);
    }
  }

  async *stream(request: ModelRequest, options: ModelCompleteOptions = {}): AsyncIterable<ModelStreamEvent> {
    assertModelRequestWithinLimits(request, this.limits);
    const requestId = options.requestId ?? `req-${this.now()}`;
    const key = await this.config.apiKeyResolver();
    if (!key) {
      yield { type: "error", code: "MODEL_DEPENDENCY_UNAVAILABLE", message: "provider credential is unavailable", retryable: false };
      return;
    }
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(new Error("PROVIDER_TIMEOUT")), timeoutMs);
    const onAbort = () => controller.abort(new Error("CALLER_ABORTED"));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await this.doFetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { ...this.headers(key), accept: "text/event-stream", "content-type": "application/json" },
        body: JSON.stringify(this.serialize(request, true))
      }, controller.signal);
      if (!response.ok) {
        const text = await readBoundedResponseText(response, this.limits.maxResponseBodyBytes);
        throw this.errorFromStatus(response.status, text);
      }
      if (!response.body) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider did not return a streaming body", this.providerId);
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
      const dataLines: string[] = [];
      let pending = "";
      let totalBytes = 0;
      let finishReason: ModelFinishReason = "stop";
      let outputTokens = 0;
      let providerUsage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
      let done = false;
      const processData = (data: string): WireStreamChunk | null => {
        if (data === "[DONE]") {
          done = true;
          return null;
        }
        return parseWireStreamChunk(JSON.parse(data) as unknown, this.providerId);
      };
      const rejectOutputBudget = async (): Promise<never> => {
        try {
          await reader?.cancel("requested output token budget exceeded");
        } catch {
          // Preserve the deterministic budget error when the transport is already closing.
        }
        throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream exceeded the requested output token budget", this.providerId, { maxOutputTokens: request.maxOutputTokens });
      };
      const accountOutput = async (text: string): Promise<void> => {
        if (!text) return;
        const nextOutputTokens = outputTokens + estimateTextTokens(text);
        if (nextOutputTokens > request.maxOutputTokens) await rejectOutputBudget();
        outputTokens = nextOutputTokens;
      };
      const consumeFrame = async (data: string): Promise<string[]> => {
        if (!data.trim()) return [];
        const chunk = processData(data);
        if (!chunk) return [];
        const deltas: string[] = [];
        if ((chunk.usage?.completion_tokens ?? 0) > request.maxOutputTokens) await rejectOutputBudget();
        providerUsage = chunk.usage ?? providerUsage;
        for (const choice of chunk.choices ?? []) {
          if (choice.finish_reason) finishReason = mapFinishReason(choice.finish_reason);
          for (const toolCall of choice.delta?.tool_calls ?? []) {
            const index = toolCall.index ?? 0;
            const current = toolCalls.get(index) ?? { id: toolCall.id ?? `call-${index + 1}`, name: "", arguments: "" };
            if (toolCall.id) current.id = toolCall.id;
            const nameDelta = toolCall.function?.name ?? "";
            const argumentsDelta = toolCall.function?.arguments ?? "";
            await accountOutput(nameDelta);
            await accountOutput(argumentsDelta);
            if (nameDelta) current.name += nameDelta;
            if (argumentsDelta) current.arguments += argumentsDelta;
            toolCalls.set(index, current);
          }
          const delta = choice.delta?.content ?? "";
          if (delta) {
            await accountOutput(delta);
            if (Buffer.byteLength(delta, "utf8") > this.limits.maxResponseBodyBytes) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream exceeded the configured output budget", this.providerId);
            deltas.push(delta);
          }
        }
        return deltas;
      };
      const emitFrame = async (): Promise<string[]> => {
        const deltas = await consumeFrame(dataLines.join("\n"));
        dataLines.length = 0;
        return deltas;
      };
      while (!done) {
        const next = await reader.read();
        if (next.done) break;
        totalBytes += next.value.byteLength;
        if (totalBytes > this.limits.maxResponseBodyBytes) {
          await reader.cancel("response body limit exceeded");
          throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream exceeded the configured body budget", this.providerId, { maxResponseBodyBytes: this.limits.maxResponseBodyBytes });
        }
        pending += decoder.decode(next.value, { stream: true });
        for (;;) {
          const newline = pending.indexOf("\n");
          if (newline < 0) break;
          const line = pending.slice(0, newline).replace(/\r$/, "");
          pending = pending.slice(newline + 1);
          if (line === "") {
            for (const delta of await emitFrame()) yield { type: "text-delta", delta };
            if (done) break;
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
      }
      pending += decoder.decode();
      if (pending.startsWith("data:")) dataLines.push(pending.slice(5).trimStart());
      if (dataLines.length > 0 && !done) for (const delta of await emitFrame()) yield { type: "text-delta", delta };
      for (const toolCall of toolCalls.values()) {
        let input: unknown;
        try {
          input = toolCall.arguments ? JSON.parse(toolCall.arguments) as unknown : {};
        } catch {
          throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider returned an invalid streamed tool-call payload", this.providerId);
        }
        yield { type: "tool-call", tool: toolCall.name || "unknown", input, callId: toolCall.id };
      }
      const finalProviderUsage = providerUsage as { prompt_tokens?: number; completion_tokens?: number } | null;
      const usage: ModelUsage = {
        inputTokens: finalProviderUsage?.prompt_tokens ?? estimateRequestTokens(request),
        outputTokens: finalProviderUsage?.completion_tokens ?? outputTokens,
        costMicros: finalProviderUsage && this.config.pricing ? Math.round((finalProviderUsage.prompt_tokens ?? 0) * this.config.pricing.inputMicrosPerToken + (finalProviderUsage.completion_tokens ?? outputTokens) * this.config.pricing.outputMicrosPerToken) : null,
        currency: this.config.pricing?.currency ?? null,
        source: finalProviderUsage ? "PROVIDER" : "UNAVAILABLE",
        pricingRevision: this.config.pricing?.revision ?? null
      };
      yield { type: "usage", usage };
      yield { type: "done", finishReason };
    } catch (error) {
      const normalized = this.normalizeError(error, options.signal);
      yield { type: "error", code: normalized.code, message: normalized.message, retryable: normalized.classification.retryable };
    } finally {
      reader?.releaseLock();
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      this.controllers.delete(requestId);
    }
  }

  cancel(requestId: string): boolean {
    const controller = this.controllers.get(requestId);
    if (!controller) return false;
    controller.abort(new Error("CANCELLED"));
    this.controllers.delete(requestId);
    return true;
  }

  private headers(key: string): Record<string, string> {
    return { authorization: `Bearer ${key}`, accept: "application/json" };
  }

  private serialize(request: ModelRequest, stream = false): Record<string, unknown> {
    const messages: WireMessage[] = [{ role: "system", content: request.systemInstructions }];
    for (const message of request.messages) {
      if (message.role === "tool") {
        messages.push({ role: "tool", content: message.content, tool_call_id: message.toolCallId ?? message.toolName ?? "tool", ...(message.toolName ? { name: message.toolName } : {}) });
      } else {
        messages.push({ role: message.role, content: message.content });
      }
    }
    return {
      model: this.config.model,
      messages,
      max_tokens: request.maxOutputTokens,
      stream,
      ...(request.temperature === null ? {} : { temperature: request.temperature }),
      ...(request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.inputSchema ?? { type: "object", additionalProperties: true } }
            }))
          }
        : {}),
      ...(request.responseFormat === "JSON_OBJECT" ? { response_format: { type: "json_object" } } : {})
    };
  }

  private mapResponse(request: ModelRequest, parsed: WireResponseBody, rawText: string): ModelResponse {
    const choice = parsed.choices?.[0];
    const message = choice?.message;
    const finishReason = mapFinishReason(choice?.finish_reason);
    const inputTokens = parsed.usage?.prompt_tokens ?? estimateRequestTokens(request);
    const outputTokens = parsed.usage?.completion_tokens ?? estimateTextTokens(message?.content ?? "");
    const pricing = this.config.pricing ?? null;
    const usage: ModelUsage = {
      inputTokens,
      outputTokens,
      costMicros: pricing ? Math.round(inputTokens * pricing.inputMicrosPerToken + outputTokens * pricing.outputMicrosPerToken) : null,
      currency: pricing ? pricing.currency : null,
      source: parsed.usage ? "PROVIDER" : "UNAVAILABLE",
      pricingRevision: pricing ? pricing.revision : null
    };
    const responseDigest = createHash("sha256").update(rawText).digest("hex");
    const toolCall = message?.tool_calls?.[0];
    if (toolCall?.function) {
      let input: unknown;
      try {
        input = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
      } catch {
        throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider returned an invalid tool-call payload", this.providerId, { tool: toolCall.function.name ?? null });
      }
      return { reply: { kind: "TOOL_CALL", tool: toolCall.function.name ?? "unknown", input, callId: toolCall.id ?? "call-1" }, usage, providerId: this.providerId, model: parsed.model ?? this.config.model, responseDigest, finishReason: "tool_calls", providerRequestId: parsed.id ?? null, retryable: false };
    }
    const content = message?.content ?? "";
    if (request.responseFormat === "JSON_OBJECT") {
      try {
        const value = JSON.parse(content) as unknown;
        return { reply: { kind: "STRUCTURED", value }, usage, providerId: this.providerId, model: parsed.model ?? this.config.model, responseDigest, finishReason, providerRequestId: parsed.id ?? null, retryable: false };
      } catch {
        throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider did not return the requested JSON object", this.providerId);
      }
    }
    return { reply: { kind: "MESSAGE", content }, usage, providerId: this.providerId, model: parsed.model ?? this.config.model, responseDigest, finishReason, providerRequestId: parsed.id ?? null, retryable: false };
  }

  private errorFromStatus(status: number, body: string): ModelProviderError {
    const detail = body.slice(0, 500);
    if (status === 401 || status === 403) return new ModelProviderError("MODEL_POLICY_DENIED", `provider rejected the credential (HTTP ${status})`, this.providerId, { status });
    if (status === 429) return new ModelProviderError("MODEL_RATE_LIMITED", "provider rate limited the request", this.providerId, { status });
    if (status === 400) {
      const contextTooLarge = /context|token|length/i.test(detail);
      return new ModelProviderError(contextTooLarge ? "MODEL_CONTEXT_TOO_LARGE" : "MODEL_BAD_REQUEST", `provider rejected the request (HTTP ${status})`, this.providerId, { status });
    }
    if (status >= 500) return new ModelProviderError("MODEL_UNAVAILABLE", `provider failed (HTTP ${status})`, this.providerId, { status });
    return new ModelProviderError("MODEL_UNKNOWN", `unexpected provider status ${status}`, this.providerId, { status });
  }

  private normalizeError(error: unknown, callerSignal?: AbortSignal): ModelProviderError {
    if (error instanceof ModelProviderError) return error;
    if (callerSignal?.aborted) return new ModelProviderError("MODEL_CANCELLED", "provider call was cancelled by the caller", this.providerId);
    if (error instanceof Error && (error.name === "AbortError" || /PROVIDER_TIMEOUT/.test(error.message))) return new ModelProviderError("MODEL_TIMEOUT", "provider call timed out", this.providerId);
    if (error instanceof Error && /CANCELLED/.test(error.message)) return new ModelProviderError("MODEL_CANCELLED", "provider call was cancelled", this.providerId);
    return new ModelProviderError("MODEL_DEPENDENCY_UNAVAILABLE", "provider transport failure", this.providerId);
  }

  private async doFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const fetchImpl = this.config.fetchImpl ?? fetch;
    return fetchImpl(url, { ...init, redirect: "error", ...(signal ? { signal } : {}) });
  }

  private now(): number {
    return this.config.clock ? this.config.clock.now() : Date.now();
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }
}

export interface DeepSeekProviderConfig {
  pricing?: ModelPricing | null;
  model?: string;
  baseUrl?: string;
  apiKeyResolver: () => string | null | Promise<string | null>;
  allowedDataClasses?: readonly DataClass[];
  region?: string | null;
  retention?: ModelProviderDataPolicy["retention"];
  training?: ModelProviderDataPolicy["training"];
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
  clock?: { now(): number };
  capabilities?: Partial<ModelProviderCapabilities>;
  maxOutputTokens?: number;
  maxResponseBodyBytes?: number;
}

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash-2026";

export function createDeepSeekModelProvider(config: DeepSeekProviderConfig): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider("deepseek", {
    providerId: "deepseek",
    baseUrl: config.baseUrl ?? "https://api.deepseek.com",
    model: config.model ?? DEEPSEEK_DEFAULT_MODEL,
    ...(config.pricing ? { pricing: config.pricing } : {}),
    apiKeyResolver: config.apiKeyResolver,
    capabilities: { toolCalling: true, structuredOutput: true, streaming: true, reasoning: true, ...(config.capabilities ?? {}) },
    dataPolicy: {
      allowedDataClasses: config.allowedDataClasses ?? [],
      region: config.region ?? null,
      retention: config.retention ?? "UNKNOWN",
      training: config.training ?? "UNKNOWN"
    },
    timeoutMs: config.timeoutMs ?? 30_000,
    ...(config.allowInsecureHttp !== undefined ? { allowInsecureHttp: config.allowInsecureHttp } : {}),
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.clock ? { clock: config.clock } : {}),
    ...(config.maxOutputTokens !== undefined ? { maxOutputTokens: config.maxOutputTokens } : {}),
    ...(config.maxResponseBodyBytes !== undefined ? { maxResponseBodyBytes: config.maxResponseBodyBytes } : {})
  });
}

export interface LocalProviderConfig {
  baseUrl: string;
  model: string;
  pricing?: ModelPricing | null;
  apiKeyResolver?: () => string | null | Promise<string | null>;
  allowedDataClasses?: readonly DataClass[];
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  fetchImpl?: typeof fetch;
  clock?: { now(): number };
  capabilities?: Partial<ModelProviderCapabilities>;
  maxOutputTokens?: number;
  maxResponseBodyBytes?: number;
}

/** Local/on-prem endpoint (OpenAI-compatible).  Proves the harness is not DeepSeek. */
export function createLocalModelProvider(config: LocalProviderConfig): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider("local", {
    providerId: "local",
    baseUrl: config.baseUrl,
    model: config.model,
    ...(config.pricing ? { pricing: config.pricing } : {}),
    apiKeyResolver: config.apiKeyResolver ?? (() => "local"),
    capabilities: { toolCalling: true, structuredOutput: true, streaming: true, ...(config.capabilities ?? {}) },
    dataPolicy: { allowedDataClasses: config.allowedDataClasses ?? ["D0", "D1", "D2", "D3", "D4"], region: "on-prem", retention: "NONE", training: "NONE" },
    timeoutMs: config.timeoutMs ?? 30_000,
    allowInsecureHttp: config.allowInsecureHttp ?? true,
    ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    ...(config.clock ? { clock: config.clock } : {}),
    ...(config.maxOutputTokens !== undefined ? { maxOutputTokens: config.maxOutputTokens } : {}),
    ...(config.maxResponseBodyBytes !== undefined ? { maxResponseBodyBytes: config.maxResponseBodyBytes } : {})
  });
}

function modelOutputLimits(config: { maxOutputTokens?: number; maxResponseBodyBytes?: number; capabilities?: Partial<ModelProviderCapabilities> }): ModelOutputLimits {
  const configuredOutput = boundedPositiveLimit(config.maxOutputTokens, DEFAULT_MODEL_MAX_OUTPUT_TOKENS, 1_000_000, "maxOutputTokens");
  const capabilityOutput = config.capabilities?.maxOutput === undefined
    ? configuredOutput
    : boundedPositiveLimit(config.capabilities.maxOutput, configuredOutput, 1_000_000, "capabilities.maxOutput");
  return {
    maxOutputTokens: Math.min(configuredOutput, capabilityOutput),
    maxResponseBodyBytes: boundedPositiveLimit(config.maxResponseBodyBytes, DEFAULT_MODEL_RESPONSE_BODY_BYTES, MAX_MODEL_RESPONSE_BODY_BYTES, "maxResponseBodyBytes")
  };
}

function boundedPositiveLimit(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) throw new RangeError(`${name} must be between 1 and ${maximum}`);
  return selected;
}

function assertModelRequestWithinLimits(request: ModelRequest, limits: ModelOutputLimits): void {
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > limits.maxOutputTokens) {
    throw new ModelProviderError("MODEL_BAD_REQUEST", "requested model output exceeds the configured budget", "model-adapter", { maxOutputTokens: limits.maxOutputTokens });
  }
}

async function readBoundedResponseText(response: Response, maxBodyBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isSafeInteger(parsedLength) && parsedLength > maxBodyBytes) {
      await response.body?.cancel("response body limit exceeded");
      throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response exceeded the configured body budget", "model-adapter", { maxResponseBodyBytes: maxBodyBytes });
    }
  }
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maxBodyBytes) {
          await reader.cancel("response body limit exceeded");
          throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response exceeded the configured body budget", "model-adapter", { maxResponseBodyBytes: maxBodyBytes });
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response exceeded the configured body budget", "model-adapter", { maxResponseBodyBytes: maxBodyBytes });
  return raw;
}

function parseWireResponseBody(value: unknown, providerId: string): WireResponseBody {
  if (!isRecord(value) || !Array.isArray(value.choices) || value.choices.length < 1 || value.choices.length > 16) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
  for (const choice of value.choices) {
    if (!isRecord(choice)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
    const message = choice.message;
    if (message !== undefined && (!isRecord(message) || (message.content !== undefined && message.content !== null && typeof message.content !== "string") || (message.reasoning_content !== undefined && message.reasoning_content !== null && typeof message.reasoning_content !== "string"))) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
    if (choice.finish_reason !== undefined && typeof choice.finish_reason !== "string") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
    if (isRecord(message) && message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 16) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
      for (const toolCall of message.tool_calls) {
        if (!isRecord(toolCall) || (toolCall.id !== undefined && typeof toolCall.id !== "string") || !isRecord(toolCall.function) || (toolCall.function.name !== undefined && typeof toolCall.function.name !== "string") || (toolCall.function.arguments !== undefined && typeof toolCall.function.arguments !== "string")) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
      }
    }
  }
  if (value.id !== undefined && typeof value.id !== "string") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
  if (value.model !== undefined && typeof value.model !== "string") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
  if (value.usage !== undefined) {
    if (!isRecord(value.usage)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
    for (const key of ["prompt_tokens", "completion_tokens"] as const) {
      const tokenCount = value.usage[key];
      if (tokenCount !== undefined && (typeof tokenCount !== "number" || !Number.isSafeInteger(tokenCount) || tokenCount < 0)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
    }
  }
  return value as WireResponseBody;
}

function parseWireStreamChunk(value: unknown, providerId: string): WireStreamChunk {
  if (!isRecord(value) || (value.choices !== undefined && !Array.isArray(value.choices)) || (value.choices !== undefined && value.choices.length > 16)) {
    throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
  }
  for (const choice of (value.choices ?? []) as unknown[]) {
    if (!isRecord(choice)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
    if (choice.finish_reason !== undefined && choice.finish_reason !== null && typeof choice.finish_reason !== "string") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
    if (choice.delta !== undefined) {
      if (!isRecord(choice.delta)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
      if (choice.delta.content !== undefined && choice.delta.content !== null && typeof choice.delta.content !== "string") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
      if (choice.delta.tool_calls !== undefined) {
        if (!Array.isArray(choice.delta.tool_calls) || choice.delta.tool_calls.length > 16) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
        for (const toolCall of choice.delta.tool_calls) {
          if (!isRecord(toolCall) || (toolCall.index !== undefined && (typeof toolCall.index !== "number" || !Number.isSafeInteger(toolCall.index) || toolCall.index < 0 || toolCall.index > 16)) || (toolCall.id !== undefined && typeof toolCall.id !== "string")) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
          if (toolCall.function !== undefined) {
            if (!isRecord(toolCall.function) || (toolCall.function.name !== undefined && typeof toolCall.function.name !== "string") || (toolCall.function.arguments !== undefined && typeof toolCall.function.arguments !== "string")) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
          }
        }
      }
    }
  }
  if (value.id !== undefined && typeof value.id !== "string") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
  if (value.model !== undefined && typeof value.model !== "string") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
  if (value.usage !== undefined) {
    if (!isRecord(value.usage)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
    for (const key of ["prompt_tokens", "completion_tokens"] as const) {
      const tokenCount = value.usage[key];
      if (tokenCount !== undefined && (typeof tokenCount !== "number" || !Number.isSafeInteger(tokenCount) || tokenCount < 0)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider stream chunk failed schema validation", providerId);
    }
  }
  return value as WireStreamChunk;
}

function validateModelResponse(response: ModelResponse, providerId: string, limits: ModelOutputLimits): ModelResponse {
  if (!isRecord(response) || response.providerId !== providerId || typeof response.model !== "string" || response.model.length < 1 || response.model.length > 200 || !/^[a-f0-9]{64}$/.test(response.responseDigest) || !["stop", "length", "tool_calls", "content_filter", "error"].includes(response.finishReason) || (response.providerRequestId !== null && (typeof response.providerRequestId !== "string" || response.providerRequestId.length > 200)) || typeof response.retryable !== "boolean") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
  const usage = response.usage;
  if (!isRecord(usage) || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0 || usage.outputTokens > limits.maxOutputTokens || (usage.costMicros !== null && (!Number.isSafeInteger(usage.costMicros) || usage.costMicros < 0)) || (usage.currency !== null && (typeof usage.currency !== "string" || usage.currency.length > 16)) || !["PROVIDER", "LOCAL_SYNTHETIC", "UNAVAILABLE"].includes(usage.source)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
  const reply = response.reply;
  if (!isRecord(reply) || typeof reply.kind !== "string") throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
  if (reply.kind === "MESSAGE") {
    if (typeof reply.content !== "string" || Buffer.byteLength(reply.content, "utf8") > limits.maxResponseBodyBytes) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response exceeded the configured output budget", providerId, { maxResponseBodyBytes: limits.maxResponseBodyBytes });
  } else if (reply.kind === "TOOL_CALL") {
    if (typeof reply.tool !== "string" || reply.tool.length < 1 || reply.tool.length > 200 || typeof reply.callId !== "string" || reply.callId.length < 1 || reply.callId.length > 200 || !boundedModelValue(reply.input, limits.maxResponseBodyBytes)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider tool-call response failed schema validation", providerId);
  } else if (reply.kind === "STRUCTURED") {
    if (!boundedModelValue(reply.value, limits.maxResponseBodyBytes)) throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider structured response exceeded the configured output budget", providerId);
  } else {
    throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider response failed schema validation", providerId);
  }
  return response;
}

function boundedModelValue(value: unknown, maxBytes: number): boolean {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (current: unknown, depth: number): boolean => {
    if (current === null || typeof current === "boolean") return true;
    if (typeof current === "number") return Number.isFinite(current);
    if (typeof current === "string") return current.length <= 1_000_000;
    if (typeof current !== "object" || seen.has(current) || depth > 16 || nodes >= 4_096) return false;
    nodes += 1;
    seen.add(current);
    try {
      if (Array.isArray(current)) return current.length <= 4_096 && current.every((item) => visit(item, depth + 1));
      return Object.keys(current).length <= 1_024 && Object.values(current).every((item) => visit(item, depth + 1));
    } finally {
      seen.delete(current);
    }
  };
  if (!visit(value, 0)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

function mapFinishReason(reason: string | undefined): ModelFinishReason {
  if (reason === "length") return "length";
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "content_filter") return "content_filter";
  if (reason === "error") return "error";
  return "stop";
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateRequestTokens(request: ModelRequest): number {
  const messages = request.messages.reduce((total, message) => total + estimateTextTokens(message.content), 0);
  return messages + estimateTextTokens(request.systemInstructions) + request.tools.length * 32;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
