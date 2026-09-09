import type { AiApproval, AiTurnInput, CvgContext, OpaqueId } from "@cvg/contracts";
import { idempotentAsync, type CvgStore, type IdempotencyInput } from "@cvg/domain";
import type { AgentDraftPromotion, AgentReplayResult, AgentRuntime, AgentRuntimeHealth, AgentTurnResult } from "@cvg/agent-runtime";

/** Application boundary for AI commands: context validation, idempotency and runtime delegation live here. */
export class AgentApplicationService {
  constructor(private readonly store: CvgStore, private readonly runtime: AgentRuntime) {}

  health(): Promise<AgentRuntimeHealth> {
    return this.runtime.health();
  }

  async executeTurn(context: CvgContext, input: AiTurnInput): Promise<{ receipt: Awaited<ReturnType<typeof idempotentAsync<AgentTurnResult>>>["receipt"]; value: AgentTurnResult; replayed: boolean }> {
    this.store.validateContext(context);
    return idempotentAsync(this.store, this.command(context, "ai.turn", input.idempotencyKey, input.sessionId, input), () => this.runtime.executeTurn(context, input, input.approvalId));
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null, idempotencyKey: string): Promise<{ receipt: Awaited<ReturnType<typeof idempotentAsync<AiApproval>>>["receipt"]; value: AiApproval; replayed: boolean }> {
    this.store.validateContext(context);
    return idempotentAsync(this.store, this.command(context, "ai.approval", idempotencyKey, approvalId, { approvalId, decision, reason }), () => this.runtime.approve(context, approvalId, decision, reason));
  }

  async retryTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId): Promise<{ receipt: Awaited<ReturnType<typeof idempotentAsync<AgentTurnResult>>>["receipt"]; value: AgentTurnResult; replayed: boolean }> {
    this.store.validateContext(context);
    return idempotentAsync(this.store, this.command(context, "ai.approval.retry", input.idempotencyKey, approvalId, input), () => this.runtime.executeTurn(context, input, approvalId));
  }

  async promoteDraft(context: CvgContext, draftId: OpaqueId, idempotencyKey: string): Promise<{ receipt: Awaited<ReturnType<typeof idempotentAsync<AgentDraftPromotion>>>["receipt"]; value: AgentDraftPromotion; replayed: boolean }> {
    this.store.validateContext(context);
    return idempotentAsync(this.store, this.command(context, "ai.draft.promote", idempotencyKey, draftId, { draftId }), () => this.runtime.promoteDraft(context, draftId));
  }

  replay(context: CvgContext, sessionId: OpaqueId): Promise<AgentReplayResult> {
    this.store.validateContext(context);
    return this.runtime.replay(context, sessionId);
  }

  private command(context: CvgContext, operation: string, key: string, resourceId: OpaqueId | null, body: unknown): IdempotencyInput {
    return { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation, key, resourceId, unitId: context.unitId, workspaceId: context.workspaceId, body };
  }
}
