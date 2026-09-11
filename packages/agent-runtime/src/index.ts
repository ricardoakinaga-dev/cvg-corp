import type { AiApproval, AiDraft, AiSession, AiTurn, AiTurnInput, AiTurnProvenance, CvgContext, OpaqueId } from "@cvg/contracts";

export { bridgeRequestSignature, BRIDGE_REQUEST_MAX_AGE_MS, BRIDGE_REQUEST_CLOCK_SKEW_MS } from "./bridge-request.ts";
export { canonicalJson, replayDigest } from "./replay-digest.ts";

export type AgentRuntimeStatus = "READY" | "DEGRADED" | "UNAVAILABLE" | "DISABLED";

export interface AgentRuntimeCapabilities {
  adapterId: string;
  provider: string;
  engineCommit: string;
  manifestVersion: string;
  toolNames: readonly string[];
  supports: { cancellation: boolean; approvals: boolean; replay: boolean; provenance: boolean };
}

export interface AgentRuntimeHealth {
  status: AgentRuntimeStatus;
  capabilities: AgentRuntimeCapabilities;
  checkedAt: string;
  reason: string | null;
}

export interface AgentTurnResult {
  session: AiSession;
  turn: AiTurn;
  draft: AiDraft | null;
  approval: AiApproval | null;
  provenance: AiTurnProvenance;
}

export interface AgentReplayResult {
  session: AiSession;
  turns: AiTurn[];
  digest: string;
  provenance: AgentRuntimeHealth["capabilities"];
}

export interface AgentDraftPromotion {
  draft: AiDraft;
  documentId: OpaqueId;
}

export interface AgentRuntime {
  readonly adapterId: string;
  health(): Promise<AgentRuntimeHealth>;
  createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">): Promise<AiSession>;
  executeTurn(context: CvgContext, input: AiTurnInput, approvalId?: OpaqueId | null): Promise<AgentTurnResult>;
  approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null): Promise<AiApproval>;
  promoteDraft(context: CvgContext, draftId: OpaqueId): Promise<AgentDraftPromotion>;
  replay(context: CvgContext, sessionId: OpaqueId): Promise<AgentReplayResult>;
  shutdown(): Promise<void>;
}

export class AgentRuntimeUnavailableError extends Error {
  readonly code = "AGENT_RUNTIME_UNAVAILABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeUnavailableError";
  }
}
