import type { AiApproval, AiDraft, AiSession, AiTurnInput, CvgContext, OpaqueId } from "@cvg/contracts";
import { AgentRuntimeUnavailableError } from "./errors.ts";
import type { AgentDraftPromotion, AgentReplayResult, AgentRuntime, AgentRuntimeCapabilities, AgentRuntimeHealth, AgentTurnResult } from "./index.ts";

/**
 * Explicitly disabled AI runtime.  `CVG_AGENT_RUNTIME=disabled` must keep the
 * whole hospital operational: every operation fails closed with a typed
 * unavailability error and readiness reports DISABLED, never DOWN.
 */
export class DisabledAgentRuntime implements AgentRuntime {
  readonly adapterId = "disabled";
  private readonly capabilities: AgentRuntimeCapabilities = {
    adapterId: "disabled",
    provider: "none",
    engineCommit: "disabled",
    manifestVersion: "disabled",
    toolNames: [],
    supports: { cancellation: false, approvals: false, replay: false, provenance: false }
  };

  /** @pdp-exempt health — readiness metadata has no actor/resource/data access. */
  async health(): Promise<AgentRuntimeHealth> {
    return { status: "DISABLED", capabilities: this.capabilities, checkedAt: new Date().toISOString(), reason: "CVG_AGENT_RUNTIME=disabled" };
  }

  async createSession(_context: CvgContext, _input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">): Promise<AiSession> {
    throw new AgentRuntimeUnavailableError("O runtime de IA está desabilitado por configuração.");
  }

  async executeTurn(_context: CvgContext, _input: AiTurnInput, _approvalId?: OpaqueId | null): Promise<AgentTurnResult> {
    throw new AgentRuntimeUnavailableError("O runtime de IA está desabilitado por configuração.");
  }

  async approve(_context: CvgContext, _approvalId: OpaqueId, _decision: "allowed-once" | "rejected", _reason: string | null): Promise<AiApproval> {
    throw new AgentRuntimeUnavailableError("O runtime de IA está desabilitado por configuração.");
  }

  async promoteDraft(_context: CvgContext, _draftId: OpaqueId): Promise<AgentDraftPromotion> {
    throw new AgentRuntimeUnavailableError("O runtime de IA está desabilitado por configuração.");
  }

  async replay(_context: CvgContext, _sessionId: OpaqueId): Promise<AgentReplayResult> {
    throw new AgentRuntimeUnavailableError("O runtime de IA está desabilitado por configuração.");
  }

  async shutdown(): Promise<void> {
    return undefined;
  }
}
