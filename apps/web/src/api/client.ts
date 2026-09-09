import { isWriteAllowed, type RuntimeState } from "../state/runtime-state";
import type { ContextOption } from "../state/types";

type ApiErrorPayload = { code: string; message: string; details?: Record<string, unknown> };
type ApiEnvelope<T> = { schemaVersion: number; data?: T; error?: ApiErrorPayload; correlationId: string };

const API = import.meta.env.VITE_API_URL ?? "";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_AUTH_WRITES = new Set(["/auth/login", "/auth/demo"]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly correlationId: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(message: string, options: { status: number; code: string | null; correlationId: string | null; details: Record<string, unknown> | null }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.correlationId = options.correlationId;
    this.details = options.details;
  }
}

export class ClientWriteBlockedError extends Error {
  readonly state: RuntimeState;

  constructor(state: RuntimeState) {
    super(`Escritas críticas estão bloqueadas no estado ${state}.`);
    this.name = "ClientWriteBlockedError";
    this.state = state;
  }
}

export type ApiClient = {
  request<T>(path: string, init?: RequestInit, context?: ContextOption | null): Promise<T>;
  get<T>(path: string, context?: ContextOption | null): Promise<T>;
};

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code === "UNAUTHENTICATED" || error.code === "UNAUTHORIZED");
}

export function isDegradedRequestError(error: unknown): boolean {
  return (error instanceof ApiError && error.status >= 500) || error instanceof TypeError;
}

function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("cvg_csrf="))?.split("=")[1];
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return null; }
}

function isWrite(path: string, method: string): boolean {
  return WRITE_METHODS.has(method) && !PUBLIC_AUTH_WRITES.has(path);
}

function parseEnvelope<T>(body: string): ApiEnvelope<T> | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const envelope = parsed as Record<string, unknown>;
    if (envelope.schemaVersion !== 1 || typeof envelope.correlationId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(envelope.correlationId)) return null;
    const hasData = Object.prototype.hasOwnProperty.call(envelope, "data");
    const hasError = Object.prototype.hasOwnProperty.call(envelope, "error");
    if (hasData === hasError) return null;
    if (hasError) {
      const error = envelope.error;
      if (typeof error !== "object" || error === null) return null;
      const bodyError = error as Record<string, unknown>;
      if (typeof bodyError.code !== "string" || typeof bodyError.message !== "string") return null;
    }
    return envelope as ApiEnvelope<T>;
  } catch {
    return null;
  }
}

export function createApiClient(getRuntimeState: () => RuntimeState, onFailure?: (error: unknown) => void): ApiClient {
  const request = async <T>(path: string, init: RequestInit = {}, context: ContextOption | null = null): Promise<T> => {
    const method = (init.method ?? "GET").toUpperCase();
    const runtimeState = getRuntimeState();
    if (isWrite(path, method) && !isWriteAllowed(runtimeState)) throw new ClientWriteBlockedError(runtimeState);

    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (context) {
      headers.set("X-CVG-Unit-Id", context.unit.id);
      headers.set("X-CVG-Workspace-Id", context.workspace.id);
    }
    const csrf = csrfToken();
    if (WRITE_METHODS.has(method) && csrf) headers.set("X-CSRF-Token", csrf);

    try {
      const response = await fetch(`${API}/api/v1${path}`, { ...init, headers, credentials: "include" });
      const payload = parseEnvelope<T>(await response.text());
      if (!payload) {
        const error = new ApiError("A API retornou um envelope inválido ou incompatível.", { status: response.status, code: "INTERNAL_ERROR", correlationId: null, details: null });
        if (!PUBLIC_AUTH_WRITES.has(path)) onFailure?.(error);
        throw error;
      }
      if (!response.ok || payload?.error) {
        const error = new ApiError(payload?.error?.message ?? "Não foi possível concluir a operação.", {
          status: response.status,
          code: payload?.error?.code ?? null,
          correlationId: payload?.correlationId ?? null,
          details: payload?.error?.details ?? null
        });
        if (!PUBLIC_AUTH_WRITES.has(path)) onFailure?.(error);
        throw error;
      }
      return payload?.data as T;
    } catch (error) {
      if (!(error instanceof ApiError) && !PUBLIC_AUTH_WRITES.has(path)) onFailure?.(error);
      throw error;
    }
  };

  return {
    request,
    get: <T>(path: string, context: ContextOption | null = null) => request<T>(path, {}, context)
  };
}
