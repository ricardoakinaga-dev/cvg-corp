import { validateSnapshotSemantics, type StoreSnapshot } from "@cvg/domain";
import { PersistenceStateError } from "./persistence-errors.js";

export type RecoveryStoreState = "INTEGRATED" | "QUARANTINED" | "NOT_INTEGRATED";

export interface RecoveryStoreCoverageEntry {
  store: string;
  state: RecoveryStoreState;
  owner: string;
  notes: string;
}

/**
 * AUD13-24: explicit coverage of every store a restore must consider. A store
 * that is not integrated stays declared (quarantine or not integrated) instead
 * of being silently omitted from recovery.
 */
export const RECOVERY_STORE_COVERAGE: readonly RecoveryStoreCoverageEntry[] = [
  { store: "database", state: "INTEGRATED", owner: "persistence/postgres", notes: "snapshot, journal, ledgers e inbox/outbox no bundle cifrado" },
  { store: "object", state: "NOT_INTEGRATED", owner: "integrations/storage", notes: "sem storage de binarios; depende de D-03 (retencao/residencia)" },
  { store: "vector", state: "QUARANTINED", owner: "knowledge", notes: "indice e derivado do conteudo; nenhum vetor persistido para ressuscitar" },
  { store: "session", state: "INTEGRATED", owner: "domain/auth", notes: "restore entra em quarentena sem sessoes ativas e reconcilia revogacoes posteriores" },
  { store: "cache", state: "NOT_INTEGRATED", owner: "api", notes: "cache e volativo e purgado; nao participa do restore" },
  { store: "provider", state: "NOT_INTEGRATED", owner: "integrations", notes: "efeitos externos reconciliados por inbox/outbox; nunca retry cego" },
  { store: "telemetry", state: "NOT_INTEGRATED", owner: "ops", notes: "buffers limitados locais; nao sao estado autoritativo" },
  { store: "backup", state: "INTEGRATED", owner: "ops", notes: "manifest, watermark, retencao e digest verificados antes do restore" },
  { store: "export", state: "INTEGRATED", owner: "application/export-service", notes: "purpose/TTL/escopo/cifra com envelope verificado" }
];

export function validateRecoveryStoreCoverage(entries: readonly RecoveryStoreCoverageEntry[] = RECOVERY_STORE_COVERAGE): void {
  const required = ["database", "object", "vector", "session", "cache", "provider", "telemetry", "backup", "export"];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.store)) throw new PersistenceStateError(`recovery coverage contains duplicate store ${entry.store}`);
    seen.add(entry.store);
    if (!entry.owner || !entry.notes) throw new PersistenceStateError(`recovery coverage entry ${entry.store} requires owner and notes`);
  }
  const missing = required.filter((store) => !seen.has(store));
  if (missing.length) throw new PersistenceStateError(`recovery coverage is missing stores: ${missing.join(",")}`);
}

export type RecoveryDecision = {
  kind: "REVOKE_SESSION" | "REVOKE_ROLE" | "RESTRICT_PATIENT" | "QUARANTINE_DOCUMENT";
  resourceId: string;
  decidedAt: string;
  authorityRef: string;
};

export interface RestoreReconciliationInput {
  snapshot: StoreSnapshot;
  decisions: readonly RecoveryDecision[];
  backupWatermark: string;
  authority: { id: string; role: string; authorized: boolean };
}

export interface RestoreReconciliationResult {
  snapshot: StoreSnapshot;
  state: "READY" | "QUARANTINED";
  applied: string[];
  pending: string[];
}

/**
 * Reapplies every decision recorded after the backup watermark to a quarantined
 * restore. The snapshot only returns to READY when every decision could be
 * applied and the reconciling authority is independent from the decision
 * authors; otherwise it stays quarantined with the pending list.
 */
export function reconcileRestoredSnapshot(input: RestoreReconciliationInput): RestoreReconciliationResult {
  if (input.snapshot.healthStatus !== "QUARANTINED") throw new PersistenceStateError("restore reconciliation requires a quarantined snapshot");
  if (!input.authority.authorized || input.authority.role !== "recovery_authority") throw new PersistenceStateError("restore reconciliation requires an authorized recovery authority");
  if (input.decisions.some((decision) => decision.authorityRef === input.authority.id)) throw new PersistenceStateError("the reconciling authority must be independent from every recorded decision");
  const watermark = Date.parse(input.backupWatermark);
  if (!Number.isFinite(watermark)) throw new PersistenceStateError("backup watermark is invalid");
  const snapshot = structuredClone(input.snapshot);
  const applied: string[] = [];
  const pending: string[] = [];
  for (const decision of input.decisions) {
    const decidedAt = Date.parse(decision.decidedAt);
    if (!Number.isFinite(decidedAt)) throw new PersistenceStateError(`decision ${decision.kind}:${decision.resourceId} has an invalid timestamp`);
    if (decidedAt <= watermark) continue;
    const key = `${decision.kind}:${decision.resourceId}`;
    if (decision.kind === "REVOKE_SESSION") {
      const session = snapshot.sessions.find((candidate) => candidate.id === decision.resourceId);
      if (!session) { pending.push(key); continue; }
      if (!session.revokedAt) session.revokedAt = decision.decidedAt;
    } else if (decision.kind === "REVOKE_ROLE") {
      const assignment = snapshot.roleAssignments.find((candidate) => candidate.id === decision.resourceId);
      if (!assignment) { pending.push(key); continue; }
      if (!assignment.revokedAt) assignment.revokedAt = decision.decidedAt;
    } else if (decision.kind === "RESTRICT_PATIENT") {
      const patient = snapshot.patients.find((candidate) => candidate.id === decision.resourceId);
      if (!patient) { pending.push(key); continue; }
      patient.status = "INACTIVE";
      patient.statusChangedAt = decision.decidedAt;
    } else {
      const document = snapshot.knowledgeDocuments.find((candidate) => candidate.id === decision.resourceId);
      if (!document) { pending.push(key); continue; }
      document.status = "QUARANTINED";
    }
    applied.push(key);
  }
  if (pending.length === 0) snapshot.healthStatus = "READY";
  validateSnapshotSemantics(snapshot, (message) => { throw new PersistenceStateError(`reconciled snapshot is invalid: ${message}`); });
  return { snapshot, state: snapshot.healthStatus, applied, pending };
}
