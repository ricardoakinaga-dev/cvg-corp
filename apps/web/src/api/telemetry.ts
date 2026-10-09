import { rememberCorrelationId } from "./correlation";

export const ROOT_ERROR_TELEMETRY_EVENT = "cvg:root-error";

export type RootErrorTelemetry = {
  event: "web.root_error";
  correlationId: string;
  errorName: string;
  redacted: true;
};

function safeErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z0-9._-]{1,80}$/.test(name) ? name : "UnknownError";
}

function rootErrorCorrelationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `root-error-${uuid}`;
  return `root-error-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Root failures expose only a safe event envelope, never a message or stack. */
export function emitRootErrorTelemetry(error: unknown): RootErrorTelemetry {
  const event: RootErrorTelemetry = {
    event: "web.root_error",
    correlationId: rootErrorCorrelationId(),
    errorName: safeErrorName(error),
    redacted: true
  };
  rememberCorrelationId(event.correlationId);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ROOT_ERROR_TELEMETRY_EVENT, { detail: event }));
  return event;
}
