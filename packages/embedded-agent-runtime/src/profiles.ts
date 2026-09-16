import { createHash } from "node:crypto";
import type { DataClass } from "@cvg/contracts";

/**
 * Versioned agent profiles.  A profile declares instructions, purpose,
 * allowed tools/skills/data classes, budgets and risk limits.  Profiles never
 * grant authority: the PDP and the Tool Gateway remain the final decision.
 */

export type AgentProfileName = "ReceptionAgent" | "ClinicalAgent" | "HospitalizationAgent" | "AdministrativeAgent";

export interface AgentProfile {
  name: AgentProfileName;
  version: string;
  purposes: readonly ("SUMMARY" | "DRAFT_CLINICAL" | "KNOWLEDGE_QUERY" | "OPERATIONS")[];
  instructions: string;
  allowedTools: readonly string[];
  allowedSkills: readonly string[];
  allowedDataClasses: readonly DataClass[];
  budgets: { maxTurns: number; maxToolCalls: number; maxTokens: number; maxWallTimeMs: number; maxCostMicros: number | null; maxFailures: number };
  riskLimits: { allowReversible: boolean; allowHighImpact: boolean };
}

const RECEPTION_TOOLS = ["cvg.patient.read", "cvg.agenda.read", "cvg.communication.stage"] as const;
const CLINICAL_TOOLS = ["cvg.patient.read", "cvg.clinical.draft", "cvg.agenda.read"] as const;
const ADMIN_TOOLS = ["cvg.agenda.read", "cvg.patient.read", "cvg.communication.stage"] as const;

export const AGENT_PROFILES: readonly AgentProfile[] = [
  {
    name: "ReceptionAgent",
    version: "1.0.0",
    purposes: ["OPERATIONS", "KNOWLEDGE_QUERY"],
    instructions:
      "Você auxilia a recepção veterinária. Leia somente as projeções mínimas autorizadas, prepare comunicações para revisão humana e nunca altere agenda, prontuário, estoque ou financeiro por conta própria. Toda comunicação preparada é um rascunho aguardando decisão humana.",
    allowedTools: RECEPTION_TOOLS,
    allowedSkills: ["reception-appointment-confirmation"],
    allowedDataClasses: ["D0", "D1", "D2", "D3"],
    budgets: { maxTurns: 4, maxToolCalls: 3, maxTokens: 16_000, maxWallTimeMs: 45_000, maxCostMicros: null, maxFailures: 2 },
    riskLimits: { allowReversible: true, allowHighImpact: false }
  },
  {
    name: "ClinicalAgent",
    version: "1.0.0",
    purposes: ["DRAFT_CLINICAL", "SUMMARY", "KNOWLEDGE_QUERY"],
    instructions:
      "Você auxilia o médico veterinário. Produza rascunhos derivados (nunca fatos assinados), cite apenas conhecimento aprovado, identifique documentação faltante e sinalize incerteza. Nenhuma saída é um documento clínico válido até revisão e promoção humana.",
    allowedTools: CLINICAL_TOOLS,
    allowedSkills: ["clinical-encounter-summary"],
    allowedDataClasses: ["D0", "D1", "D2", "D3"],
    budgets: { maxTurns: 5, maxToolCalls: 4, maxTokens: 24_000, maxWallTimeMs: 60_000, maxCostMicros: null, maxFailures: 2 },
    riskLimits: { allowReversible: false, allowHighImpact: false }
  },
  {
    name: "HospitalizationAgent",
    version: "1.0.0",
    purposes: ["SUMMARY", "OPERATIONS", "KNOWLEDGE_QUERY"],
    instructions:
      "Você auxilia a internação. Prepare resumos de passagem de plantão, tarefas pendentes, exames agendados, lembretes de medicação e lacunas de documentação. Nunca altere prescrição, administração ou dispensação por conta própria.",
    allowedTools: ["cvg.patient.read", "cvg.clinical.draft"],
    allowedSkills: ["hospitalization-handoff"],
    allowedDataClasses: ["D0", "D1", "D2", "D3"],
    budgets: { maxTurns: 5, maxToolCalls: 4, maxTokens: 24_000, maxWallTimeMs: 60_000, maxCostMicros: null, maxFailures: 2 },
    riskLimits: { allowReversible: false, allowHighImpact: false }
  },
  {
    name: "AdministrativeAgent",
    version: "1.0.0",
    purposes: ["OPERATIONS", "SUMMARY", "KNOWLEDGE_QUERY"],
    instructions:
      "Você auxilia rotinas administrativas dentro do escopo autorizado. Leia apenas o mínimo necessário, nunca acesse financeiro irrestrito e nunca sintetize aprovação ou executе efeitos externos sem passar pelo fluxo governado.",
    allowedTools: ADMIN_TOOLS,
    allowedSkills: [],
    allowedDataClasses: ["D0", "D1", "D2"],
    budgets: { maxTurns: 4, maxToolCalls: 3, maxTokens: 16_000, maxWallTimeMs: 45_000, maxCostMicros: null, maxFailures: 2 },
    riskLimits: { allowReversible: true, allowHighImpact: false }
  }
];

export function selectAgentProfile(purpose: AgentProfile["purposes"][number]): AgentProfile {
  const profile = AGENT_PROFILES.find((candidate) => candidate.purposes.includes(purpose));
  return profile ?? AGENT_PROFILES[AGENT_PROFILES.length - 1]!;
}

export function profileDigest(profile: AgentProfile): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: profile.name,
        version: profile.version,
        purposes: [...profile.purposes],
        instructions: profile.instructions,
        allowedTools: [...profile.allowedTools].sort(),
        allowedSkills: [...profile.allowedSkills].sort(),
        allowedDataClasses: [...profile.allowedDataClasses],
        budgets: profile.budgets,
        riskLimits: profile.riskLimits
      })
    )
    .digest("hex");
}
