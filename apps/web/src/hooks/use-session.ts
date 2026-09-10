import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { isAuthenticationError } from "../api/client";
import { fetchSessionAndContexts } from "../api/session";
import { RUNTIME_STATES, type RuntimeEvent, type RuntimeState } from "../state/runtime-state";
import { ContextInvalidError, emptySession, selectContext, sameContext, type SessionSnapshot } from "../state/session-state";
import type { ContextOption, User } from "../state/types";

type SessionRuntime = { state: RuntimeState; reconnectVersion: number; transition: (event: RuntimeEvent) => void };

export type SessionController = SessionSnapshot & {
  signIn: (user: User, contexts: ContextOption[]) => void;
  changeContext: (context: ContextOption) => void;
  signOut: () => Promise<void>;
  reset: () => void;
};

export function useSession(client: ApiClient, runtime: SessionRuntime): SessionController {
  const { state, reconnectVersion, transition } = runtime;
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => emptySession("loading"));
  const snapshotRef = useRef(snapshot);
  const initialValidationStarted = useRef(false);
  const handledReconnectVersion = useRef(0);
  const validationSequence = useRef(0);

  const updateSnapshot = useCallback((next: SessionSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const validate = useCallback(async (mode: "initial" | "reconnect", requestedContext: SessionSnapshot["context"] = null) => {
    const sequence = ++validationSequence.current;
    const previous = snapshotRef.current;
    const currentContext = mode === "reconnect" ? requestedContext ?? previous.context : null;
    let me: Awaited<ReturnType<typeof fetchSessionAndContexts>>["me"] | null = null;
    try {
      if (mode === "reconnect") transition({ type: "RECONNECT_STARTED" });
      const result = await fetchSessionAndContexts(client, currentContext);
      if (sequence !== validationSequence.current) return;
      me = result.me;
      const nextContext = selectContext(result.contexts, result.me.context, currentContext);
      if (!nextContext) throw new ContextInvalidError("Nenhum contexto autorizado foi devolvido para esta sessão.");
      if (currentContext && !sameContext(nextContext, currentContext)) throw new ContextInvalidError();
      updateSnapshot({ status: "ready", user: result.me.user, contexts: result.contexts, context: nextContext });
      transition({ type: "SESSION_VALIDATED" });
    } catch (reason) {
      if (sequence !== validationSequence.current) return;
      const message = reason instanceof Error ? reason.message : "Não foi possível revalidar sessão e contexto.";
      if (isAuthenticationError(reason)) {
        if (mode === "initial" && !previous.user) {
          updateSnapshot(emptySession());
          return;
        }
        updateSnapshot(emptySession());
        transition({ type: "AUTH_REQUIRED", reason: message });
        return;
      }
      if (mode === "reconnect") {
        updateSnapshot({ status: "ready", user: me?.user ?? previous.user, contexts: [], context: null });
        transition({ type: "CONTEXT_INVALIDATED", reason: message });
        return;
      }
      if (me) {
        updateSnapshot({ status: "ready", user: me.user, contexts: [], context: null });
        transition({ type: "CONTEXT_INVALIDATED", reason: message });
        return;
      }
      updateSnapshot(emptySession());
    }
  }, [client, transition, updateSnapshot]);

  useEffect(() => {
    if (initialValidationStarted.current) return;
    initialValidationStarted.current = true;
    void validate("initial");
  }, [validate]);

  useEffect(() => {
    if (reconnectVersion === 0 || handledReconnectVersion.current === reconnectVersion) return;
    handledReconnectVersion.current = reconnectVersion;
    const current = snapshotRef.current;
    if (current.status !== "ready" || !current.user || !current.context) return;
    void validate("reconnect");
  }, [reconnectVersion, validate]);

  const signIn = useCallback((user: User, contexts: ContextOption[]) => {
    validationSequence.current += 1;
    const nextContext = contexts[0] ?? null;
    updateSnapshot({ status: "ready", user, contexts, context: nextContext });
    transition({ type: "SIGNED_IN" });
    if (!nextContext) transition({ type: "CONTEXT_INVALIDATED", reason: "A sessão não recebeu um contexto autorizado." });
  }, [transition, updateSnapshot]);

  const changeContext = useCallback((nextContext: ContextOption) => {
    const current = snapshotRef.current;
    if (!current.context || sameContext(current.context, nextContext)) return;
    void validate("reconnect", nextContext);
  }, [validate]);

  const reset = useCallback(() => {
    validationSequence.current += 1;
    updateSnapshot(emptySession());
    transition({ type: "SIGNED_OUT" });
  }, [transition, updateSnapshot]);

  const signOut = useCallback(async () => {
    const current = snapshotRef.current;
    try {
      if (current.context && state === RUNTIME_STATES.ONLINE) await client.request("/auth/logout", { method: "POST" }, current.context);
    } finally {
      updateSnapshot(emptySession());
      transition({ type: "SIGNED_OUT" });
    }
  }, [client, state, transition, updateSnapshot]);

  return { ...snapshot, signIn, changeContext, signOut, reset };
}
