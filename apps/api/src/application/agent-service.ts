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
    return this.commands.execute(this.command(context, "ai.turn", input.idempotencyKey, input.sessionId, input), async () => this.persistRuntimeResult(context, input, await this.runtime.executeTurn(context, input, input.approvalId)), { external: true });
  }

  async approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null, idempotencyKey: string): Promise<IdempotentCommandResult<AiApproval>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.approval", { resourceId: approvalId });
    return this.commands.execute(this.command(context, "ai.approval", idempotencyKey, approvalId, { approvalId, decision, reason }), () => this.runtime.approve(context, approvalId, decision, reason));
  }

  async retryTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId): Promise<IdempotentCommandResult<AgentTurnResult>> {
    this.store.validateContext(context);
    enforceApplicationPolicy(context, "ai.approval.retry", { resourceId: input.resourceId ?? input.encounterId ?? approvalId });
    return this.commands.execute(this.command(context, "ai.approval.retry", input.idempotencyKey, approvalId, input), async () => this.persistRuntimeResult(context, input, await this.runtime.executeTurn(context, input, approvalId)), { external: true });
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
  private currentAuthorityReason(context: CvgContext, session: AgentTurnResult["session"], input: AiTurnInput): string | null {
    try {
      this.store.validateContext(context);
      const current = this.store.aiSessions.get(session.id);
      if (!current || current.id !== session.id || current.status !== "ACTIVE" || current.organizationId !== context.organizationId || current.actorId !== context.actorId || current.unitId !== context.unitId || current.workspaceId !== context.workspaceId || current.purpose !== input.purpose || current.patientId !== input.patientId || current.encounterId !== input.encounterId || (input.sessionId !== null && input.sessionId !== session.id)) return "AI_TURN_AUTHORITY_REVOKED";
      const resourceId = input.resourceId ?? input.encounterId;
      if (resourceId) {
        const encounter = this.store.encounters.get(resourceId);
        if (encounter && (encounter.organizationId !== context.organizationId || encounter.unitId !== context.unitId || encounter.workspaceId !== context.workspaceId || encounter.patientId !== (input.patientId ?? encounter.patientId))) return "AI_TURN_RESOURCE_SCOPE_CHANGED";
      }
      return null;
    } catch {
      return "AI_TURN_AUTHORITY_REVOKED";
    }
  }

  private persistRuntimeResult(context: CvgContext, input: AiTurnInput, result: AgentTurnResult): AgentTurnResult {
    const { session, turn } = result;
    if (session.organizationId !== context.organizationId || session.actorId !== context.actorId || session.unitId !== context.unitId || session.workspaceId !== context.workspaceId) {
      throw new DomainError("POLICY_DENIED", "O runtime retornou uma sessão fora do contexto autenticado.", 403);
    }
    if (turn.sessionId !== session.id || (input.sessionId !== null && input.sessionId !== session.id)) throw new DomainError("QUARANTINED", "O runtime retornou um turno desvinculado da sessão.", 503);

    const existingUsage = turn.usage;
    const validInputTokens = Number.isSafeInteger(turn.inputTokens) && turn.inputTokens >= 0 ? turn.inputTokens : 0;
    const validOutputTokens = Number.isSafeInteger(turn.outputTokens) && turn.outputTokens >= 0 ? turn.outputTokens : 0;
    const observedUnits = validInputTokens + validOutputTokens;
    const candidateSettlement = existingUsage?.settlement;
    const fallbackSettlement = {
      model: turn.model,
      inputTokens: validInputTokens,
      outputTokens: validOutputTokens,
      // No production price is inferred at this boundary.
      providerResponseDigest: null,
      estimatedCost: { amountMicros: null, currency: null, source: "UNAVAILABLE" as const, pricingRevision: null },
      actualCost: { amountMicros: null, currency: null, source: "UNAVAILABLE" as const, pricingRevision: null },
      discrepancy: { status: "NOT_EVALUATED" as const, deltaMicros: null, reason: "provider pricing evidence was not supplied" }
    };
    const settlementValid = candidateSettlement !== undefined
      && aiUsageSettlementSchema.safeParse(candidateSettlement).success
      && candidateSettlement.model === turn.model
      && candidateSettlement.inputTokens === validInputTokens
      && candidateSettlement.outputTokens === validOutputTokens;
    const settlement = settlementValid ? candidateSettlement : fallbackSettlement;
    const stableReservationId = existingUsage?.reservationId && existingUsage.reservationId.trim() ? existingUsage.reservationId : null;
    const hasStableSettlement = turn.status === "COMPLETED" && settlementValid && stableReservationId !== null && existingUsage?.status === "SETTLED";
    let authorityReason = this.currentAuthorityReason(context, session, input);
    let status: AgentTurnResult["turn"]["status"] = authorityReason || (turn.status === "COMPLETED" && !hasStableSettlement) ? "OUTCOME_UNKNOWN" : turn.status;

    // This is deliberately adjacent to the persistence seam. No COMPLETED
    // turn is persisted after a stale authority check.
    if (status === "COMPLETED") authorityReason = this.currentAuthorityReason(context, session, input);
    if (authorityReason) status = "OUTCOME_UNKNOWN";

    const scrubOutput = authorityReason !== null || (turn.status === "COMPLETED" && status === "OUTCOME_UNKNOWN");
    const references = scrubOutput ? [] : [...turn.references];
    const referencesDigest = digest(references);
    const consumedUnits = Math.max(observedUnits, Number.isSafeInteger(existingUsage?.consumedUnits) && (existingUsage?.consumedUnits ?? 0) >= 0 ? existingUsage!.consumedUnits : 0);
    const reservedUnits = Number.isSafeInteger(existingUsage?.reservedUnits) && (existingUsage?.reservedUnits ?? 0) >= 0 ? existingUsage!.reservedUnits : observedUnits;
    const usageStatus: AiTurnUsage["status"] = status === "OUTCOME_UNKNOWN" ? "RECONCILIATION_REQUIRED" : existingUsage?.status ?? (status === "RECEIVED" ? "RECEIVED" : "SETTLED");
    const usage: AiTurnUsage = {
      id: existingUsage?.id ?? makeId(),
      reservationId: stableReservationId,
      providerRequestId: existingUsage?.providerRequestId ?? null,
      idempotencyKey: existingUsage?.idempotencyKey ?? `ai-turn:${turn.id}`,
      usageKind: existingUsage?.usageKind ?? "TOKENS",
      reservedUnits,
      consumedUnits,
      status: usageStatus,
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
        reservationId: stableReservationId,
        reservedUnits,
        consumedUnits,
        settlementStatus: usageStatus,
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
    const safeTurn = { ...turn, status, response: scrubOutput ? null : turn.response, inputTokens: validInputTokens, outputTokens: validOutputTokens, references, provenance, usage };
    const persistedSession = this.store.persistAiSession({ ...session });
    const persistedTurn = this.store.persistAiTurn(safeTurn);
    const persistedDraft = status === "COMPLETED" && !scrubOutput && result.draft ? this.store.persistAiDraft({ ...result.draft }) : null;
    const persistedApproval = !scrubOutput && result.approval ? this.store.persistAiApproval({ ...result.approval }) : null;
    return { ...result, session: persistedSession, turn: persistedTurn, draft: persistedDraft, approval: persistedApproval, provenance };
  }
}
