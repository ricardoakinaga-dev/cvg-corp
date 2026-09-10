import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  DeepSeekBridge,
  DeepSeekBridgeError,
  DEEPSEEK_BRIDGE_SCHEMA_VERSION,
  healthToWire,
  parseBridgeApprovalInput,
  parseBridgeContext,
  parseBridgeOpaqueId,
  parseBridgeSessionInput,
  parseBridgeTurnInput,
  toErrorEnvelope,
  createAcpNativeHarnessPortFromEnvironment,
  type DeepSeekBridgeConfig,
  type DeepSeekNativeHarnessPort
} from "@cvg/deepseek-bridge";
import type { CvgContext, OpaqueId } from "@cvg/contracts";
import { configuredSecretProvider } from "@cvg/integrations";
import { createOpenTelemetryRuntime, OpsTelemetry } from "@cvg/ops";

const correlationPattern = /^[A-Za-z0-9._-]{1,80}$/;
const defaultMaxBodyBytes = 1_048_576;
type SecretProviderKind = Parameters<typeof configuredSecretProvider>[0];

export interface DeepSeekBridgeServerOptions {
  bridge?: DeepSeekBridge;
  telemetry?: OpsTelemetry;
  nativePort?: DeepSeekNativeHarnessPort;
  host?: string;
  port?: number;
  maxBodyBytes?: number;
  requireBearerToken?: boolean;
  resolveBearerToken?: () => Promise<string | null>;
  requireContextSignature?: boolean;
  resolveContextSigningSecret?: () => Promise<string | null>;
}

export interface DeepSeekBridgeServer {
  server: Server;
  bridge: DeepSeekBridge;
  telemetry: OpsTelemetry;
}

function environmentValue(environment: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = environment[key]?.trim();
  return value || fallback;
}

function environmentNumber(environment: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = environment[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 120_000 ? parsed : fallback;
}

function configuredToolNames(environment: NodeJS.ProcessEnv): string[] {
  return [...new Set((environment.CVG_DEEPSEEK_EXPECTED_TOOL_NAMES ?? "").split(",").map((value) => value.trim()).filter(Boolean))].sort();
}

function secretResolverFromEnvironment(environment: NodeJS.ProcessEnv, reference: string | undefined): (() => Promise<string | null>) | undefined {
  const normalizedReference = reference?.trim();
  const kind = environment.CVG_SECRET_PROVIDER;
  if (!normalizedReference || !kind || kind === "none") return undefined;
  const supported: readonly SecretProviderKind[] = ["env", "file", "docker", "vault", "aws", "gcp", "azure", "kubernetes"];
  if (!(supported as readonly string[]).includes(kind)) return undefined;
  const provider = configuredSecretProvider(kind as SecretProviderKind, environment, environment.CVG_SECRET_DIR);
  if (!provider?.resolve) return undefined;
  return async () => {
    try {
      return await provider.resolve?.(normalizedReference) ?? null;
    } catch {
      return null;
    }
  };
}

function bearerTokenResolverFromEnvironment(environment: NodeJS.ProcessEnv): (() => Promise<string | null>) | undefined {
  return secretResolverFromEnvironment(environment, environment.CVG_DEEPSEEK_BEARER_TOKEN_REF);
}

function contextSigningSecretResolverFromEnvironment(environment: NodeJS.ProcessEnv): (() => Promise<string | null>) | undefined {
  return secretResolverFromEnvironment(environment, environment.CVG_DEEPSEEK_CONTEXT_SIGNING_SECRET_REF);
}

export function bridgeConfigFromEnvironment(environment: NodeJS.ProcessEnv = process.env, nativePort?: DeepSeekNativeHarnessPort): DeepSeekBridgeConfig {
  const config: DeepSeekBridgeConfig = {
    expectedEngineCommit: environmentValue(environment, "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT", "unconfigured"),
    expectedManifestVersion: environmentValue(environment, "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION", "unconfigured"),
    expectedToolNames: configuredToolNames(environment),
    requestTimeoutMs: environmentNumber(environment, "CVG_DEEPSEEK_BRIDGE_TIMEOUT_MS", 5_000)
  };
  if (nativePort) return { ...config, nativePort };
  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function correlationFromRequest(request: IncomingMessage): string {
  const value = requestHeader(request, "x-cvg-correlation-id");
  return value && correlationPattern.test(value) ? value : randomUUID();
}

function contextHeader(request: IncomingMessage): unknown {
  const encoded = requestHeader(request, "x-cvg-context");
  if (!encoded || encoded.length > 8_192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return isRecord(decoded) && "context" in decoded ? decoded.context : decoded;
  } catch {
    return undefined;
  }
}

function jsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) throw new DeepSeekBridgeError("INVALID_REQUEST", "Request body excede o limite do bridge.");
  return new Promise((resolveBody, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      total += Buffer.byteLength(chunk, "utf8");
      if (total > maxBodyBytes) {
        reject(new DeepSeekBridgeError("INVALID_REQUEST", "Request body excede o limite do bridge."));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk, "utf8"));
    });
    request.on("aborted", () => reject(new DeepSeekBridgeError("CANCELLED", "Request cancelado pelo cliente.")));
    request.on("error", (error) => reject(error));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolveBody(undefined);
      try { resolveBody(JSON.parse(raw)); } catch { reject(new DeepSeekBridgeError("INVALID_REQUEST", "Request body não é JSON válido.")); }
    });
  });
}

function bodyContext(body: unknown, request: IncomingMessage): { context: CvgContext; correlationId: string } {
  const raw = isRecord(body) && body.context !== undefined ? body.context : contextHeader(request);
  const context = parseBridgeContext(raw);
  const headerCorrelation = requestHeader(request, "x-cvg-correlation-id");
  const correlationId = headerCorrelation && correlationPattern.test(headerCorrelation) ? headerCorrelation : context.correlationId;
  if (context.correlationId !== correlationId) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "Correlation ID do header e do contexto diverge.");
  return { context, correlationId };
}

function contextSignaturePayload(context: CvgContext): string {
  return JSON.stringify({ context, correlationId: context.correlationId });
}

async function verifyContextSignature(
  context: CvgContext,
  request: IncomingMessage,
  required: boolean,
  resolveSecret: (() => Promise<string | null>) | undefined
): Promise<void> {
  if (!required) return;
  const signature = requestHeader(request, "x-cvg-context-signature")?.match(/^sha256=([a-f0-9]{64})$/i)?.[1];
  let secret: string | null = null;
  try { secret = await resolveSecret?.() ?? null; } catch { secret = null; }
  const expected = secret?.trim() ? createHmac("sha256", secret.trim()).update(contextSignaturePayload(context), "utf8").digest("hex") : null;
  const receivedBytes = signature ? Buffer.from(signature, "hex") : null;
  const expectedBytes = expected ? Buffer.from(expected, "hex") : null;
  const matches = Boolean(receivedBytes && expectedBytes && receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes));
  if (!matches) throw new DeepSeekBridgeError("UNAUTHENTICATED", "Assinatura do contexto CVG ausente ou inválida.");
}

function pathId(pathname: string, pattern: RegExp, label: string): OpaqueId {
  const match = pathname.match(pattern);
  if (!match?.[1]) throw new DeepSeekBridgeError("INVALID_REQUEST", `${label} ausente ou inválido.`);
  return parseBridgeOpaqueId(decodeURIComponent(match[1]), label);
}

function writeJson(response: ServerResponse, statusCode: number, correlationId: string, payload: unknown): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-cvg-correlation-id", correlationId);
  response.end(JSON.stringify(payload));
}

function statusForError(error: unknown): number {
  if (!(error instanceof DeepSeekBridgeError)) return 503;
  switch (error.code) {
    case "INVALID_REQUEST": return 400;
    case "UNAUTHENTICATED": return 401;
    case "CANCELLED": return 499;
    case "TIMEOUT": return 504;
    case "CONTRACT_MISMATCH":
    case "INVALID_RESPONSE": return 502;
    case "CAPABILITY_DISABLED":
    case "NATIVE_UNAVAILABLE":
    case "DEPENDENCY_UNAVAILABLE": return 503;
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new DeepSeekBridgeError("INVALID_REQUEST", `Payload ${label} deve ser um objeto.`);
  return value;
}

async function dispatch(
  request: IncomingMessage,
  response: ServerResponse,
  bridge: DeepSeekBridge,
  maxBodyBytes: number,
  signal: AbortSignal,
  requireBearerToken: boolean,
  resolveBearerToken: (() => Promise<string | null>) | undefined,
  requireContextSignature: boolean,
  resolveContextSigningSecret: (() => Promise<string | null>) | undefined
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://deepseek-bridge.local");
  const correlationId = correlationFromRequest(request);
  if (request.method === "GET" && url.pathname === "/v1/health") {
    writeJson(response, 200, correlationId, healthToWire(await bridge.health(signal)));
    return;
  }

  if (requireBearerToken) {
    const authorization = requestHeader(request, "authorization");
    const token = authorization?.match(/^Bearer[ \t]+([^\s]+)$/i)?.[1];
    let expected: string | null = null;
    try { expected = await resolveBearerToken?.() ?? null; } catch { expected = null; }
    const receivedBytes = token ? Buffer.from(token, "utf8") : null;
    const expectedBytes = expected?.trim() ? Buffer.from(expected.trim(), "utf8") : null;
    const matches = Boolean(receivedBytes && expectedBytes && receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes));
    if (!matches) throw new DeepSeekBridgeError("UNAUTHENTICATED", "Credencial do bridge ausente ou inválida.");
  }

  const body = request.method === "POST" || request.method === "GET" ? await jsonBody(request, maxBodyBytes) : undefined;
  const bodyRecord = body === undefined ? {} : requireRecord(body, "request");
  const requestContext = async (): Promise<{ context: CvgContext; correlationId: string }> => {
    const parsed = bodyContext(body, request);
    await verifyContextSignature(parsed.context, request, requireContextSignature, resolveContextSigningSecret);
    return parsed;
  };

  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    const { context, correlationId: requestCorrelationId } = await requestContext();
    const input = parseBridgeSessionInput(bodyRecord.input);
    writeJson(response, 200, requestCorrelationId, await bridge.createSession(context, input, signal));
    return;
  }

  const turnPattern = /^\/v1\/sessions\/([^/]+)\/turns$/;
  if (request.method === "POST" && turnPattern.test(url.pathname)) {
    const { context, correlationId: requestCorrelationId } = await requestContext();
    const input = parseBridgeTurnInput(bodyRecord.input);
    const approvalId = bodyRecord.approvalId === undefined || bodyRecord.approvalId === null ? null : parseBridgeOpaqueId(bodyRecord.approvalId, "approvalId");
    writeJson(response, 200, requestCorrelationId, await bridge.executeTurn(context, input, approvalId, signal));
    return;
  }

  const approvalPattern = /^\/v1\/approvals\/([^/]+)$/;
  if (request.method === "POST" && approvalPattern.test(url.pathname)) {
    const { context, correlationId: requestCorrelationId } = await requestContext();
    const input = parseBridgeApprovalInput(bodyRecord);
    const approvalId = pathId(url.pathname, approvalPattern, "approvalId");
    writeJson(response, 200, requestCorrelationId, await bridge.approve(context, approvalId, input.decision, input.reason, signal));
    return;
  }

  const promotionPattern = /^\/v1\/drafts\/([^/]+)\/promote$/;
  if (request.method === "POST" && promotionPattern.test(url.pathname)) {
    const { context, correlationId: requestCorrelationId } = await requestContext();
    const draftId = pathId(url.pathname, promotionPattern, "draftId");
    writeJson(response, 200, requestCorrelationId, await bridge.promoteDraft(context, draftId, signal));
    return;
  }

  const replayPattern = /^\/v1\/sessions\/([^/]+)\/replay$/;
  if (request.method === "GET" && replayPattern.test(url.pathname)) {
    const { context, correlationId: requestCorrelationId } = await requestContext();
    const sessionId = pathId(url.pathname, replayPattern, "sessionId");
    writeJson(response, 200, requestCorrelationId, await bridge.replay(context, sessionId, signal));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/shutdown") {
    await bridge.shutdown(signal);
    writeJson(response, 200, correlationId, { schemaVersion: DEEPSEEK_BRIDGE_SCHEMA_VERSION, status: "DISABLED" });
    return;
  }

  throw new DeepSeekBridgeError("INVALID_REQUEST", "Rota ou método não pertencem ao contrato DeepSeek CVG.");
}

export function createDeepSeekBridgeServer(options: DeepSeekBridgeServerOptions = {}): DeepSeekBridgeServer {
  const nativePort = options.nativePort ?? (options.bridge ? undefined : createAcpNativeHarnessPortFromEnvironment(process.env));
  const bridge = options.bridge ?? new DeepSeekBridge(bridgeConfigFromEnvironment(process.env, nativePort));
  const maxBodyBytes = options.maxBodyBytes ?? defaultMaxBodyBytes;
  const requireBearerToken = options.requireBearerToken ?? process.env.NODE_ENV === "production";
  const resolveBearerToken = options.resolveBearerToken ?? bearerTokenResolverFromEnvironment(process.env);
  if (requireBearerToken && !resolveBearerToken) throw new Error("O bridge DeepSeek exige um resolver de bearer token respaldado por SecretProvider.");
  const requireContextSignature = options.requireContextSignature ?? process.env.NODE_ENV === "production";
  const resolveContextSigningSecret = options.resolveContextSigningSecret ?? contextSigningSecretResolverFromEnvironment(process.env);
  if (requireContextSignature && !resolveContextSigningSecret) throw new Error("O bridge DeepSeek exige um resolver de assinatura de contexto respaldado por SecretProvider.");
  const otelRuntime = options.telemetry ? null : createOpenTelemetryRuntime({ serviceName: "cvg-deepseek-bridge", requireTls: process.env.NODE_ENV === "production" });
  const telemetry = options.telemetry ?? new OpsTelemetry({
    ...(otelRuntime?.exporter ? { exporter: otelRuntime.exporter } : {}),
    telemetryMode: otelRuntime?.status === "READY" ? "OTEL_OTLP_REDACTED" : "REDACTED_BEST_EFFORT"
  });
  const server = createServer((request, response) => {
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    const requestCorrelationId = correlationFromRequest(request);
    const url = new URL(request.url ?? "/", "http://deepseek-bridge.local");
    const span = telemetry.startSpan("cvg.deepseek_bridge.request", { method: request.method ?? "UNKNOWN", route: url.pathname, correlationId: requestCorrelationId });
    void dispatch(request, response, bridge, maxBodyBytes, controller.signal, requireBearerToken, resolveBearerToken, requireContextSignature, resolveContextSigningSecret).then(() => {
      telemetry.finishSpan(span, response.statusCode || 200);
    }).catch((error: unknown) => {
      const status = statusForError(error);
      telemetry.finishSpan(span, status);
      writeJson(response, status, requestCorrelationId, toErrorEnvelope(error, requestCorrelationId));
    });
  });
  if (process.env.NODE_ENV === "production" && otelRuntime?.status !== "READY") throw new Error("Produção exige exportação OTLP OpenTelemetry pronta para o bridge.");
  server.once("close", () => {
    void bridge.shutdown().catch(() => undefined);
    void otelRuntime?.shutdown();
  });
  return { server, bridge, telemetry };
}

export async function startDeepSeekBridgeServer(options: DeepSeekBridgeServerOptions = {}): Promise<DeepSeekBridgeServer> {
  const created = createDeepSeekBridgeServer(options);
  const host = options.host ?? environmentValue(process.env, "CVG_DEEPSEEK_BRIDGE_HOST", "127.0.0.1");
  const port = options.port ?? environmentNumber(process.env, "CVG_DEEPSEEK_BRIDGE_PORT", 4320);
  await new Promise<void>((resolveListen, reject) => {
    created.server.once("error", reject);
    created.server.listen(port, host, resolveListen);
  });
  return created;
}

const executedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (executedDirectly) {
  void startDeepSeekBridgeServer().catch(() => { process.exitCode = 1; });
}
