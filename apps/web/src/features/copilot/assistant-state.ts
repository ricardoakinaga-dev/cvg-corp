import { ApiError } from "../../api/client";

/**
 * User-facing AI states.  The UI must never collapse every failure into
 * "Erro de IA": operators need to distinguish temporary unavailability,
 * approval waiting, budget limits, policy denial and external reconciliation.
 * Confidence percentages are deliberately absent (no calibrated methodology).
 */

export type AssistantAvailability = "READY" | "AI_DEGRADED" | "DISABLED" | "UNKNOWN";

export type AssistantOutcome =
  | "READY"
  | "NEEDS_REVIEW"
  | "WAITING_APPROVAL"
  | "MISSING_INFORMATION"
  | "POLICY_BLOCKED"
  | "LIMIT_REACHED"
  | "DEPENDENCY_UNAVAILABLE"
  | "RECONCILIATION_REQUIRED"
  | "QUARANTINED";

export type PresentationTone = "teal" | "amber" | "coral" | "slate";

export interface AssistantPresentation {
  label: string;
  message: string;
  tone: PresentationTone;
}

export function availabilityFromReadiness(payload: unknown): AssistantAvailability {
  if (typeof payload !== "object" || payload === null) return "UNKNOWN";
  const record = payload as { aiState?: unknown; status?: unknown };
  const state = record.aiState ?? record.status;
  if (state === "READY") return "READY";
  if (state === "AI_DEGRADED" || state === "DEGRADED" || state === "UNAVAILABLE") return "AI_DEGRADED";
  if (state === "DISABLED") return "DISABLED";
  return "UNKNOWN";
}

export function availabilityPresentation(availability: AssistantAvailability): AssistantPresentation {
  switch (availability) {
    case "READY":
      return { label: "Assistente disponível", message: "O runtime de IA respondeu ao readiness.", tone: "teal" };
    case "AI_DEGRADED":
      return { label: "Assistente de IA indisponível", message: "O runtime está degradado ou o provider não responde. Agenda, prontuário, internação, estoque e financeiro seguem operacionais.", tone: "amber" };
    case "DISABLED":
      return { label: "Assistente de IA desativado", message: "A IA está desabilitada por configuração. Nenhuma função assistida está ativa e o núcleo permanece operacional.", tone: "slate" };
    default:
      return { label: "Estado da IA desconhecido", message: "Não foi possível confirmar o readiness de IA; trate as respostas assistidas como indisponíveis.", tone: "amber" };
  }
}

export function outcomeFromTurn(input: { status: string; approval: boolean; quarantined: boolean }): AssistantOutcome {
  if (input.quarantined || input.status === "QUARANTINED") return "QUARANTINED";
  if (input.approval || input.status === "RECEIVED") return "WAITING_APPROVAL";
  if (input.status === "DENIED") return "POLICY_BLOCKED";
  if (input.status === "OUTCOME_UNKNOWN") return "RECONCILIATION_REQUIRED";
  if (input.status === "COMPLETED") return "NEEDS_REVIEW";
  return "DEPENDENCY_UNAVAILABLE";
}

export function outcomePresentation(outcome: AssistantOutcome): AssistantPresentation {
  switch (outcome) {
    case "READY":
      return { label: "pronto", message: "Resultado disponível.", tone: "teal" };
    case "NEEDS_REVIEW":
      return { label: "revisão necessária", message: "Conteúdo derivado por IA: revise antes de promover ou assinar.", tone: "amber" };
    case "WAITING_APPROVAL":
      return { label: "aguardando aprovação", message: "Nenhum efeito foi executado; uma pessoa precisa decidir.", tone: "amber" };
    case "MISSING_INFORMATION":
      return { label: "informação ausente", message: "O runtime não adivinhou: campos obrigatórios precisam ser informados.", tone: "amber" };
    case "POLICY_BLOCKED":
      return { label: "operação não permitida", message: "A política negou a operação para este perfil, escopo ou recurso.", tone: "coral" };
    case "LIMIT_REACHED":
      return { label: "limite atingido", message: "Um limite de budget, turnos ou tempo foi atingido antes de concluir.", tone: "coral" };
    case "DEPENDENCY_UNAVAILABLE":
      return { label: "IA temporariamente indisponível", message: "O runtime ou o provider não respondeu; tente novamente depois.", tone: "coral" };
    case "RECONCILIATION_REQUIRED":
      return { label: "resultado externo em reconciliação", message: "O efeito pode ter ocorrido; nenhum retry cego será feito.", tone: "coral" };
    case "QUARANTINED":
      return { label: "conteúdo retido", message: "Texto tratado como dado não confiável; nada foi executado.", tone: "amber" };
  }
}

/** Maps API failures to the operator-facing distinctions without leaking internals. */
export function failureMessageForError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "APPROVAL_REQUIRED":
        return "Esta operação exige uma aprovação humana explícita.";
      case "APPROVAL_REPLAY":
        return "Esta aprovação já foi consumida; uma nova decisão é necessária.";
      case "BUDGET_EXCEEDED":
        return "Limite de uso de IA atingido para este escopo.";
      case "POLICY_DENIED":
        return "Operação não permitida para o perfil, escopo ou recurso atuais.";
      case "OUTCOME_UNKNOWN":
        return "Resultado externo em reconciliação; nenhum retry cego será feito.";
      case "DEPENDENCY_UNAVAILABLE":
        return "IA temporariamente indisponível. O restante do sistema continua operacional.";
      case "DENIED_STALE_FENCE":
        return "A sessão foi assumida por outra instância; este turno não pôde continuar.";
      case "ADMISSION_IN_PROGRESS":
        return "Já existe um turno em execução para esta sessão.";
      case "QUARANTINED":
        return "Conteúdo retido por segurança; nada foi executado.";
      default:
        return error.message;
    }
  }
  if (error instanceof TypeError) return "Falha de rede ao falar com o runtime de IA.";
  return error instanceof Error ? error.message : "Assistente temporariamente indisponível.";
}

export interface ApprovalLike {
  id: string;
  toolName: string;
  resourceId: string | null;
  patientId: string | null;
  encounterId: string | null;
  unitId: string | null;
  workspaceId: string | null;
  purpose: string;
  requestDigest: string;
  policyRevision: string;
  expiresAt: string;
}

export interface ApprovalPreview {
  tool: string;
  operation: string;
  effect: string;
  risk: "READ_ONLY" | "DRAFT" | "REVERSIBLE" | "HIGH_IMPACT" | "UNKNOWN";
  target: string;
  resource: string;
  scope: string;
  purpose: string;
  requestDigest: string;
  expiresAt: string;
  preview: string;
}

const TOOL_EFFECTS: Record<string, { operation: string; effect: string; risk: ApprovalPreview["risk"] }> = {
  "cvg.patient.read": { operation: "patients.read", effect: "Leitura da projeção mínima do paciente; nenhum dado é alterado.", risk: "READ_ONLY" },
  "cvg.agenda.read": { operation: "appointments.read", effect: "Leitura da agenda autorizada; nenhum agendamento é alterado.", risk: "READ_ONLY" },
  "cvg.clinical.draft": { operation: "clinical.draft", effect: "Gera um rascunho derivado; não assina e não publica prontuário.", risk: "DRAFT" },
  "cvg.communication.stage": { operation: "communication.stage", effect: "Prepara uma comunicação para revisão humana; o envio depende do fluxo de comunicação.", risk: "REVERSIBLE" },
  "cvg.stock.dispense": { operation: "stock.dispense", effect: "Dispensa item de estoque; efeito de domínio com recibo durável.", risk: "HIGH_IMPACT" },
  "cvg.finance.refund": { operation: "finance.refund", effect: "Solicita estorno financeiro; efeito de domínio com recibo durável.", risk: "HIGH_IMPACT" }
};

function short(value: string | null, size = 12): string {
  return value ? value.slice(0, size) : "não informado";
}

/** Everything a human needs to see before approving an effect. */
export function approvalPreview(approval: ApprovalLike, proposedContent: string | null): ApprovalPreview {
  const presentation = TOOL_EFFECTS[approval.toolName] ?? { operation: approval.toolName, effect: "Efeito não catalogado; trate como desconhecido e negue se não reconhecer.", risk: "UNKNOWN" as const };
  const targetKind = approval.patientId ? "paciente" : approval.encounterId ? "atendimento" : approval.resourceId ? "recurso" : "sem alvo explícito";
  const targetId = approval.patientId ?? approval.encounterId ?? approval.resourceId;
  return {
    tool: approval.toolName,
    operation: presentation.operation,
    effect: presentation.effect,
    risk: presentation.risk,
    target: `${targetKind} ${short(targetId)}`,
    resource: approval.resourceId ? short(approval.resourceId) : "não informado",
    scope: `${short(approval.unitId)} / ${short(approval.workspaceId)}`,
    purpose: approval.purpose,
    requestDigest: short(approval.requestDigest, 16),
    expiresAt: approval.expiresAt,
    preview: proposedContent && proposedContent.trim().length > 0 ? proposedContent.trim().slice(0, 400) : "sem conteúdo proposto persistido"
  };
}
