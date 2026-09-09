export const RUNTIME_STATES = {
  ONLINE: "ONLINE",
  OFFLINE_READ_ONLY: "OFFLINE_READ_ONLY",
  REVALIDATING: "REVALIDATING",
  DEGRADED: "DEGRADED",
  CONTEXT_INVALID: "CONTEXT_INVALID",
  REAUTH_REQUIRED: "REAUTH_REQUIRED"
} as const;

export type RuntimeState = (typeof RUNTIME_STATES)[keyof typeof RUNTIME_STATES];

export type RuntimeSnapshot = {
  state: RuntimeState;
  reconnectVersion: number;
  reason?: string;
};

export type RuntimeEvent =
  | { type: "NETWORK_OFFLINE" }
  | { type: "NETWORK_ONLINE" }
  | { type: "RECONNECT_STARTED" }
  | { type: "SESSION_VALIDATED" }
  | { type: "REQUEST_DEGRADED"; reason: string }
  | { type: "CONTEXT_INVALIDATED"; reason: string }
  | { type: "AUTH_REQUIRED"; reason?: string }
  | { type: "SIGNED_IN" }
  | { type: "SIGNED_OUT" };

export const initialRuntimeState = (): RuntimeSnapshot => ({
  state: typeof navigator === "undefined" || navigator.onLine ? RUNTIME_STATES.ONLINE : RUNTIME_STATES.OFFLINE_READ_ONLY,
  reconnectVersion: 0
});

const snapshotWith = (snapshot: RuntimeSnapshot, state: RuntimeState, reason?: string): RuntimeSnapshot => {
  if (reason) return { ...snapshot, state, reason };
  return { state, reconnectVersion: snapshot.reconnectVersion };
};

export function runtimeStateReducer(snapshot: RuntimeSnapshot, event: RuntimeEvent): RuntimeSnapshot {
  switch (event.type) {
    case "NETWORK_OFFLINE":
      return snapshotWith(snapshot, RUNTIME_STATES.OFFLINE_READ_ONLY, "O navegador informou que a conexão foi interrompida.");
    case "NETWORK_ONLINE":
      return snapshot.state === RUNTIME_STATES.OFFLINE_READ_ONLY
        ? { state: RUNTIME_STATES.REVALIDATING, reconnectVersion: snapshot.reconnectVersion + 1, reason: "A conexão voltou; sessão e contexto aguardam revalidação." }
        : snapshot;
    case "RECONNECT_STARTED":
      return snapshotWith(snapshot, RUNTIME_STATES.REVALIDATING, "Revalidando sessão e contexto autorizado.");
    case "SESSION_VALIDATED":
      return snapshotWith(snapshot, RUNTIME_STATES.ONLINE);
    case "REQUEST_DEGRADED":
      return snapshot.state === RUNTIME_STATES.OFFLINE_READ_ONLY
        ? snapshot
        : snapshotWith(snapshot, RUNTIME_STATES.DEGRADED, event.reason);
    case "CONTEXT_INVALIDATED":
      return snapshotWith(snapshot, RUNTIME_STATES.CONTEXT_INVALID, event.reason);
    case "AUTH_REQUIRED":
      return snapshotWith(snapshot, RUNTIME_STATES.REAUTH_REQUIRED, event.reason);
    case "SIGNED_IN":
      return snapshotWith(snapshot, RUNTIME_STATES.ONLINE);
    case "SIGNED_OUT":
      return snapshot.state === RUNTIME_STATES.OFFLINE_READ_ONLY
        ? snapshot
        : snapshotWith(snapshot, RUNTIME_STATES.ONLINE);
    default:
      return snapshot;
  }
}

export function isWriteAllowed(state: RuntimeState): boolean {
  return state === RUNTIME_STATES.ONLINE;
}

export function canRenderContextData(state: RuntimeState): boolean {
  return state === RUNTIME_STATES.ONLINE;
}

export function runtimeStatePresentation(state: RuntimeState): { label: string; message: string; tone: "teal" | "amber" | "coral" } {
  switch (state) {
    case RUNTIME_STATES.ONLINE:
      return { label: "LOCAL SINTÉTICO", message: "Dados descartáveis · caminho manual disponível · providers externos bloqueados", tone: "amber" };
    case RUNTIME_STATES.OFFLINE_READ_ONLY:
      return { label: "OFFLINE_READ_ONLY", message: "Sem cache autorizado para este contexto · nenhum efeito ou sincronização será executado", tone: "coral" };
    case RUNTIME_STATES.REVALIDATING:
      return { label: "REVALIDATING", message: "Sessão, escopo e policy estão sendo confirmados antes de exibir dados", tone: "amber" };
    case RUNTIME_STATES.DEGRADED:
      return { label: "DEGRADED", message: "Conectividade parcial · leituras podem falhar · escritas críticas permanecem bloqueadas", tone: "amber" };
    case RUNTIME_STATES.CONTEXT_INVALID:
      return { label: "CONTEXT_INVALID", message: "O contexto atual foi invalidado e nenhum dado será exibido até uma nova resolução", tone: "coral" };
    case RUNTIME_STATES.REAUTH_REQUIRED:
      return { label: "REAUTH_REQUIRED", message: "A sessão expirou ou não pôde ser confirmada; uma nova autenticação é necessária", tone: "coral" };
  }
}
