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
  type ModelMessage,
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

const DEFAULT_CAPABILITIES: ModelProviderCapabilities = {
  toolCalling: false,
  structuredOutput: false,
  streaming: false,
  reasoning: false,
  vision: false,
  contextWindow: 32_768,
  maxOutput: 4_096
};

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
    return { ...DEFAULT_CAPABILITIES, toolCalling: true, structuredOutput: true, ...(this.options.capabilities ?? {}) };
  }

  dataPolicy(): ModelProviderDataPolicy {
    return { allowedDataClasses: ["D0", "D1", "D2", "D3"], region: "local", retention: "SESSION", training: "NONE", ...(this.options.dataPolicy ?? {}) };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    if (this.options.unavailable) throw new ModelProviderError("MODEL_UNAVAILABLE", "mock provider is unavailable", this.providerId);
    const latency = typeof this.options.latencyMs === "function" ? this.options.latencyMs(request) : (this.options.latencyMs ?? 0);
    if (latency > 0) await (this.options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(latency);
    const step = this.options.script?.length ? this.options.script[Math.min(this.index, this.options.script.length - 1)] : undefined;
    this.index += 1;
    if (step === undefined) {
      return this.response({ kind: "MESSAGE", content: `[mock] ${request.purpose}` }, request, { inputTokens: estimateRequestTokens(request), outputTokens: 8, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC", pricingRevision: "local-no-charge-v1" });
    }
    return typeof step === "function" ? step(request) : step;
  }

  cancel(): boolean {
    return false;
  }

  private response(reply: ModelReply, request: ModelRequest, usage: ModelUsage): ModelResponse {
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

/**
 * OpenAI-compatible chat-completions adapter.  Used by both the DeepSeek
 * provider and the local endpoint provider; only configuration differs.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  private readonly controllers = new Map<string, AbortController>();

  constructor(readonly providerId: string, private readonly config: OpenAiCompatibleProviderConfig) {
    if (!/^https?:\/\//.test(config.baseUrl)) throw new Error("provider baseUrl must be http(s)");
    if (config.baseUrl.startsWith("http:") && !config.allowInsecureHttp) throw new Error("insecure provider baseUrl requires explicit allowInsecureHttp");
  }

  async health(signal?: AbortSignal): Promise<ModelProviderHealth> {
    const started = this.now();
    const key = await this.config.apiKeyResolver();
    if (!key) return { status: "UNAVAILABLE", checkedAt: this.iso(), reason: "CREDENTIAL_UNAVAILABLE", latencyMs: null };
    try {
      const response = await this.doFetch(`${this.config.baseUrl}/models`, { method: "GET", headers: this.headers(key) }, signal);
      if (!response.ok) return { status: response.status === 401 || response.status === 403 ? "DISABLED" : "DEGRADED", checkedAt: this.iso(), reason: `HTTP_${response.status}`, latencyMs: this.now() - started };
      return { status: "READY", checkedAt: this.iso(), reason: null, latencyMs: this.now() - started };
    } catch (error) {
      return { status: "UNAVAILABLE", checkedAt: this.iso(), reason: error instanceof Error ? error.message : "PROVIDER_UNREACHABLE", latencyMs: this.now() - started };
    }
  }

  capabilities(): ModelProviderCapabilities {
    return { ...DEFAULT_CAPABILITIES, streaming: true, ...(this.config.capabilities ?? {}) };
  }

  dataPolicy(): ModelProviderDataPolicy {
    return this.config.dataPolicy;
  }

  async complete(request: ModelRequest, options: ModelCompleteOptions = {}): Promise<ModelResponse> {
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
      const text = await response.text();
      if (!response.ok) throw this.errorFromStatus(response.status, text);
      let parsed: WireResponseBody;
      try {
        parsed = JSON.parse(text) as WireResponseBody;
      } catch {
        throw new ModelProviderError("MODEL_INVALID_RESPONSE", "provider returned malformed JSON", this.providerId, { status: response.status });
      }
      return this.mapResponse(request, parsed, text);
    } catch (error) {
      throw this.normalizeError(error, options.signal);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      this.controllers.delete(requestId);
    }
  }

  async *stream(request: ModelRequest, options: ModelCompleteOptions = {}): AsyncIterable<ModelStreamEvent> {
    const response = await this.complete({ ...request }, { ...options });
    if (response.reply.kind === "MESSAGE") yield { type: "text-delta", delta: response.reply.content };
    if (response.reply.kind === "TOOL_CALL") yield { type: "tool-call", tool: response.reply.tool, input: response.reply.input, callId: response.reply.callId };
    yield { type: "usage", usage: response.usage };
    yield { type: "done", finishReason: response.finishReason };
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

  private serialize(request: ModelRequest): Record<string, unknown> {
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
      stream: false,
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
    return new ModelProviderError("MODEL_DEPENDENCY_UNAVAILABLE", error instanceof Error ? error.message : "provider transport failure", this.providerId);
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
    ...(config.clock ? { clock: config.clock } : {})
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
    ...(config.clock ? { clock: config.clock } : {})
  });
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
