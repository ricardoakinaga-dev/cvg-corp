import type { AiTurn } from "@cvg/contracts";

export type AiTurnAuditResult = "ALLOWED" | "DENIED" | "UNKNOWN";

/**
 * Audit result for each final turn status. The record is exhaustive so a new
 * status cannot reach the audit ledger without an explicit classification.
 * OUTCOME_UNKNOWN (ledger or usage evidence unavailable) has not proven its
 * effect: it is audited as UNKNOWN and left to reconciliation, never ALLOWED.
 */
const AI_TURN_AUDIT: Readonly<Record<AiTurn["status"], { result: AiTurnAuditResult; reason: string | null }>> = {
  RECEIVED: { result: "ALLOWED", reason: null },
  COMPLETED: { result: "ALLOWED", reason: null },
  QUARANTINED: { result: "ALLOWED", reason: "untrusted content quarantined" },
  DENIED: { result: "DENIED", reason: null },
  OUTCOME_UNKNOWN: { result: "UNKNOWN", reason: "turn outcome unknown; reconciliation required" }
};

export function aiTurnAudit(status: AiTurn["status"]): { result: AiTurnAuditResult; reason: string | null } {
  return AI_TURN_AUDIT[status];
}
