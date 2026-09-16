/** Typed runtime unavailability: the caller degrades AI, never the domain. */
export class AgentRuntimeUnavailableError extends Error {
  readonly code = "AGENT_RUNTIME_UNAVAILABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeUnavailableError";
  }
}
