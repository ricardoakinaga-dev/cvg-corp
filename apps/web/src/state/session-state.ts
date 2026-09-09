import type { ContextOption, ContextReference } from "./types";

export type SessionSnapshot = {
  status: "loading" | "signed-out" | "ready";
  user: import("./types").User | null;
  contexts: ContextOption[];
  context: ContextOption | null;
};

export class ContextInvalidError extends Error {
  constructor(message = "O contexto autorizado não está mais disponível.") {
    super(message);
    this.name = "ContextInvalidError";
  }
}

export function sameContext(currentContext: ContextOption, nextContext: ContextOption): boolean {
  return currentContext.unit.id === nextContext.unit.id && currentContext.workspace.id === nextContext.workspace.id;
}

export function contextMatchesReference(candidate: ContextOption, reference: ContextReference): boolean {
  return candidate.unit.id === reference.unit?.id && candidate.workspace.id === reference.workspace?.id;
}

export function selectContext(contexts: ContextOption[], reference: ContextReference | null, current: ContextOption | null): ContextOption | null {
  if (current) return contexts.find((candidate) => sameContext(candidate, current)) ?? null;
  if (reference) return contexts.find((candidate) => contextMatchesReference(candidate, reference)) ?? contexts[0] ?? null;
  return contexts[0] ?? null;
}

export function emptySession(status: SessionSnapshot["status"] = "signed-out"): SessionSnapshot {
  return { status, user: null, contexts: [], context: null };
}
