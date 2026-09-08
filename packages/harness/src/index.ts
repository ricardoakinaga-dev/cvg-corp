import { createHash } from "node:crypto";
import type { AiApproval, AiDraft, AiSession, AiTurn, CvgContext, OpaqueId, Role } from "@cvg/contracts";
import type { AiTurnInput } from "@cvg/contracts";
import { CvgStore, DomainError, digest, isInContext, makeId, now } from "@cvg/domain";

export const DSH_ENGINE_COMMIT = "6454e3270642c3a7551dcae4f7447e4032febd77";
export const DSH_MANIFEST_VERSION = "0.1.1-rc.2";

export type ToolRisk = "READ_ONLY" | "DRAFT" | "REVERSIBLE" | "HIGH_IMPACT";

export interface GovernedTool {
  name: string;
  description: string;
  risk: ToolRisk;
  allowedRoles: Role[];
  requiresApproval: boolean;
  capability: string;
}

export const TOOL_REGISTRY: GovernedTool[] = [
  { name: "cvg.patient.read", description: "Ler dados mínimos de um paciente no escopo", risk: "READ_ONLY", allowedRoles: ["admin", "veterinario", "recepcao"], requiresApproval: false, capability: "patients:read" },
  { name: "cvg.agenda.read", description: "Consultar agenda e fila autorizadas", risk: "READ_ONLY", allowedRoles: ["admin", "veterinario", "recepcao"], requiresApproval: false, capability: "appointments:read" },
  { name: "cvg.clinical.draft", description: "Gerar rascunho clínico sem alterar prontuário", risk: "DRAFT", allowedRoles: ["admin", "veterinario"], requiresApproval: false, capability: "clinical:draft" },
  { name: "cvg.communication.stage", description: "Preparar comunicação para revisão humana", risk: "REVERSIBLE", allowedRoles: ["admin", "veterinario", "recepcao"], requiresApproval: true, capability: "communication:stage" },
  { name: "cvg.stock.dispense", description: "Dispensar item de estoque", risk: "HIGH_IMPACT", allowedRoles: ["admin", "estoque"], requiresApproval: true, capability: "stock:write" },
  { name: "cvg.finance.refund", description: "Solicitar estorno financeiro", risk: "HIGH_IMPACT", allowedRoles: ["admin", "financeiro"], requiresApproval: true, capability: "finance:refund" }
];

export interface HarnessTurnResult {
  session: AiSession;
  turn: AiTurn;
  draft: AiDraft | null;
  approval: AiApproval | null;
  provenance: {
    engineCommit: string;
    profileDigest: string;
    policyRevision: string;
    references: Array<{ title: string; source: string }>;
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

  constructor(private readonly store: CvgStore) {}

  health(): HarnessHealth {
    return { engine: "READY", provider: "LOCAL_STUB_ONLY", engineCommit: DSH_ENGINE_COMMIT, manifestVersion: DSH_MANIFEST_VERSION, tools: TOOL_REGISTRY.length, profileDigest: this.profileDigest };
  }

  createSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">): AiSession {
    this.store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:session");
    const session: AiSession = { id: makeId(), organizationId: context.organizationId, actorId: context.actorId, unitId: context.unitId, workspaceId: context.workspaceId, patientId: input.patientId, encounterId: input.encounterId, purpose: input.purpose, engineCommit: DSH_ENGINE_COMMIT, profileDigest: this.profileDigest, status: "ACTIVE", createdAt: now() };
    this.store.aiSessions.set(session.id, session);
    return session;
  }

  getOrCreateSession(context: CvgContext, input: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId" | "sessionId">): AiSession {
    this.store.validateContext(context);
    if (input.sessionId) {
      const existing = this.store.aiSessions.get(input.sessionId);
      if (!existing || existing.organizationId !== context.organizationId || existing.actorId !== context.actorId || !isInContext(existing, context) || existing.status !== "ACTIVE") throw new DomainError("NOT_FOUND", "Sessão de copiloto não encontrada.", 404);
      return existing;
    }
    return this.createSession(context, input);
  }

  executeTurn(context: CvgContext, input: AiTurnInput, approvalId: OpaqueId | null = null): HarnessTurnResult {
    const session = this.getOrCreateSession(context, input);
    if (!isInContext(session, context) || session.patientId !== input.patientId || session.encounterId !== input.encounterId || session.purpose !== input.purpose) throw new DomainError("POLICY_DENIED", "O contexto do turno não pode mudar a finalidade, o escopo, o paciente ou atendimento de uma sessão existente.", 403);
    const prompt = input.prompt;
    if (this.looksLikeInjection(prompt)) {
      const turn = this.persistTurn(session, prompt, "QUARANTINED", "Conteúdo retido: o texto recebido é dado não confiável e não pode alterar policy ou tools.", 0, 0, []);
      return this.result(session, turn, null, null, []);
    }
    const tool = input.requestedTool ? TOOL_REGISTRY.find((candidate) => candidate.name === input.requestedTool) : undefined;
    if (input.requestedTool && !tool) {
      const turn = this.persistTurn(session, prompt, "DENIED", "Tool não registrada no profile CVG.", 0, 0, []);
      throw new DomainError("POLICY_DENIED", "A capability solicitada não está registrada.", 403, { turnId: turn.id });
    }
    if (tool) {
      try {
        this.store.requireRole(context, tool.allowedRoles, tool.capability);
      } catch (error) {
        if (error instanceof DomainError && error.code === "FORBIDDEN") {
          const turn = this.persistTurn(session, prompt, "DENIED", "Role sem permissão para a capability solicitada.", 0, 0, []);
          throw new DomainError("POLICY_DENIED", "A capability não está disponível para este perfil.", 403, { turnId: turn.id });
        }
        throw error;
      }
    }
    if (tool?.requiresApproval) {
      const approval = approvalId ? this.store.aiApprovals.get(approvalId) : undefined;
      const requestDigest = this.approvalRequestDigest(context, session, input, tool.name);
      if (approvalId && (!approval || approval.organizationId !== context.organizationId || approval.actorId !== session.actorId || approval.sessionId !== session.id || approval.toolName !== tool.name || approval.resourceId !== (input.encounterId ?? input.patientId) || approval.patientId !== input.patientId || approval.encounterId !== input.encounterId || approval.unitId !== context.unitId || approval.workspaceId !== context.workspaceId || approval.purpose !== input.purpose || approval.policyRevision !== context.policyRevision || approval.requestDigest !== requestDigest || Date.parse(approval.expiresAt) <= Date.now() || approval.decidedBy === null || (tool.risk === "HIGH_IMPACT" && approval.decidedBy === approval.actorId) || approval.decision === "rejected" || approval.decision === "consumed")) {
        const turn = this.persistTurn(session, prompt, "DENIED", "Approval ausente, incompatível ou já consumida; nenhum dispatch foi realizado.", this.estimateInput(prompt), 0, []);
        throw new DomainError("POLICY_DENIED", "A aprovação não corresponde exatamente a esta operação ou já foi consumida.", 403, { turnId: turn.id });
      }
      if (!approval) {
        const turn = this.persistTurn(session, prompt, "RECEIVED", null, this.estimateInput(prompt), 0, []);
        const pending: AiApproval = { id: makeId(), organizationId: context.organizationId, actorId: context.actorId, sessionId: session.id, turnId: turn.id, toolName: tool.name, resourceId: input.encounterId ?? input.patientId, patientId: input.patientId, encounterId: input.encounterId, unitId: context.unitId, workspaceId: context.workspaceId, purpose: input.purpose, requestDigest, policyRevision: context.policyRevision, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), decision: "unavailable", decidedBy: null, reason: "Ação exige confirmação contextual e não pode ser presumida.", createdAt: now() };
        this.store.aiApprovals.set(pending.id, pending);
        return this.result(session, turn, null, pending, []);
      }
      const originalTurn = this.store.aiTurns.get(approval.turnId);
      if (!originalTurn || originalTurn.prompt !== prompt) {
        const turn = this.persistTurn(session, prompt, "DENIED", "Os argumentos diferem do turno aprovado; nenhum dispatch foi realizado.", this.estimateInput(prompt), 0, []);
        throw new DomainError("POLICY_DENIED", "A aprovação está vinculada a outros argumentos.", 403, { turnId: turn.id });
      }
    }
    const estimated = this.estimateInput(prompt);
    const available = this.availableBudget(session.id);
    if (available < estimated + 400) {
      const turn = this.persistTurn(session, prompt, "DENIED", "Budget insuficiente antes do turno; nenhuma chamada a provider foi feita.", estimated, 0, []);
      throw new DomainError("BUDGET_EXCEEDED", "O budget disponível não cobre este turno.", 429, { available, required: estimated + 400, turnId: turn.id });
    }
    const references = [...this.store.knowledgeDocuments.values()]
      .filter((doc) => isInContext(doc, context) && doc.status === "APPROVED" && ["D0", "D1", "D2"].includes(doc.dataClass))
      .filter((doc) => !this.looksLikeInjection(`${doc.title}\n${doc.source}\n${doc.content}`))
      .slice(0, 3)
      .map((doc) => ({ title: doc.title, source: doc.source }));
    const response = this.composeSafeResponse(context, input, tool, references);
    const outputTokens = this.estimateOutput(response);
    this.consumeBudget(session, estimated + outputTokens);
    const turn = this.persistTurn(session, prompt, "COMPLETED", response, estimated, outputTokens, references);
    if (approvalId) {
      const approval = this.store.aiApprovals.get(approvalId);
      if (approval) approval.decision = "consumed";
    }
    let draft: AiDraft | null = null;
    if (input.purpose === "DRAFT_CLINICAL") {
      const createdDraft: AiDraft = { id: makeId(), sessionId: session.id, encounterId: input.encounterId, draftType: "CLINICAL_NOTE", content: response, sourceTurnId: turn.id, status: "DRAFT", createdAt: now() };
      this.store.aiDrafts.set(createdDraft.id, createdDraft);
      draft = createdDraft;
    }
    return this.result(session, turn, draft, null, references);
  }

  approve(context: CvgContext, approvalId: OpaqueId, decision: "allowed-once" | "rejected", reason: string | null): AiApproval {
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
    approval.decision = decision;
    approval.decidedBy = context.actorId;
    approval.reason = reason;
    return approval;
  }

  promoteDraft(context: CvgContext, draftId: OpaqueId): { draft: AiDraft; documentId: OpaqueId } {
    this.store.requireRole(context, ["veterinario"], "clinical:write");
    const draft = this.store.aiDrafts.get(draftId);
    if (!draft || draft.encounterId === null) throw new DomainError("NOT_FOUND", "Rascunho clínico não encontrado.", 404);
    const encounter = this.store.encounters.get(draft.encounterId);
    if (!encounter || encounter.organizationId !== context.organizationId) throw new DomainError("NOT_FOUND", "Atendimento não encontrado.", 404);
    if (draft.status !== "DRAFT" && draft.status !== "REVIEWED") throw new DomainError("CONFLICT", "Rascunho não está disponível para promoção.", 409);
    const document = this.store.createClinicalDocument(context, { encounterId: encounter.id, documentType: "EVOLUTION", title: "Rascunho do copiloto — revisão humana", content: draft.content, dataClass: "D3" });
    draft.status = "PROMOTED";
    return { draft, documentId: document.id };
  }

  private persistTurn(session: AiSession, prompt: string, status: AiTurn["status"], response: string | null, inputTokens: number, outputTokens: number, references: Array<{ title: string; source: string }>): AiTurn {
    const turn: AiTurn = { id: makeId(), sessionId: session.id, prompt, response, status, model: "cvg-local-governed-stub", inputTokens, outputTokens, references, createdAt: now() };
    this.store.aiTurns.set(turn.id, turn);
    return turn;
  }

  private result(session: AiSession, turn: AiTurn, draft: AiDraft | null, approval: AiApproval | null, references: Array<{ title: string; source: string }>): HarnessTurnResult {
    return { session, turn, draft, approval, provenance: { engineCommit: DSH_ENGINE_COMMIT, profileDigest: this.profileDigest, policyRevision: "local-synthetic-v1", references, provider: "local-stub" } };
  }

  private approvalRequestDigest(context: CvgContext, session: AiSession, input: AiTurnInput, toolName: string): string {
    return digest({ version: 1, organizationId: context.organizationId, actorId: context.actorId, sessionId: session.id, resourceId: input.encounterId ?? input.patientId, patientId: input.patientId, encounterId: input.encounterId, unitId: context.unitId, workspaceId: context.workspaceId, purpose: input.purpose, prompt: input.prompt, toolName, policyRevision: context.policyRevision });
  }

  private availableBudget(sessionId: OpaqueId): number {
    return this.budgetLimit - [...this.store.budgetReservations.values()].filter((reservation) => reservation.sessionId === sessionId).reduce((sum, reservation) => sum + reservation.consumedUnits, 0);
  }

  private consumeBudget(session: AiSession, units: number): void {
    let reservation = [...this.store.budgetReservations.values()].find((candidate) => candidate.sessionId === session.id && candidate.status === "RESERVED");
    if (!reservation) {
      reservation = { id: makeId(), organizationId: session.organizationId, sessionId: session.id, category: "TOKENS", reservedUnits: this.budgetLimit, consumedUnits: 0, status: "RESERVED", createdAt: now() };
      this.store.budgetReservations.set(reservation.id, reservation);
    }
    reservation.consumedUnits += units;
    if (reservation.consumedUnits >= reservation.reservedUnits) reservation.status = "EXHAUSTED";
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
    this.store.requireRole(context, ["admin", "veterinario", "recepcao"], "ai:replay");
    const session = this.store.aiSessions.get(sessionId);
    if (!session || session.organizationId !== context.organizationId || session.actorId !== context.actorId || !isInContext(session, context)) throw new DomainError("NOT_FOUND", "Sessão de copiloto não encontrada.", 404);
    const turns = [...this.store.aiTurns.values()].filter((turn) => turn.sessionId === sessionId);
    return { session, turns, digest: digest({ engineCommit: session.engineCommit, profileDigest: session.profileDigest, turns }) };
  }
}
