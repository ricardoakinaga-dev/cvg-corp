import { randomUUID } from "node:crypto";
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
  type DeepSeekBridgeConfig,
  type DeepSeekNativeHarnessPort
} from "@cvg/deepseek-bridge";
import type { CvgContext, OpaqueId } from "@cvg/contracts";

const correlationPattern = /^[A-Za-z0-9._-]{1,80}$/;
const defaultMaxBodyBytes = 1_048_576;

export interface DeepSeekBridgeServerOptions {
  bridge?: DeepSeekBridge;
  nativePort?: DeepSeekNativeHarnessPort;
  host?: string;
  port?: number;
  maxBodyBytes?: number;
}

export interface DeepSeekBridgeServer {
  server: Server;
  bridge: DeepSeekBridge;
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
  const raw = isRecord(body) ? body.context : contextHeader(request);
  const context = parseBridgeContext(raw);
  const headerCorrelation = requestHeader(request, "x-cvg-correlation-id");
  const correlationId = headerCorrelation && correlationPattern.test(headerCorrelation) ? headerCorrelation : context.correlationId;
  if (context.correlationId !== correlationId) throw new DeepSeekBridgeError("CONTRACT_MISMATCH", "Correlation ID do header e do contexto diverge.");
  return { context, correlationId };
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
  signal: AbortSignal
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://deepseek-bridge.local");
  const correlationId = correlationFromRequest(request);
  if (request.method === "GET" && url.pathname === "/v1/health") {
    writeJson(response, 200, correlationId, healthToWire(await bridge.health(signal)));
    return;
  }

  const body = request.method === "POST" || request.method === "GET" ? await jsonBody(request, maxBodyBytes) : undefined;
  const bodyRecord = body === undefined ? {} : requireRecord(body, "request");
  const requestContext = (): { context: CvgContext; correlationId: string } => bodyContext(body, request);

  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    const { context, correlationId: requestCorrelationId } = requestContext();
    const input = parseBridgeSessionInput(bodyRecord.input);
    writeJson(response, 200, requestCorrelationId, await bridge.createSession(context, input, signal));
    return;
  }

  const turnPattern = /^\/v1\/sessions\/([^/]+)\/turns$/;
  if (request.method === "POST" && turnPattern.test(url.pathname)) {
    const { context, correlationId: requestCorrelationId } = requestContext();
    const input = parseBridgeTurnInput(bodyRecord.input);
    const approvalId = bodyRecord.approvalId === undefined || bodyRecord.approvalId === null ? null : parseBridgeOpaqueId(bodyRecord.approvalId, "approvalId");
    writeJson(response, 200, requestCorrelationId, await bridge.executeTurn(context, input, approvalId, signal));
    return;
  }

  const approvalPattern = /^\/v1\/approvals\/([^/]+)$/;
  if (request.method === "POST" && approvalPattern.test(url.pathname)) {
    const { context, correlationId: requestCorrelationId } = requestContext();
    const input = parseBridgeApprovalInput(bodyRecord);
    const approvalId = pathId(url.pathname, approvalPattern, "approvalId");
    writeJson(response, 200, requestCorrelationId, await bridge.approve(context, approvalId, input.decision, input.reason, signal));
    return;
  }

  const promotionPattern = /^\/v1\/drafts\/([^/]+)\/promote$/;
  if (request.method === "POST" && promotionPattern.test(url.pathname)) {
    const { context, correlationId: requestCorrelationId } = requestContext();
    const draftId = pathId(url.pathname, promotionPattern, "draftId");
    writeJson(response, 200, requestCorrelationId, await bridge.promoteDraft(context, draftId, signal));
    return;
  }

  const replayPattern = /^\/v1\/sessions\/([^/]+)\/replay$/;
  if (request.method === "GET" && replayPattern.test(url.pathname)) {
    const { context, correlationId: requestCorrelationId } = requestContext();
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
  const bridge = options.bridge ?? new DeepSeekBridge(bridgeConfigFromEnvironment(process.env, options.nativePort));
  const maxBodyBytes = options.maxBodyBytes ?? defaultMaxBodyBytes;
  const server = createServer((request, response) => {
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    void dispatch(request, response, bridge, maxBodyBytes, controller.signal).catch((error: unknown) => {
      const correlationId = correlationFromRequest(request);
      writeJson(response, statusForError(error), correlationId, toErrorEnvelope(error, correlationId));
    });
  });
  return { server, bridge };
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
