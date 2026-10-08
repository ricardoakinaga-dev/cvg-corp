import type { PoolClient } from "pg";
import type { AuditRecord, OpaqueId } from "@cvg/contracts";
import { digest, verifyAuditChain, type StoreSnapshot } from "@cvg/domain";
import { PersistenceCorruptionError } from "./persistence-errors.js";

/** Materialize audit appends made independently of the canonical snapshot. */
export async function recoveryAuditSnapshot(client: PoolClient, snapshot: StoreSnapshot, organizationId: OpaqueId): Promise<StoreSnapshot> {
  const ledger = await client.query<{
    audit_id: string; organization_id: string; record: AuditRecord; record_digest: string;
    previous_hash: string | null; record_hash: string; chain_version: number;
  }>("select audit_id::text as audit_id, organization_id::text as organization_id, record, record_digest, previous_hash, record_hash, chain_version from cvg_audit_ledger where organization_id = cvg_request_organization() order by sequence_id");
  const records: AuditRecord[] = [];
  const byId = new Map<string, AuditRecord>();
  let previousHash: string | null = null;
  for (const row of ledger.rows) {
    const audit = row.record;
    if (!audit || typeof audit !== "object" || Array.isArray(audit)
      || row.organization_id !== organizationId || audit.organizationId !== organizationId
      || row.audit_id !== audit.id || row.record_digest !== digest(audit)
      || row.chain_version !== audit.chainVersion || row.record_hash !== audit.recordHash
      || row.previous_hash !== audit.previousHash || audit.previousHash !== previousHash
      || byId.has(audit.id)) throw new PersistenceCorruptionError("recovery audit ledger identity, digest or chain metadata diverged");
    previousHash = audit.recordHash;
    records.push(audit);
    byId.set(audit.id, audit);
  }
  try { verifyAuditChain(records); }
  catch { throw new PersistenceCorruptionError("recovery audit ledger chain is invalid"); }
  for (const audit of snapshot.auditRecords) {
    const durable = byId.get(audit.id);
    if (!durable || digest(durable) !== digest(audit)) throw new PersistenceCorruptionError("recovery audit ledger does not preserve the stored snapshot history");
  }
  // This is an export projection. The stored snapshot and its journal digest
  // remain immutable; the caller binds the materialized projection separately.
  return { ...snapshot, auditRecords: records };
}
