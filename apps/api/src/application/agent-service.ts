import type { AiApproval, AiTurnInput, AiTurnProvenance, AiTurnUsage, CvgContext, OpaqueId } from "@cvg/contracts";
import { digest, makeId, type CvgStore, type IdempotencyInput } from "@cvg/domain";
import type { AgentDraftPromotion, AgentReplayResult, AgentRuntime, AgentRuntimeHealth, AgentTurnResult } from "@cvg/agent-runtime";
import { DomainError } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";
import { DurableIdempotencyService, type IdempotentCommandResult } from "./idempotency-service.ts";

/** Application boundary for AI commands: context validation, idempotency and runtime delegation live here. */
export class AgentApplicationService {
  private readonly commands: DurableIdempotencyService;

  constructor(private readonly store: CvgStore, private readonly runtime: AgentRuntime, commands?: DurableIdempotencyService) {
    this.commands = commands ?? new DurableIdempotencyService(store, null);
  }

  health(): Promise<AgentRuntimeHealth> {
    return this.runtime.health();
  }

  async executeTurn(context: CvgContext, input: AiTurnInput): Promise<IdempotentCommandResult<AgentTurnResult>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.resourceId ?? input.encounterId ?? input.patientId });
    return this.commands.execute(this.command(context, "ai.turn", input.idempotencyKey, input.sessionId, input), async () => this.persistRuntimeResult(context, await this.runtime.executeTurn(context, input, input.approvalId)));
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null, idempotencyKey: string): Promise<IdempotentCommandResult<AiApproval>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.approval", { resourceId: approvalId });
    return this.commands.execute(this.command(context, "ai.approval", idempotencyKey, approvalId, { approvalId, decision, reason }), () => this.runtime.approve(context, approvalId, decision, reason));
  }

  async retryTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId): Promise<IdempotentCommandResult<AgentTurnResult>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.resourceId ?? input.encounterId ?? approvalId });
    return this.commands.execute(this.command(context, "ai.approval.retry", input.idempotencyKey, approvalId, input), async () => this.persistRuntimeResult(context, await this.runtime.executeTurn(context, input, approvalId)));
  }

  async promoteDraft(context: CvgContext, draftId: OpaqueId, idempotencyKey: string): Promise<IdempotentCommandResult<AgentDraftPromotion>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.draft.promote", { resourceId: draftId });
    return this.commands.execute(this.command(context, "ai.draft.promote", idempotencyKey, draftId, { draftId }), () => this.runtime.promoteDraft(context, draftId));
  }

  replay(context: CvgContext, sessionId: OpaqueId): Promise<AgentReplayResult> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.replay", { resourceId: sessionId });
    return this.runtime.replay(context, sessionId);
  }

  private command(context: CvgContext, operation: string, key: string, resourceId: OpaqueId | null, body: unknown): IdempotencyInput {
    return { organizationId: context.organizationId, actorId: context.actorId, sessionId: context.sessionId, operation, key, resourceId, unitId: context.unitId, workspaceId: context.workspaceId, body };
  }

  /**
   * The runtime may be remote (DeepSeek) and therefore cannot be trusted to
   * mutate the canonical store. This application boundary binds the returned
   * turn to the authenticated scope and creates one durable usage identity for
   * the exact turn before the HTTP transaction is committed.
   */
  private persistRuntimeResult(context: CvgContext, result: AgentTurnResult): AgentTurnResult {
    const { session, turn } = result;
    if (session.organizationId !== context.organizationId || session.actorId !== context.actorId || session.unitId !== context.unitId || session.workspaceId !== context.workspaceId) {
      throw new DomainError("POLICY_DENIED", "O runtime retornou uma sessão fora do contexto autenticado.", 403);
    }
    if (turn.sessionId !== session.id) throw new DomainError("QUARANTINED", "O runtime retornou um turno desvinculado da sessão.", 503);

    const references = [...turn.references];
    const referencesDigest = digest(references);
    const units = turn.inputTokens + turn.outputTokens;
    const existingUsage = turn.usage;
    const usage: AiTurnUsage = {
      id: existingUsage?.id ?? makeId(),
      reservationId: existingUsage?.reservationId ?? null,
      providerRequestId: existingUsage?.providerRequestId ?? null,
      idempotencyKey: `ai-turn:${turn.id}`,
      usageKind: existingUsage?.usageKind ?? "TOKENS",
      reservedUnits: units,
      consumedUnits: units,
      status: turn.status === "OUTCOME_UNKNOWN" ? "RECONCILIATION_REQUIRED" : "SETTLED",
      record: {
        kind: "AI_TURN_USAGE",
        turnId: turn.id,
        sessionId: session.id,
        model: turn.model,
        provider: result.provenance.provider,
        engineCommit: result.provenance.engineCommit,
        manifestVersion: result.provenance.manifestVersion,
        profileDigest: result.provenance.profileDigest,
        policyRevision: context.policyRevision,
        correlationId: context.correlationId,
        referencesDigest,
        responseDigest: digest(turn.response ?? "")
      }
    };
    const provenance: AiTurnProvenance = {
      ...result.provenance,
      references,
      referencesDigest,
      policyRevision: context.policyRevision,
      correlationId: context.correlationId,
      usageRecordId: usage.id
    };
    const persistedSession = { ...session };
    const persistedTurn = { ...turn, references, provenance, usage };
    this.store.aiSessions.set(persistedSession.id, persistedSession);
    this.store.aiTurns.set(persistedTurn.id, persistedTurn);
    if (result.draft) this.store.aiDrafts.set(result.draft.id, { ...result.draft });
    if (result.approval) this.store.aiApprovals.set(result.approval.id, { ...result.approval });
    return { ...result, session: persistedSession, turn: persistedTurn, provenance };
  }
}
