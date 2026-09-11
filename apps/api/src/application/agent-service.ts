import { aiUsageSettlementSchema, type AiApproval, type AiTurnInput, type AiTurnProvenance, type AiTurnUsage, type CvgContext, type OpaqueId } from "@cvg/contracts";
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

  /** @pdp-exempt health — readiness metadata has no actor/resource/data access. */
  health(): Promise<AgentRuntimeHealth> {
    return this.runtime.health();
  }

  async executeTurn(context: CvgContext, input: AiTurnInput): Promise<IdempotentCommandResult<AgentTurnResult>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.resourceId ?? input.encounterId ?? input.patientId });
    return this.commands.execute(this.command(context, "ai.turn", input.idempotencyKey, input.sessionId, input), async () => this.persistRuntimeResult(context, await this.runtime.executeTurn(context, input, input.approvalId)), { external: true });
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null, idempotencyKey: string): Promise<IdempotentCommandResult<AiApproval>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.approval", { resourceId: approvalId });
    return this.commands.execute(this.command(context, "ai.approval", idempotencyKey, approvalId, { approvalId, decision, reason }), () => this.runtime.approve(context, approvalId, decision, reason));
  }

  async retryTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId): Promise<IdempotentCommandResult<AgentTurnResult>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.approval.retry", { resourceId: input.resourceId ?? input.encounterId ?? approvalId });
    return this.commands.execute(this.command(context, "ai.approval.retry", input.idempotencyKey, approvalId, input), async () => this.persistRuntimeResult(context, await this.runtime.executeTurn(context, input, approvalId)), { external: true });
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
    const settlement = existingUsage?.settlement ?? {
      model: turn.model,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      // A request id proves which attempt was made; it is not a digest of the
      // provider response. Keep the response fact absent until the adapter
      // supplies an actual response digest.
      providerResponseDigest: null,
      estimatedCost: { amountMicros: null, currency: null, source: "UNAVAILABLE" as const, pricingRevision: null },
      actualCost: { amountMicros: null, currency: null, source: "UNAVAILABLE" as const, pricingRevision: null },
      discrepancy: { status: "NOT_EVALUATED" as const, deltaMicros: null, reason: "provider pricing evidence was not supplied" }
    };
    if (!aiUsageSettlementSchema.safeParse(settlement).success || settlement.model !== turn.model || settlement.inputTokens !== turn.inputTokens || settlement.outputTokens !== turn.outputTokens) {
      throw new DomainError("QUARANTINED", "O settlement de usage não corresponde ao turno retornado pelo runtime.", 503);
    }
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
        responseDigest: digest(turn.response ?? ""),
        settlement
      },
      settlement
    };
    const provenance: AiTurnProvenance = {
      ...result.provenance,
      references,
      referencesDigest,
      policyRevision: context.policyRevision,
      correlationId: context.correlationId,
      usageRecordId: usage.id
    };
    const persistedSession = this.store.persistAiSession({ ...session });
    const persistedTurn = this.store.persistAiTurn({ ...turn, references, provenance, usage });
    const persistedDraft = result.draft ? this.store.persistAiDraft({ ...result.draft }) : null;
    const persistedApproval = result.approval ? this.store.persistAiApproval({ ...result.approval }) : null;
    return { ...result, session: persistedSession, turn: persistedTurn, draft: persistedDraft, approval: persistedApproval, provenance };
  }
}
