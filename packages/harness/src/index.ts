import { createHash } from "node:crypto";
import type { AiApproval, AiDraft, AiSession, AiTurn, CvgContext, DataClass, OpaqueId, Role } from "@cvg/contracts";
import type { AiTurnInput } from "@cvg/contracts";
import { CvgStore, DomainError, digest, isInContext, makeId, now } from "@cvg/domain";
import { enforceApplicationPolicy, StaticPolicyDecisionPoint } from "@cvg/agent-policy";
import { replayDigest } from "@cvg/agent-runtime";
import { ToolGateway, ToolGatewayError, toolExecutionDigest, type ToolExecutionLedger, type ToolExecutionLedgerClaim, type ToolExecutionLedgerInput, type ToolExecutionLedgerRecord, type ToolExecutionRequest } from "@cvg/agent-tools";

export const DSH_ENGINE_COMMIT = "6454e3270642c3a7551dcae4f7447e4032febd77";
export const DSH_MANIFEST_VERSION = "0.1.1-rc.2";

export type ToolRisk = "READ_ONLY" | "DRAFT" | "REVERSIBLE" | "HIGH_IMPACT";

export interface GovernedTool {
  name: string;
  version: string;
  description: string;
  operation: string;
  risk: ToolRisk;
  approvalMode: "NONE" | "SAME_ACTOR" | "INDEPENDENT";
  allowedRoles: Role[];
  requiresApproval: boolean;
  idempotency: "REQUIRED" | "OPTIONAL";
  auditAction: string;
  secretRefs: readonly string[];
  capability: string;
  acceptedDataClasses: readonly DataClass[];
  scope: "ORGANIZATION" | "UNIT" | "WORKSPACE";
  resourceRequired: boolean;
}

export const TOOL_REGISTRY: GovernedTool[] = [
  { name: "cvg.patient.read", version: "1.0.0", description: "Ler dados mínimos de um paciente no escopo", operation: "patients.read", risk: "READ_ONLY", approvalMode: "NONE", allowedRoles: ["admin", "veterinario", "recepcao"], requiresApproval: false, idempotency: "REQUIRED", auditAction: "patients.read", secretRefs: [], capability: "patients:read", acceptedDataClasses: ["D3"], scope: "WORKSPACE", resourceRequired: true },
  { name: "cvg.agenda.read", version: "1.0.0", description: "Consultar agenda e fila autorizadas", operation: "appointments.read", risk: "READ_ONLY", approvalMode: "NONE", allowedRoles: ["admin", "veterinario", "recepcao"], requiresApproval: false, idempotency: "REQUIRED", auditAction: "appointments.read", secretRefs: [], capability: "appointments:read", acceptedDataClasses: ["D2"], scope: "WORKSPACE", resourceRequired: false },
  { name: "cvg.clinical.draft", version: "1.0.0", description: "Gerar rascunho clínico sem alterar prontuário", operation: "clinical.draft", risk: "DRAFT", approvalMode: "NONE", allowedRoles: ["admin", "veterinario"], requiresApproval: false, idempotency: "REQUIRED", auditAction: "clinical.draft", secretRefs: [], capability: "clinical:draft", acceptedDataClasses: ["D3"], scope: "WORKSPACE", resourceRequired: true },
  { name: "cvg.communication.stage", version: "1.0.0", description: "Preparar comunicação para revisão humana", operation: "communication.stage", risk: "REVERSIBLE", approvalMode: "SAME_ACTOR", allowedRoles: ["admin", "veterinario", "recepcao"], requiresApproval: true, idempotency: "REQUIRED", auditAction: "communication.stage", secretRefs: [], capability: "communication:stage", acceptedDataClasses: ["D2"], scope: "WORKSPACE", resourceRequired: false },
  { name: "cvg.stock.dispense", version: "1.0.0", description: "Dispensar item de estoque", operation: "stock.dispense", risk: "HIGH_IMPACT", approvalMode: "INDEPENDENT", allowedRoles: ["admin", "estoque"], requiresApproval: true, idempotency: "REQUIRED", auditAction: "stock.dispense", secretRefs: [], capability: "stock:write", acceptedDataClasses: ["D2"], scope: "UNIT", resourceRequired: true },
  { name: "cvg.finance.refund", version: "1.0.0", description: "Solicitar estorno financeiro", operation: "finance.refund", risk: "HIGH_IMPACT", approvalMode: "INDEPENDENT", allowedRoles: ["admin", "financeiro"], requiresApproval: true, idempotency: "REQUIRED", auditAction: "finance.refund", secretRefs: [], capability: "finance:refund", acceptedDataClasses: ["D2"], scope: "UNIT", resourceRequired: true }
];

/** Stores Tool Gateway receipts in the canonical command-receipt map. The enclosing application transaction persists it through PostgreSQL. */
class CvgStoreToolExecutionLedger implements ToolExecutionLedger {
  constructor(private readonly store: CvgStore) {}

  claim(input: ToolExecutionLedgerInput): ToolExecutionLedgerClaim {
    const existing = this.store.commandReceipts.get(input.lookup);
    if (!existing) {
      this.store.setCommandReceipt({ id: makeId(), organizationId: input.organizationId, actorId: input.actorId, unitId: input.unitId, workspaceId: input.workspaceId, auditRecordId: null, operation: `tool.${input.operation}`, idempotencyLookup: input.lookup, bodyDigest: input.requestDigest, status: "IN_FLIGHT", result: null, createdAt: now(), completedAt: null });
      return { status: "NEW" };
    }
    if (existing.bodyDigest !== input.requestDigest) return { status: "CONFLICT" };
    if (existing.status === "SUCCEEDED" && isStoredToolRecord(existing.result)) return { status: "REPLAY", record: existing.result };
    if (existing.status === "OUTCOME_UNKNOWN") return { status: "OUTCOME_UNKNOWN" };
    if (existing.status === "IN_FLIGHT") return { status: "IN_FLIGHT" };
    return { status: "CONFLICT" };
  }

  complete(lookup: string, record: ToolExecutionLedgerRecord): void {
    const receipt = this.store.commandReceipts.get(lookup);
    if (!receipt || receipt.bodyDigest !== record.requestDigest) throw new DomainError("IDEMPOTENCY_CONFLICT", "O receipt da tool não corresponde ao digest autorizado.", 409);
    this.store.updateCommandReceipt(lookup, { status: "SUCCEEDED", result: record, completedAt: now() });
  }

  markOutcomeUnknown(lookup: string, requestDigest: string): void {
    const receipt = this.store.commandReceipts.get(lookup);
    if (receipt?.bodyDigest === requestDigest) {
      this.store.updateCommandReceipt(lookup, { status: "OUTCOME_UNKNOWN", completedAt: now() });
    }
  }

  markFailed(lookup: string, requestDigest: string): void {
    const receipt = this.store.commandReceipts.get(lookup);
    if (receipt?.bodyDigest === requestDigest) {
      this.store.updateCommandReceipt(lookup, { status: "FAILED", completedAt: now() });
    }
  }
}

function isStoredToolRecord(value: unknown): value is ToolExecutionLedgerRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ToolExecutionLedgerRecord>;
  return typeof record.requestDigest === "string" && typeof record.policyRevision === "string" && typeof record.decision === "object" && record.decision !== null && "result" in record;
}

function policyRisk(risk: ToolRisk): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (risk === "READ_ONLY") return "LOW";
  if (risk === "DRAFT") return "MEDIUM";
  if (risk === "REVERSIBLE") return "MEDIUM";
  return "CRITICAL";
}

export interface HarnessTurnResult {
  session: AiSession;
  turn: AiTurn;
  draft: AiDraft | null;
  approval: AiApproval | null;
  provenance: {
    engineCommit: string;
    manifestVersion: string;
    profileDigest: string;
    policyRevision: string;
    references: Array<{ title: string; source: string }>;
    referencesDigest?: string;
    correlationId: string;
    usageRecordId?: OpaqueId;
    provider: "local-stub";
  };
}

export interface HarnessHealth {
  engine: "READY" | "DISABLED";
  provider: "LOCAL_STUB_ONLY" | "BLOCKED";
  engineCommit: string;
  manifestVersion: string;
  tools: number;
  profileDigest: string;
}

export class GovernedHarness {
  private readonly budgetLimit = 12_000;
  private readonly profileDigest = createHash("sha256").update(JSON.stringify(TOOL_REGISTRY)).digest("hex");
  private readonly toolGateway: ToolGateway;

  constructor(private readonly store: CvgStore) {
    this.toolGateway = new ToolGateway(new StaticPolicyDecisionPoint("local-synthetic-v1"), new CvgStoreToolExecutionLedger(store));
    for (const tool of TOOL_REGISTRY) this.toolGateway.register({ ...tool, risk: policyRisk(tool.risk), timeoutMs: 5_000, egress: "LOCAL_ONLY", parseInput: (value: unknown) => value });
  }

  /** @pdp-exempt health — readiness metadata has no actor/resource/data access. */
  health(): HarnessHealth {
    return { engine: "READY", provider: "LOCAL_STUB_ONLY", engineCommit: DSH_ENGINE_COMMIT, manifestVersion: DSH_MANIFEST_VERSION, tools: TOOL_REGISTRY.length, profileDigest: this.profileDigest };
  }

  createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">): AiSession {
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.patientId ?? input.encounterId });
    this.store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:session");
    const session: AiSession = { id: makeId(), organizationId: context.organizationId, actorId: context.actorId, unitId: context.unitId, workspaceId: context.workspaceId, patientId: input.patientId, encounterId: input.encounterId, purpose: input.purpose, engineCommit: DSH_ENGINE_COMMIT, profileDigest: this.profileDigest, status: "ACTIVE", createdAt: now() };
    return this.store.persistAiSession(session);
  }

  private getOrCreateSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId" | "sessionId">): AiSession {
    this.store.validateContext(context);
    if (input.sessionId) {
      const existing = this.store.aiSessions.get(input.sessionId);
      if (!existing || existing.organizationId !== context.organizationId || existing.actorId !== context.actorId || !isInContext(existing, context) || existing.status !== "ACTIVE") throw new DomainError("NOT_FOUND", "Sessão de copiloto não encontrada.", 404);
      return existing;
    }
    return this.createSession(context, input);
  }

  async executeTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null = null): Promise<HarnessTurnResult> {
    enforceApplicationPolicy(context, `ai.turn.${input.purpose}`, { resourceId: input.resourceId ?? input.encounterId ?? input.patientId });
    const session = this.getOrCreateSession(context, input);
    if (!isInContext(session, context) || session.patientId !== input.patientId || session.encounterId !== input.encounterId || session.purpose !== input.purpose) throw new DomainError("POLICY_DENIED", "O contexto do turno não pode mudar a finalidade, o escopo, o paciente ou atendimento de uma sessão existente.", 403);
    const prompt = input.prompt;
    if (this.looksLikeInjection(prompt)) {
      const turn = this.persistTurn(context, session, prompt, "QUARANTINED", "Conteúdo retido: o texto recebido é dado não confiável e não pode alterar policy ou tools.", 0, 0, []);
      return this.result(context, session, turn, null, null, []);
    }
    const tool = input.requestedTool ? TOOL_REGISTRY.find((candidate) => candidate.name === input.requestedTool) : undefined;
    if (input.requestedTool && !tool) {
      const turn = this.persistTurn(context, session, prompt, "DENIED", "Tool não registrada no profile CVG.", 0, 0, []);
      throw new DomainError("POLICY_DENIED", "A capability solicitada não está registrada.", 403, { turnId: turn.id });
    }
    if (tool) {
      try {
        this.store.requireRole(context, tool.allowedRoles, tool.capability);
      } catch (error) {
        if (error instanceof DomainError && error.code === "FORBIDDEN") {
          const turn = this.persistTurn(context, session, prompt, "DENIED", "Role sem permissão para a capability solicitada.", 0, 0, []);
          throw new DomainError("POLICY_DENIED", "A capability não está disponível para este perfil.", 403, { turnId: turn.id });
        }
        throw error;
      }
    }
    if (tool?.requiresApproval) {
      const approval = approvalId ? this.store.aiApprovals.get(approvalId) : undefined;
      const requestDigest = this.approvalRequestDigest(context, session, input, tool.name);
      if (approvalId && (!approval || approval.organizationId !== context.organizationId || approval.actorId !== session.actorId || approval.sessionId !== session.id || approval.toolName !== tool.name || approval.resourceId !== (input.resourceId ?? input.encounterId ?? input.patientId) || approval.patientId !== input.patientId || approval.encounterId !== input.encounterId || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.purpose !== input.purpose || approval.policyRevision !== context.policyRevision || approval.requestDigest !== requestDigest || Date.parse(approval.expiresAt) <= Date.now() || approval.decidedBy === null || (tool.risk === "HIGH_IMPACT" && approval.decidedBy === approval.actorId) || approval.decision === "rejected" || approval.decision === "consumed")) {
        const turn = this.persistTurn(context, session, prompt, "DENIED", "Approval ausente, incompatível ou já consumida; nenhum dispatch foi realizado.", this.estimateInput(prompt), 0, []);
        throw new DomainError("POLICY_DENIED", "A aprovação não corresponde exatamente a esta operação ou já foi consumida.", 403, { turnId: turn.id });
      }
      if (!approval) {
        const turn = this.persistTurn(context, session, prompt, "RECEIVED", null, this.estimateInput(prompt), 0, []);
        const pending: AiApproval = { id: makeId(), organizationId: context.organizationId, actorId: context.actorId, sessionId: session.id, turnId: turn.id, toolName: tool.name, resourceId: input.resourceId ?? input.encounterId ?? input.patientId, patientId: input.patientId, encounterId: input.encounterId, unitId: context.unitId, workspaceId: context.workspaceId, purpose: input.purpose, requestDigest, policyRevision: context.policyRevision, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), decision: "unavailable", decidedBy: null, reason: "Ação exige confirmação contextual e não pode ser presumida.", createdAt: now() };
        const persistedApproval = this.store.persistAiApproval(pending);
        return this.result(context, session, turn, null, persistedApproval, []);
      }
      const originalTurn = this.store.aiTurns.get(approval.turnId);
      if (!originalTurn || originalTurn.prompt !== prompt) {
        const turn = this.persistTurn(context, session, prompt, "DENIED", "Os argumentos diferem do turno aprovado; nenhum dispatch foi realizado.", this.estimateInput(prompt), 0, []);
        throw new DomainError("POLICY_DENIED", "A aprovação está vinculada a outros argumentos.", 403, { turnId: turn.id });
      }
    }
    const estimated = this.estimateInput(prompt);
    const available = this.availableBudget(session.id);
    if (available < estimated + 400) {
      const turn = this.persistTurn(context, session, prompt, "DENIED", "Budget insuficiente antes do turno; nenhuma chamada a provider foi feita.", estimated, 0, []);
      throw new DomainError("BUDGET_EXCEEDED", "O budget disponível não cobre este turno.", 429, { available, required: estimated + 400, turnId: turn.id });
    }
    if (tool) {
      const approval = approvalId ? this.store.aiApprovals.get(approvalId) : undefined;
      try {
        await this.toolGateway.execute(tool.name, this.gatewayRequest(context, session, input, tool, approval), async (_toolInput, signal) => {
          if (signal.aborted) throw new ToolGatewayError("OUTCOME_UNKNOWN", "A execução sintética foi cancelada antes de produzir um resultado.");
          return { status: "COMPLETED", provider: "local-stub", egress: "NONE" };
        });
      } catch (error) {
        if (error instanceof ToolGatewayError) {
          const statusCode = error.code === "INVALID_INPUT" ? 400 : error.code === "APPROVAL_REQUIRED" ? 409 : error.code === "OUTCOME_UNKNOWN" || error.code === "CAPABILITY_DISABLED" ? 503 : 403;
          throw new DomainError(error.code, error.message, statusCode, error.details);
        }
        throw error;
      }
    }
    const references = [...this.store.knowledgeDocuments.values()]
      .filter((doc) => isInContext(doc, context) && doc.status === "APPROVED" && ["D0", "D1", "D2"].includes(doc.dataClass))
      .filter((doc) => !this.looksLikeInjection(`${doc.title}\n${doc.source}\n${doc.content}`))
      .slice(0, 3)
      .map((doc) => ({ title: doc.title, source: doc.source }));
    const response = this.composeSafeResponse(context, input, tool, references);
    const outputTokens = this.estimateOutput(response);
    this.consumeBudget(session, estimated + outputTokens);
    const turn = this.persistTurn(context, session, prompt, "COMPLETED", response, estimated, outputTokens, references);
    if (approvalId) {
      if (this.store.aiApprovals.has(approvalId)) this.store.updateAiApproval(approvalId, { decision: "consumed" });
    }
    let draft: AiDraft | null = null;
    if (input.purpose === "DRAFT_CLINICAL") {
      const createdDraft: AiDraft = { id: makeId(), sessionId: session.id, encounterId: input.encounterId, draftType: "CLINICAL_NOTE", content: response, sourceTurnId: turn.id, status: "DRAFT", createdAt: now() };
      draft = this.store.persistAiDraft(createdDraft);
    }
    return this.result(context, session, turn, draft, null, references);
  }

  approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null): AiApproval {
    enforceApplicationPolicy(context, "ai.approval", { resourceId: approvalId });
    this.store.requireRole(context, ["admin", "veterinario", "recepcao", "estoque", "financeiro"], "ai:approval");
   const approval = this.store.aiApprovals.get(approvalId);
   if (!approval || approval.sessionId === undefined) throw new DomainError("NOT_FOUND", "Aprovação não encontrada.", 404);
   const session = this.store.aiSessions.get(approval.sessionId);
    const tool = TOOL_REGISTRY.find((candidate) => candidate.name === approval.toolName);
    if (!tool || !session || session.organizationId !== context.organizationId || session.actorId !== approval.actorId || approval.organizationId !== context.organizationId || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.policyRevision !== context.policyRevision || Date.parse(approval.expiresAt) <= Date.now()) throw new DomainError("POLICY_DENIED", "A aprovação expirou ou não corresponde ao contexto atual.", 403);
    try {
      this.store.requireRole(context, tool.allowedRoles, tool.capability);
    } catch (error) {
      if (error instanceof DomainError && error.code === "FORBIDDEN") throw new DomainError("POLICY_DENIED", "A aprovação não corresponde à alçada atual.", 403);
      throw error;
    }
    if (tool.risk === "HIGH_IMPACT" && approval.actorId === context.actorId) throw new DomainError("POLICY_DENIED", "Ações de alto impacto exigem aprovador independente.", 403);
    if (approval.decision !== "unavailable") throw new DomainError("CONFLICT", "Aprovação já foi decidida.", 409);
    return this.store.updateAiApproval(approvalId, { decision, decidedBy: context.actorId, reason });
  }

  promoteDraft(context: CvgContext, draftId: OpaqueId): { draft: AiDraft; documentId: OpaqueId } {
    enforceApplicationPolicy(context, "ai.draft.promote", { resourceId: draftId });
    this.store.requireRole(context, ["veterinario"], "clinical:write");
    const draft = this.store.aiDrafts.get(draftId);
    if (!draft || draft.encounterId === null) throw new DomainError("NOT_FOUND", "Rascunho clínico não encontrado.", 404);
    const encounter = this.store.encounters.get(draft.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Atendimento não encontrado.", 404);
    if (draft.status !== "DRAFT" && draft.status !== "REVIEWED") throw new DomainError("CONFLICT", "Rascunho não está disponível para promoção.", 409);
    const document = this.store.createClinicalDocument(context, { encounterId: encounter.id, documentType: "EVOLUTION", title: "Rascunho do copiloto — revisão humana", content: draft.content, dataClass: "D3" });
    const promoted = this.store.updateAiDraftStatus(draftId, "PROMOTED");
    return { draft: promoted, documentId: document.id };
  }

  private persistTurn(context: CvgContext, session: AiSession, prompt: string, status: AiTurn["status"], response: string | null, inputTokens: number, outputTokens: number, references: Array<{ title: string; source: string }>): AiTurn {
    const id = makeId();
    const usageId = makeId();
    const referencesDigest = digest(references);
    const turn: AiTurn = {
      id,
      sessionId: session.id,
      prompt,
      response,
      status,
      model: "cvg-local-governed-stub",
      inputTokens,
      outputTokens,
      references,
      provenance: { provider: "local-stub", engineCommit: DSH_ENGINE_COMMIT, manifestVersion: DSH_MANIFEST_VERSION, profileDigest: this.profileDigest, policyRevision: context.policyRevision, references, referencesDigest, correlationId: context.correlationId, usageRecordId: usageId },
      usage: {
        id: usageId,
        reservationId: null,
        providerRequestId: null,
        idempotencyKey: `ai-turn:${id}`,
        usageKind: "TOKENS",
        reservedUnits: inputTokens + outputTokens,
        consumedUnits: inputTokens + outputTokens,
        status: status === "OUTCOME_UNKNOWN" ? "RECONCILIATION_REQUIRED" : "SETTLED",
        record: { kind: "AI_TURN_USAGE", turnId: id, sessionId: session.id, model: "cvg-local-governed-stub", provider: "local-stub", engineCommit: DSH_ENGINE_COMMIT, manifestVersion: DSH_MANIFEST_VERSION, profileDigest: this.profileDigest, policyRevision: context.policyRevision, correlationId: context.correlationId, referencesDigest, responseDigest: digest(response ?? "") },
        settlement: {
          model: "cvg-local-governed-stub",
          inputTokens,
          outputTokens,
          providerResponseDigest: digest({ provider: "local-stub", response: response ?? "" }),
          estimatedCost: { amountMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC", pricingRevision: "local-no-charge-v1" },
          actualCost: { amountMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC", pricingRevision: "local-no-charge-v1" },
          discrepancy: { status: "MATCHED", deltaMicros: 0, reason: null }
        }
      },
      createdAt: now()
    };
    return this.store.persistAiTurn(turn);
  }

  private result(context: CvgContext, session: AiSession, turn: AiTurn, draft: AiDraft | null, approval: AiApproval | null, references: Array<{ title: string; source: string }>): HarnessTurnResult {
    return { session, turn, draft, approval, provenance: { engineCommit: DSH_ENGINE_COMMIT, manifestVersion: DSH_MANIFEST_VERSION, profileDigest: this.profileDigest, policyRevision: context.policyRevision, references, referencesDigest: turn.provenance!.referencesDigest!, correlationId: context.correlationId, usageRecordId: turn.usage!.id, provider: "local-stub" } };
  }

  private approvalRequestDigest(context: CvgContext, session: AiSession, input: AiTurnInput, toolName: string): string {
    const descriptor = this.toolGateway.get(toolName);
    if (!descriptor) throw new DomainError("CAPABILITY_DISABLED", "A tool não está registrada no gateway.", 503);
    const request = this.gatewayRequest(context, session, input, TOOL_REGISTRY.find((candidate) => candidate.name === toolName)!, undefined);
    return toolExecutionDigest(descriptor, request, request.input);
  }

  private gatewayRequest(context: CvgContext, session: AiSession, input: AiTurnInput, tool: GovernedTool, approval: AiApproval | undefined): ToolExecutionRequest {
    const request: ToolExecutionRequest = {
      context,
      sessionId: context.sessionId!,
      resource: { organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, resourceId: input.resourceId ?? input.encounterId ?? input.patientId, dataClass: input.patientId ? "D3" : tool.acceptedDataClasses[0] ?? "D0" },
      input: { aiSessionId: session.id, prompt: input.prompt, purpose: input.purpose, patientId: input.patientId, encounterId: input.encounterId, resourceId: input.resourceId },
      idempotencyKey: input.idempotencyKey
    };
    if (approval) request.approval = { approvalId: approval.id, actorId: approval.actorId, approverId: approval.decidedBy, requestDigest: approval.requestDigest, policyRevision: approval.policyRevision, expiresAt: approval.expiresAt, oneShot: true, consumed: approval.decision === "consumed" };
    return request;
  }

  private availableBudget(sessionId: OpaqueId): number {
    return this.budgetLimit - [...this.store.budgetReservations.values()].filter((reservation) => reservation.sessionId === sessionId).reduce((sum, reservation) => sum + reservation.consumedUnits, 0);
  }

  private consumeBudget(session: AiSession, units: number): void {
    let reservation = [...this.store.budgetReservations.values()].find((candidate) => candidate.sessionId === session.id && candidate.status === "RESERVED");
    if (!reservation) {
      reservation = { id: makeId(), organizationId: session.organizationId, sessionId: session.id, category: "TOKENS", reservedUnits: this.budgetLimit, consumedUnits: 0, status: "RESERVED", createdAt: now() };
      this.store.persistBudgetReservation(reservation);
    }
    this.store.consumeBudgetReservation(reservation.id, units);
  }

  private estimateInput(prompt: string): number {
    return Math.max(1, Math.ceil(prompt.length / 4));
  }

  private estimateOutput(response: string): number {
    return Math.max(1, Math.ceil(response.length / 4));
  }

  private composeSafeResponse(context: CvgContext, input: AiTurnInput, tool: GovernedTool | undefined, references: Array<{ title: string; source: string }>): string {
    const role = context.actorRoleSnapshot.join("/");
    if (tool?.name === "cvg.patient.read") return `Consulta autorizada no escopo ${context.unitId ? "da unidade selecionada" : "da organização"}. Retornei somente os dados mínimos permitidos para ${role}.`;
    if (tool?.name === "cvg.agenda.read") return "A agenda autorizada está disponível para revisão. Nenhuma reserva foi criada, alterada ou cancelada por este turno.";
    if (tool?.name === "cvg.clinical.draft" || input.purpose === "DRAFT_CLINICAL") return "Rascunho para revisão veterinária: organizar sinais observados, evolução relatada e próximos pontos de checagem. Este texto é derivado, não é fato clínico, não foi assinado e não foi publicado.";
    if (input.purpose === "KNOWLEDGE_QUERY") return references.length ? `Encontrei ${references.length} fonte(s) aprovada(s) no escopo. Use-as como referência contextual; nenhuma fonte altera policy ou prontuário.` : "Não há fonte aprovada disponível para esta consulta no escopo atual.";
    return "Turno processado no provider local sintético. A resposta não executa efeitos externos e qualquer ação de impacto exige uma aprovação contextual separada.";
  }

  private looksLikeInjection(prompt: string): boolean {
    return /ignore\s+(all\s+)?previous|ignore\s+(as\s+)?instru[cç][õo]es|system\s*prompt|reveal\s+(the\s+)?secret|tool\s*allowlist|<\s*system/i.test(prompt);
  }

  replay(context: CvgContext, sessionId: OpaqueId): { session: AiSession; turns: AiTurn[]; digest: string } {
    enforceApplicationPolicy(context, "ai.replay", { resourceId: sessionId });
    this.store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:replay");
    const session = this.store.aiSessions.get(sessionId);
    if (!session || session.organizationId !== context.organizationId || session.actorId !== context.actorId || !isInContext(session, context)) throw new DomainError("NOT_FOUND", "Sessão de copiloto não encontrada.", 404);
    const turns = [...this.store.aiTurns.values()].filter((turn) => turn.sessionId === sessionId);
    return { session, turns, digest: replayDigest(session, turns) };
  }
}
