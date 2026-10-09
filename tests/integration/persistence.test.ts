import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { id } from "@cvg/contracts";
import { CvgStore, digest, idempotent, makeId, serializeSnapshot } from "@cvg/domain";
import { GovernedHarness } from "@cvg/harness";
import { MockHarnessAdapter } from "@cvg/harness-adapters";
import { checkpointDigest } from "@cvg/agent-session";
import { createRuntime } from "@cvg/api";
import { AgentApplicationService } from "../../apps/api/src/application/agent-service.ts";
import { PersistenceProductSkuConflictError } from "@cvg/persistence";
import { createReadApplicationService } from "../../apps/api/src/application/read-services.ts";
import { ExportApplicationService } from "../../apps/api/src/application/export-service.ts";
import { assertRestorableRecoveryBundle, AUD27_SNAPSHOT_PRIMARY_KEYS, AUTHORITATIVE_DOMAIN_REGISTRY, buildAud27NormalizedWritePlan, createRecoveryBundleManifest, decryptRecoveryBundle, encryptRecoveryBundle, OperationalBackupJob, OutboxLeaseLostError, PersistenceConflictError, PersistenceCorruptionError, PersistenceStateError, PersistenceUnavailableError, PostgresPersistence, rotateOperationalBackups, validateAuthoritativeSnapshot, validateRecoveryBundle, verifyOperationalBackupDirectory, verifyOperationalBackupFile, writeOperationalBackup, type Aud27NormalizedDomainWrite, type DurableAgentCheckpointRecord, type DurableAgentLeaseRecord, type DurableAgentSessionRecord, type DurableAgentTurnRecord, type DurableExternalEffectRecord, type DurableInboxInput, type DurableInboxRecord, type DurableOutboxRecord, type DurableRecoveryBundle, type DurableRestoreInput, type DurableUsageRecord, type DurableWorkerJobRecord } from "@cvg/persistence";

type QueryResult = { rows: Array<Record<string, unknown>> };

function fakePool(options: { revision?: string; failSnapshotInsert?: boolean; failSnapshotInsertAfter?: number; failOnSecondConnectionBegin?: boolean; auditLedgerConflict?: boolean; clinicalSignUpdateRows?: boolean; guardianWriteRows?: boolean; diagnosticRequestWriteRows?: boolean; specimenWriteRows?: boolean; diagnosticResultWriteRows?: boolean; productWriteRows?: boolean; productSkuConflict?: boolean; recoveredProjectionRows?: boolean; migrationRows?: Array<{ version: string; checksum: string }>; sessionUser?: string; currentUser?: string; tableOwner?: string | null; restoreRoleExists?: boolean; restoreRoleLogin?: boolean; restoreRoleSuperuser?: boolean; restoreRoleBypassRls?: boolean; restoreRoleInherit?: boolean; restoreRoleCreatedb?: boolean; restoreRoleCreateRole?: boolean; restoreRoleReplication?: boolean; schemaOwnerCanAssumeRestore?: boolean; runtimeCanAssumeRestore?: boolean } = {}): { pool: Pool; statements: string[]; productStatements: Array<{ sql: string; params: unknown[] }>; durableReceipts: Map<string, Record<string, unknown>>; connectCount: number; releaseCount: number } {
  let revision = options.revision ?? "0";
  let snapshotInsertCount = 0;
  let latestSnapshot: { revision: string; snapshot: unknown; snapshot_digest: string } | null = null;
  let currentOrganizationId: string | null = null;
  let transactionProductCount: number | null = null;
  let auditTail: string | null = null;
  const durableReceipts = new Map<string, Record<string, unknown>>();
  let transactionReceiptBackup: Map<string, Record<string, unknown>> | null = null;
  let transactionRevisionBackup: string | null = null;
  let transactionOrganizationBackup: string | null = null;
  let connectCount = 0;
  let releaseCount = 0;
  const statements: string[] = [];
  const productStatements: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      if (sql.includes("set_config('cvg.organization_id'")) currentOrganizationId = String(params[0]);
      if (sql.trim().startsWith("insert into products")) productStatements.push({ sql: sql.trim().replace(/\s+/g, " "), params: [...params] });
      if (sql.trim() === "BEGIN") {
        transactionReceiptBackup = new Map([...durableReceipts.entries()].map(([key, value]) => [key, { ...value }]));
        transactionRevisionBackup = revision;
        transactionOrganizationBackup = currentOrganizationId;
        transactionProductCount = productStatements.length;
      }
      if (sql.trim() === "COMMIT") {
        currentOrganizationId = transactionOrganizationBackup;
        transactionReceiptBackup = null;
        transactionRevisionBackup = null;
        transactionOrganizationBackup = null;
        transactionProductCount = null;
      }
      if (sql.trim() === "ROLLBACK") {
        if (transactionReceiptBackup) {
          durableReceipts.clear();
          for (const [key, value] of transactionReceiptBackup) durableReceipts.set(key, { ...value });
        }
        if (transactionRevisionBackup !== null) revision = transactionRevisionBackup;
        if (latestSnapshot && transactionRevisionBackup !== null && latestSnapshot.revision !== transactionRevisionBackup) latestSnapshot = null;
        if (transactionProductCount !== null) productStatements.length = transactionProductCount;
        currentOrganizationId = transactionOrganizationBackup;
        transactionReceiptBackup = null;
        transactionRevisionBackup = null;
        transactionOrganizationBackup = null;
        transactionProductCount = null;
      }
      if (options.productSkuConflict && sql.startsWith("insert into products") && sql.includes("returning id::text")) {
        throw Object.assign(new Error("duplicate key value violates unique constraint products_organization_id_sku_key"), { code: "23505", constraint: "products_organization_id_sku_key" });
      }
      if (sql.includes("schema_owner_can_assume_restore")) return { rows: [{ session_user: options.sessionUser ?? "cvg_schema_owner", current_user: options.currentUser ?? "cvg_schema_owner", table_owner: options.tableOwner === undefined ? "cvg_schema_owner" : options.tableOwner, restore_role_exists: options.restoreRoleExists ?? true, restore_role_login: options.restoreRoleLogin ?? false, restore_role_superuser: options.restoreRoleSuperuser ?? false, restore_role_bypassrls: options.restoreRoleBypassRls ?? false, restore_role_inherit: options.restoreRoleInherit ?? false, restore_role_createdb: options.restoreRoleCreatedb ?? false, restore_role_createrole: options.restoreRoleCreateRole ?? false, restore_role_replication: options.restoreRoleReplication ?? false, schema_owner_can_assume_restore: options.schemaOwnerCanAssumeRestore ?? true, runtime_can_assume_restore: options.runtimeCanAssumeRestore ?? false }] };
      if (sql.startsWith("select version, checksum from schema_migrations")) return { rows: options.migrationRows ?? [] };
      if (sql.includes("select revision::text")) return { rows: revision === "0" ? [] : [latestSnapshot && latestSnapshot.revision === revision ? { revision, snapshot: latestSnapshot.snapshot, snapshot_digest: latestSnapshot.snapshot_digest } : { revision }] };
      if (options.recoveredProjectionRows && sql.startsWith("insert into outbox_records")) return { rows: [{ id: String(params[0]) }] };
      if (options.recoveredProjectionRows && sql.startsWith("insert into cvg_worker_jobs")) return { rows: [{ id: String(params[0]) }] };
      if (options.recoveredProjectionRows && sql.startsWith("insert into integration_inbox_records")) return { rows: [{ id: String(params[0]) }] };
      if (options.recoveredProjectionRows && sql.startsWith("insert into external_effects")) return { rows: [{ id: String(params[0]) }] };
      if (options.recoveredProjectionRows && sql.startsWith("insert into agent_sessions")) return { rows: [{ session_id: String(params[0]) }] };
      if (options.recoveredProjectionRows && sql.startsWith("insert into agent_turns")) return { rows: [{ turn_id: String(params[0]) }] };
      if (options.recoveredProjectionRows && sql.startsWith("insert into agent_checkpoints")) return { rows: [{ checkpoint_id: "synthetic-checkpoint" }] };
      if (sql.startsWith("insert into ai_usage_ledger")) return { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("insert into guardians") && sql.includes("returning id::text")) return options.guardianWriteRows === false ? { rows: [] } : { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("insert into diagnostic_requests") && sql.includes("returning id::text")) return options.diagnosticRequestWriteRows === false ? { rows: [] } : { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("insert into specimens") && sql.includes("returning id::text")) return options.specimenWriteRows === false ? { rows: [] } : { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("insert into diagnostic_results") && sql.includes("returning id::text")) return options.diagnosticResultWriteRows === false ? { rows: [] } : { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("insert into patients") && sql.includes("returning id::text")) return { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("insert into products") && sql.includes("returning id::text")) return options.productWriteRows === false ? { rows: [] } : { rows: [{ id: String(params[0]) }] };
      if (sql.includes('organization_id::text as "organizationId"') && sql.startsWith("select id::text as id")) {
        const latest = new Map<string, Record<string, unknown>>();
        for (const { params: productParams } of productStatements) {
          if (currentOrganizationId && String(productParams[1]) !== currentOrganizationId) continue;
          latest.set(String(productParams[0]), { id: String(productParams[0]), organizationId: String(productParams[1]), sku: String(productParams[2]), name: String(productParams[3]), category: String(productParams[4]), unit: String(productParams[5]), reorderPoint: Number(productParams[6]), status: String(productParams[7]) });
        }
        return { rows: [...latest.values()].sort((left, right) => String(left.id).localeCompare(String(right.id))) };
      }
      if (sql.startsWith("select id::text as id, organization_id::text as organization_id, sku, name, category, unit, reorder_point, status from products")) {
        const write = [...productStatements].reverse().find(({ params: productParams }) => productParams[0] === params[0] && productParams[1] === params[1]);
        return write ? { rows: [{ id: String(write.params[0]), organization_id: String(write.params[1]), sku: String(write.params[2]), name: String(write.params[3]), category: String(write.params[4]), unit: String(write.params[5]), reorder_point: Number(write.params[6]), status: String(write.params[7]) }] } : { rows: [] };
      }
      if (sql.startsWith("insert into appointments") && sql.includes("returning id::text")) return { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("insert into encounters") && sql.includes("returning id::text")) return { rows: [{ id: String(params[0]) }] };
      if (sql.startsWith("update clinical_documents") && sql.includes("returning id::text")) return options.clinicalSignUpdateRows === false ? { rows: [] } : { rows: [{ id: String(params[4]) }] };
      if (sql.startsWith("insert into command_receipts") && sql.includes("on conflict (idempotency_lookup)")) {
        const lookup = String(params[6]);
        const existing = durableReceipts.get(lookup);
        if (existing) return { rows: [] };
        const row = { id: String(params[0]), organization_id: String(params[1]), actor_id: String(params[2]), unit_id: params[3] ?? null, workspace_id: params[4] ?? null, audit_record_id: null, operation: String(params[5]), idempotency_lookup: lookup, body_digest: String(params[7]), status: "IN_FLIGHT", result: null, created_at: String(params[8]), completed_at: null, claim_epoch: Number(params[9]), claim_expires_at: params[10] ?? null, dispatch_state: String(params[11]), failure_phase: null };
        durableReceipts.set(lookup, row);
        return { rows: [row] };
      }
      if (sql.startsWith("select id::text as id") && sql.includes("from command_receipts") && sql.includes("idempotency_lookup = $1")) {
        const row = durableReceipts.get(String(params[0]));
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith("select id::text as id") && sql.includes("from command_receipts") && sql.includes("and id = $1")) {
        const row = [...durableReceipts.values()].find((candidate) => candidate.id === String(params[0]));
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith("update command_receipts set dispatch_state")) {
        const row = [...durableReceipts.values()].find((candidate) => candidate.id === String(params[0]));
        if (!row || row.status !== "IN_FLIGHT" || Number(row.claim_epoch) !== Number(params[1]) || typeof row.claim_expires_at !== "string" || Date.parse(row.claim_expires_at) <= Date.now()) return { rows: [] };
        row.dispatch_state = "DISPATCHED";
        return { rows: [row] };
      }
      if (sql.startsWith("update command_receipts set status = case when dispatch_state") && sql.includes("where id = $1")) {
        const row = [...durableReceipts.values()].find((candidate) => candidate.id === String(params[0]));
        if (!row || row.status !== "IN_FLIGHT" || Number(row.claim_epoch) !== Number(params[1])) return { rows: [] };
        row.status = row.dispatch_state === "DISPATCHED" ? "OUTCOME_UNKNOWN" : String(params[2]);
        row.completed_at = params[3];
        row.claim_expires_at = null;
        row.failure_phase = row.dispatch_state === "DISPATCHED" ? "POST_DISPATCH" : params[4];
        return { rows: [row] };
      }
      if (sql.startsWith("update command_receipts set status = case when dispatch_state") && sql.includes("where id = $3")) {
        const row = [...durableReceipts.values()].find((candidate) => candidate.id === String(params[2]));
        if (!row || row.status !== "IN_FLIGHT" || Number(row.claim_epoch) !== Number(params[10])) return { rows: [] };
        row.status = row.dispatch_state === "DISPATCHED" ? "OUTCOME_UNKNOWN" : String(params[0]);
        row.completed_at = params[1];
        row.claim_expires_at = null;
        row.failure_phase = row.dispatch_state === "DISPATCHED" ? "POST_DISPATCH" : params[9];
        return { rows: [row] };
      }
      if (sql.startsWith("update command_receipts") && sql.includes("returning id::text")) {
        const row = [...durableReceipts.values()].find((candidate) => candidate.id === String(params[2]));
        if (!row || row.status !== "IN_FLIGHT") return { rows: [] };
        row.status = String(params[0]);
        row.completed_at = params[1];
        return { rows: [row] };
      }
      if (sql.startsWith("select record_hash from cvg_audit_ledger")) return { rows: auditTail ? [{ record_hash: auditTail }] : [] };
      if (sql.startsWith("insert into cvg_audit_ledger")) {
        if (options.auditLedgerConflict) return { rows: [] };
        auditTail = String(params[5]);
        return { rows: [{ audit_id: String(params[0]) }] };
      }
      if (sql.startsWith("insert into command_receipts")) {
        const lookup = String(params[7]);
        const row = durableReceipts.get(lookup);
        if (row) {
          const incomingResult = params[10] === null ? null : typeof params[10] === "string" ? JSON.parse(params[10]) : params[10];
          const sameTerminal = row.status === String(params[9]) && JSON.stringify(row.result) === JSON.stringify(incomingResult);
          const liveClaim = typeof row.claim_expires_at === "string" && Date.parse(row.claim_expires_at) > Date.now();
          if (Number(row.claim_epoch) !== Number(params[13]) || row.dispatch_state !== String(params[15]) || (row.status === "IN_FLIGHT" && !liveClaim) || (row.status !== "IN_FLIGHT" && !sameTerminal)) return { rows: [] };
          row.audit_record_id = params[5] ?? null;
          row.status = String(params[9]);
          row.result = incomingResult;
          row.completed_at = params[12] ?? null;
          row.claim_epoch = Number(params[13]);
          row.claim_expires_at = params[14] ?? null;
          row.dispatch_state = String(params[15]);
          row.failure_phase = params[16] ?? null;
        }
        return { rows: [{ id: String(params[0]) }] };
      }
      if (sql.startsWith("insert into cvg_command_receipt_ledger")) return { rows: [{ receipt_id: String(params[0]) }] };
      if (sql.startsWith("insert into cvg_state_snapshots")) {
        snapshotInsertCount += 1;
        if (options.failSnapshotInsert || (options.failSnapshotInsertAfter !== undefined && snapshotInsertCount >= options.failSnapshotInsertAfter)) throw new Error("synthetic snapshot write failure");
        revision = String(params[0]);
        latestSnapshot = { revision: String(params[0]), snapshot: JSON.parse(String(params[4])), snapshot_digest: String(params[5]) };
      }
      return { rows: [] };
    },
    release(): void { releaseCount += 1; }
  } as unknown as PoolClient;
  const pool = {
    async query(sql: string): Promise<QueryResult> {
      const normalized = sql.trim().replace(/\s+/g, " ");
      statements.push(normalized);
      if (sql.includes("current_database()")) return { rows: [{ database: "cvg_synthetic", server_version: "16.0" }] };
      if (sql.includes("to_regclass('public.cvg_state_snapshots')")) return { rows: [{ snapshots: true, journal: true, audit: true, receipts: true, communications: true, outbox: true, usage_ledger: true, inbox: true, external_effects: true, rate_limit_buckets: true, break_glass_grants: true, break_glass_lifecycle: true, break_glass_scope_schema: true, runtime_role: true, runtime_migration_metadata: true, runtime_scope_guards: true, auth_security: true, ai_turn_scope: true, ai_draft_scope: true, ai_turn_provenance_usage: true, audit_tamper_evident_chain: true, append_only_audit_guard: true, append_only_lock_privileges: true, worker_jobs: true, worker_heartbeats: true, worker_lane_schema: true, command_receipt_claim_fence: true }] };
      if (sql.includes("034_diagnostic_child_integrity_backstop")) return { rows: [{ diagnostic_child_scope: true }] };
      if (sql.includes("as agent_runtime_schema")) return { rows: [{ agent_runtime_schema: true }] };
      if (sql.includes("as snapshot_scope_revision")) return { rows: [{ snapshot_scope_revision: true }] };
      if (sql.includes("from cvg_state_snapshots s")) return { rows: [] };
      if (sql.includes("select revision::text as revision")) return { rows: revision === "0" ? [] : [latestSnapshot && latestSnapshot.revision === revision ? { revision, snapshot: latestSnapshot.snapshot, snapshot_digest: latestSnapshot.snapshot_digest } : { revision }] };
      return { rows: [] };
    },
    connect: async (): Promise<PoolClient> => {
      connectCount += 1;
      if (options.failOnSecondConnectionBegin && connectCount > 1) {
        return {
          ...client,
          async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
            if (sql.trim() === "BEGIN") throw new Error("synthetic split-client transaction boundary");
            return client.query(sql, params);
          }
        } as unknown as PoolClient;
      }
      return client;
    }
  } as unknown as Pool;
  return { pool, statements, productStatements, durableReceipts, get connectCount() { return connectCount; }, get releaseCount() { return releaseCount; } };
}

function commitInput(store: CvgStore) {
  return {
    expectedRevision: null,
    snapshot: store.snapshot(),
    eventType: "BOOTSTRAP" as const,
    operation: "test.bootstrap",
    organizationId: store.bootstrapCredentials.organizationId,
    actorId: null,
    correlationId: "persistence-test",
    aggregateType: "Organization",
    aggregateId: store.bootstrapCredentials.organizationId,
    payload: { synthetic: true }
  };
}

function diagnosticFixture(store: CvgStore, suffix: string) {
  const vetId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  if (!vetId) throw new Error("synthetic diagnostic fixture has no veterinarian");
  const option = store.contextOptions(vetId)[0];
  if (!option) throw new Error("synthetic diagnostic fixture has no context");
  const scope = { unitId: option.unit.id, workspaceId: option.workspace.id };
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === scope.unitId && candidate.workspaceId === scope.workspaceId);
  if (!patient) throw new Error("synthetic diagnostic fixture has no patient");
  const encounter = store.createEncounter(store.resolveContext(vetId, scope, "encounters.create", `${suffix}-encounter`), { patientId: patient.id, appointmentId: null, chiefComplaint: `fixture ${suffix}`, urgency: "ROUTINE" });
  const request = store.createDiagnosticRequest(store.resolveContext(vetId, scope, "diagnostics.create", `${suffix}-request`), { patientId: patient.id, encounterId: encounter.id, testName: `exame ${suffix}`, priority: "ROUTINE" });
  const context = store.resolveContext(vetId, scope, "diagnostics.specimen", `${suffix}-command`);
  return { context, encounter, request };
}

function normalizedReadPool(options: { aiStatus?: unknown; auditMetadata?: unknown; auditChainVersion?: number; clinicalStatus?: unknown; communicationStatus?: unknown; diagnosticStatus?: unknown; financeStatus?: unknown; knowledgeStatus?: unknown; queueStatus?: unknown; stockStatus?: unknown; unitId?: string | null; workspaceId?: string | null } = {}): { pool: Pool; statements: string[]; scope: { organizationId: string | null } } {
  const statements: string[] = [];
  const scope = { organizationId: null as string | null };
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      if (sql.includes("set_config('cvg.organization_id'")) scope.organizationId = String(params[0]);
      if (sql.startsWith("select g.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000101", display_name: "Marina Souza", phone: "+55 11 98888-1200", email: "marina@example.test", data_class: "D2", status: "ACTIVE" }] };
      if (sql.includes("from payments p")) return { rows: [{ id: "00000000-0000-4000-0000-000000000331", organization_id: scope.organizationId, charge_id: "00000000-0000-4000-0000-000000000321", scope_unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", amount_cents: 22000, method: "PIX", external_reference: null, status: "SETTLED", created_at: "2026-01-01T18:00:00.000Z" }] };
      if (sql.startsWith("select p.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000111", guardian_id: "00000000-0000-4000-0000-000000000101", name: "Luna", species: "Canina", breed: "Golden retriever", sex: "FEMALE", reproductive_status: "NEUTERED", birth_date: "2020-05-19", identifiers: ["MICRO-9812"], data_class: "D3", status: "ACTIVE", merged_into_id: null, status_changed_at: null, created_at: "2026-01-01T00:00:00.000Z", guardian_display_name: "Marina Souza", guardian_phone: "+55 11 98888-1200" }] };
      if (sql.startsWith("select e.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000171", organization_id: scope.organizationId, unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021", patient_id: "00000000-0000-4000-0000-000000000111", appointment_id: null, chief_complaint: "retorno clínico", urgency: "ROUTINE", status: "OPEN", opened_at: "2026-01-01T11:00:00.000Z", closed_at: null, patient_name: "Luna" }] };
      if (sql.startsWith("select q.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000371", organization_id: scope.organizationId, unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", appointment_id: "00000000-0000-4000-0000-000000000151", patient_id: "00000000-0000-4000-0000-000000000111", status: options.queueStatus ?? "WAITING", priority: "URGENT", checked_in_at: "2026-01-01T10:00:00.000Z", appointment_workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021", patient_name: "Luna" }] };
      if (sql.includes("from knowledge_documents d")) return { rows: [{ id: "00000000-0000-4000-0000-000000000351", organization_id: scope.organizationId, unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021", title: "Protocolo sintético", source: "fixture sintética", data_class: "D1", version: 1, status: options.knowledgeStatus ?? "APPROVED", content: "conteúdo de conhecimento", created_at: "2026-01-01T19:00:00.000Z" }] };
      if (sql.startsWith("select s.id::text") && sql.includes("from ai_sessions s")) return { rows: [{ id: "00000000-0000-4000-0000-000000000381", organization_id: scope.organizationId, actor_id: "00000000-0000-4000-8000-000000000001", unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021", patient_id: null, encounter_id: null, purpose: "SUMMARY", engine_commit: "synthetic-engine", profile_digest: "synthetic-profile", status: options.aiStatus ?? "ACTIVE", created_at: "2026-01-01T20:00:00.000Z", turn_count: 2 }] };
      if (sql.startsWith("select d.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000181", organization_id: scope.organizationId, unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021", encounter_id: "00000000-0000-4000-0000-000000000171", patient_id: "00000000-0000-4000-0000-000000000111", author_id: "00000000-0000-4000-0000-000000000002", document_type: "EVOLUTION", title: "Evolução sintética", content: "conteúdo protegido", data_class: "D3", status: options.clinicalStatus ?? "DRAFT", version: 1, signed_at: null, signed_by: null, created_at: "2026-01-01T12:00:00.000Z" }] };
      if (sql.startsWith("select r.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000191", organization_id: scope.organizationId, patient_id: "00000000-0000-4000-0000-000000000111", encounter_id: "00000000-0000-4000-0000-000000000171", test_name: "Hemograma sintético", priority: "ROUTINE", status: options.diagnosticStatus ?? "REQUESTED", requested_by: "00000000-0000-4000-0000-000000000002", created_at: "2026-01-01T13:00:00.000Z", unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021" }] };
      if (sql.startsWith("select s.id::text") && sql.includes("from specimens s")) return { rows: [{ id: "00000000-0000-4000-0000-000000000192", organization_id: scope.organizationId, request_id: "00000000-0000-4000-0000-000000000191", patient_id: "00000000-0000-4000-0000-000000000111", label: "LUNA-HEM-001", collected_at: "2026-01-01T14:00:00.000Z", status: "COLLECTED", unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021" }] };
      if (sql.startsWith("select dr.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000193", organization_id: scope.organizationId, request_id: "00000000-0000-4000-0000-000000000191", specimen_id: "00000000-0000-4000-0000-000000000192", patient_id: "00000000-0000-4000-0000-000000000111", value: "sem alterações", source: "laboratório sintético", source_version: "synthetic-1", status: "VALID", created_at: "2026-01-01T15:00:00.000Z", unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021" }] };
      if (sql.startsWith("select b.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000201", organization_id: scope.organizationId, unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", name: "Canil 01", status: "AVAILABLE" }] };
      if (sql.startsWith("select h.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000211", organization_id: scope.organizationId, unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", patient_id: "00000000-0000-4000-0000-000000000111", encounter_id: "00000000-0000-4000-0000-000000000171", bed_id: "00000000-0000-4000-0000-000000000201", status: "ADMITTED", admitted_at: "2026-01-01T16:00:00.000Z", discharged_at: null }] };
      if (sql.includes("from communication_messages m")) return { rows: [{ id: "00000000-0000-4000-0000-000000000361", organization_id: scope.organizationId, unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021", patient_id: "00000000-0000-4000-0000-000000000111", channel: "SMS", recipient: "+55 11 98888-1200", template: "retorno", body: "Lembrete sintético", status: options.communicationStatus ?? "APPROVAL_REQUIRED", created_by: "00000000-0000-4000-0000-000000000002", decided_by: null, decided_at: null, approved_by: null, approved_at: null, decision_reason: null, created_at: "2026-01-01T17:00:00.000Z" }] };
      if (sql.startsWith("select m.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000221", organization_id: scope.organizationId, patient_id: "00000000-0000-4000-0000-000000000111", encounter_id: "00000000-0000-4000-0000-000000000171", product_id: "00000000-0000-4000-0000-000000000301", dose: "1 comprimido", route: "oral", frequency: "12/12h", status: "ACTIVE", prescribed_by: "00000000-0000-4000-0000-000000000002", unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", workspace_id: options.workspaceId ?? "00000000-0000-8000-0000-000000000021", product_name: "Antibiótico sintético", product_unit: "comprimido" }] };
      if (sql.includes("from ledger_entries l")) return { rows: [{ id: "00000000-0000-4000-0000-000000000341", organization_id: scope.organizationId, kind: "CHARGE", reference_id: "00000000-0000-4000-0000-000000000321", amount_cents: 22000, currency: "BRL", description: "Consulta clínica", created_at: "2026-01-01T18:00:00.000Z", scope_unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011" }] };
      if (sql.startsWith("select l.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000311", organization_id: scope.organizationId, product_id: "00000000-0000-4000-0000-000000000301", lot_number: "LOT-001", expires_on: "2027-01-01", quantity: 12, location_id: "00000000-0000-4000-0000-000000000321", status: options.stockStatus ?? "AVAILABLE", product_sku: "SKU-001", product_name: "Antibiótico sintético", product_category: "medicação", product_unit: "comprimido", product_reorder_point: 2, product_status: "ACTIVE", location_unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", location_name: "Farmácia — Centro" }] };
      if (sql.startsWith("select c.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000321", organization_id: scope.organizationId, unit_id: options.unitId ?? "00000000-0000-8000-0000-000000000011", patient_id: "00000000-0000-4000-0000-000000000111", description: "Consulta clínica", amount_cents: 22000, currency: "BRL", status: options.financeStatus ?? "OPEN", created_at: "2026-01-01T18:00:00.000Z" }] };
      if (sql.includes("from audit_records a")) return { rows: [{ id: "00000000-0000-4000-0000-000000000161", organization_id: scope.organizationId, actor_id: "00000000-0000-4000-0000-000000000001", unit_id: "00000000-0000-4000-0000-000000000011", workspace_id: "00000000-0000-4000-0000-000000000021", action: "patients.read", resource_type: "AnimalPatient", resource_id: "00000000-0000-4000-0000-000000000111", result: "ALLOWED", reason: null, correlation_id: "audit-read", metadata: options.auditMetadata ?? { count: 1 }, chain_version: options.auditChainVersion ?? 2, previous_hash: null, record_hash: "audit-hash", created_at: "2026-01-01T00:00:00.000Z" }] };
      if (sql.startsWith("select a.id::text")) return { rows: [{ id: "00000000-0000-4000-0000-000000000151", organization_id: "00000000-0000-4000-0000-000000000010", unit_id: "00000000-0000-4000-0000-000000000011", workspace_id: "00000000-0000-4000-0000-000000000021", patient_id: "00000000-0000-4000-0000-000000000111", provider_id: "00000000-0000-4000-0000-000000000121", resource_id: null, service_id: "00000000-0000-4000-0000-000000000131", starts_at: "2026-01-01T10:00:00.000Z", ends_at: "2026-01-01T10:45:00.000Z", purpose: "Retorno", status: "CONFIRMED", version: 1, created_at: "2026-01-01T00:00:00.000Z", patient_name: "Luna", provider_name: "Dra. Ana Martins" }] };
      return { rows: [] };
    },
    release(): void { /* no-op fake */ }
  } as unknown as PoolClient;
  return { pool: { connect: async (): Promise<PoolClient> => client } as unknown as Pool, statements, scope };
}

test("Postgres persistence commits journal and snapshot atomically", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const audit = store.recordAudit({ organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, unitId: null, workspaceId: null, action: "test.command", resourceType: "Fixture", resourceId: null, result: "ALLOWED", reason: null, correlationId: "persistence-test", metadata: {} });
  const command = idempotent(store, { organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, operation: "test.command", key: "persistence-command", resourceId: null, unitId: null, workspaceId: null, body: { value: 1 } }, () => ({ ok: true }));
  command.receipt.auditRecordId = audit.id;
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const snapshot = store.snapshot();
  const result = await persistence.commit({ ...commitInput(store), snapshot, auditRecords: snapshot.auditRecords, commandReceipts: snapshot.commandReceipts });
  assert.equal(result.revision, 1n);
  assert.equal(result.snapshotDigest, digest(JSON.parse(serializeSnapshot(store.snapshot()))));
  assert.ok(fake.statements.some((statement) => statement === "BEGIN"));
  assert.ok(fake.statements.some((statement) => statement.includes("order by cvg_state_snapshots.revision desc")));
  assert.ok(fake.statements.some((statement) => statement.includes("set_config('cvg.organization_id'")));
  assert.ok(fake.statements.some((statement) => statement.includes("where organization_id = cvg_request_organization()")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_event_journal")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into audit_records")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into command_receipts")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_audit_ledger")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_command_receipt_ledger")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_state_snapshots")));
  assert.ok(fake.statements.some((statement) => statement === "COMMIT"));
});

test("snapshot projector exercises seeded residual rows without command-owned overrides", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot() });

  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into products")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into providers")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into knowledge_documents")));
});

test("AUD27 normalized projection writes every residual collection through its owner", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const baseline = store.snapshot();
  const veterinarian = [...store.users.values()].find((user) => user.login.startsWith("ana."));
  assert.ok(veterinarian);
  const option = store.contextOptions(veterinarian.id)[0];
  assert.ok(option);
  const context = store.resolveContext(veterinarian.id, { unitId: option.unit.id, workspaceId: option.workspace.id }, "aud27.normalized-writes", "aud27-normalized-writes");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  const bed = [...store.beds.values()].find((candidate) => candidate.unitId === context.unitId);
  assert.ok(patient);
  assert.ok(bed);

  const encounter = store.createEncounter(context, { patientId: patient.id, appointmentId: null, chiefComplaint: "AUD27 cobertura", urgency: "ROUTINE" });
  const document = store.createClinicalDocument(context, { encounterId: encounter.id, documentType: "EVOLUTION", title: "AUD27 cobertura", content: "conteúdo sintético", dataClass: "D3" });
  store.reviewClinicalDocument(context, document.id, null);
  store.signClinicalDocument(context, document.id, null);
  store.addClinicalAddendum(context, document.id, "qualificação", "adendo sintético");
  store.createHospitalEpisode(context, { patientId: patient.id, encounterId: encounter.id, bedId: bed.id });
  const productBefore = [...store.products.values()][0];
  assert.ok(productBefore);
  const medicationOrder = store.createMedicationOrder(context, { patientId: patient.id, encounterId: encounter.id, productId: productBefore.id, dose: "1 unidade", route: "oral", frequency: "12/12h" });

  const after = store.snapshot();
  const product = after.products.find((candidate) => candidate.id === productBefore.id)!;
  const lot = after.lots.find((candidate) => candidate.productId === product.id)!;
  const location = after.stockLocations.find((candidate) => candidate.id === lot.locationId)!;
  const charge = after.charges[0]!;
  const aiSession = {
    id: makeId(), organizationId: context.organizationId, actorId: veterinarian.id, unitId: context.unitId, workspaceId: context.workspaceId,
    patientId: patient.id, encounterId: encounter.id, purpose: "SUMMARY" as const, engineCommit: "aud27-test", profileDigest: digest("aud27-profile"), status: "ACTIVE" as const, createdAt: "2026-09-22T00:00:00.000Z"
  };
  const aiTurn = {
    id: makeId(), sessionId: aiSession.id, prompt: "resumo", response: "resposta", status: "COMPLETED" as const, model: "synthetic", inputTokens: 1, outputTokens: 1, references: [], createdAt: "2026-09-22T00:00:01.000Z"
  };
  const aiDraft = {
    id: makeId(), sessionId: aiSession.id, encounterId: encounter.id, draftType: "SUMMARY" as const, content: "rascunho", sourceTurnId: aiTurn.id, status: "DRAFT" as const, createdAt: "2026-09-22T00:00:02.000Z"
  };
  const aiApproval = {
    id: makeId(), organizationId: context.organizationId, actorId: veterinarian.id, sessionId: aiSession.id, turnId: aiTurn.id, toolName: "patients.read", resourceId: patient.id,
    patientId: patient.id, encounterId: encounter.id, unitId: context.unitId, workspaceId: context.workspaceId, purpose: "SUMMARY" as const, requestDigest: digest("aud27-request"), policyRevision: "1",
    expiresAt: "2099-01-01T00:00:00.000Z", decision: "rejected" as const, decidedBy: null, reason: null, createdAt: "2026-09-22T00:00:03.000Z"
  };
  const budgetReservation = {
    id: makeId(), organizationId: context.organizationId, sessionId: aiSession.id, category: "TOKENS" as const, reservedUnits: 10, consumedUnits: 0, status: "RESERVED" as const, createdAt: "2026-09-22T00:00:04.000Z"
  };
  after.aiSessions.push(aiSession);
  after.aiTurns.push(aiTurn);
  after.aiDrafts.push(aiDraft);
  after.aiApprovals.push(aiApproval);
  after.budgetReservations.push(budgetReservation);
  after.stockMovements.push({ id: makeId(), organizationId: context.organizationId, productId: product.id, lotId: lot.id, locationId: location.id, quantity: 1, movementType: "RECEIPT", reason: "AUD27 cobertura", referenceId: null, createdBy: veterinarian.id, createdAt: "2026-09-22T00:00:05.000Z" });
  after.dispensations.push({ id: makeId(), organizationId: context.organizationId, medicationOrderId: medicationOrder.id, lotId: lot.id, quantity: 1, dispensedBy: veterinarian.id, createdAt: "2026-09-22T00:00:06.000Z" });
  after.administrationOccurrences.push({ id: makeId(), organizationId: context.organizationId, medicationOrderId: medicationOrder.id, administeredBy: veterinarian.id, administeredAt: "2026-09-22T00:00:07.000Z", status: "OMITTED", note: "AUD27 cobertura" });
  after.payments.push({ id: makeId(), organizationId: context.organizationId, chargeId: charge.id, amountCents: 1, method: "PIX", externalReference: "aud27", status: "SETTLED", createdAt: "2026-09-22T00:00:08.000Z" });
  after.ledgerEntries.push({ id: makeId(), organizationId: context.organizationId, kind: "CHARGE", referenceId: charge.id, amountCents: charge.amountCents, currency: charge.currency, description: "AUD27 cobertura", createdAt: "2026-09-22T00:00:09.000Z" });
  after.messages.push({ id: makeId(), organizationId: context.organizationId, unitId: context.unitId, workspaceId: context.workspaceId, patientId: patient.id, channel: "SMS", recipient: "+5511999999999", template: "aud27", body: "mensagem sintética", status: "APPROVAL_REQUIRED", createdBy: veterinarian.id, decisionReason: null, createdAt: "2026-09-22T00:00:10.000Z" });

  const provider = after.providers[0]!;
  after.providers[0] = { ...provider, displayName: `${provider.displayName} AUD27` };
  const service = after.services[0]!;
  after.services[0] = { ...service, name: `${service.name} AUD27` };
  const resource = after.resources[0]!;
  after.resources[0] = { ...resource, name: `${resource.name} AUD27` };
  const queueEntry = after.queueEntries[0]!;
  after.queueEntries[0] = { ...queueEntry, priority: queueEntry.priority === "URGENT" ? "ROUTINE" : "URGENT" };
  const bedAfter = after.beds.find((candidate) => candidate.id === bed.id)!;
  after.beds[after.beds.findIndex((candidate) => candidate.id === bed.id)] = { ...bedAfter, name: `${bedAfter.name} AUD27` };
  after.products[after.products.findIndex((candidate) => candidate.id === product.id)] = { ...product, name: `${product.name} AUD27` };
  after.stockLocations[after.stockLocations.findIndex((candidate) => candidate.id === location.id)] = { ...location, name: `${location.name} AUD27` };
  after.lots[after.lots.findIndex((candidate) => candidate.id === lot.id)] = { ...lot, lotNumber: `${lot.lotNumber}-AUD27` };
  after.charges[after.charges.findIndex((candidate) => candidate.id === charge.id)] = { ...charge, description: `${charge.description} AUD27`, status: "PARTIALLY_PAID" };
  const knowledge = after.knowledgeDocuments[0]!;
  after.knowledgeDocuments[0] = { ...knowledge, title: `${knowledge.title} AUD27` };

  const plan = buildAud27NormalizedWritePlan(baseline, after);
  assert.deepEqual(plan.removed, []);
  assert.deepEqual(plan.writes.map((write) => write.snapshotKey), [...AUD27_SNAPSHOT_PRIMARY_KEYS]);
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  await persistence.commit({
    ...commitInput(store), snapshot: after, eventType: "SYSTEM", operation: "aud27.normalized-writes.all", actorId: veterinarian.id, aggregateType: "AUD27", aggregateId: null,
    auditRecords: after.auditRecords, commandReceipts: after.commandReceipts, normalizedDomainWrites: plan.writes as readonly Aud27NormalizedDomainWrite[]
  });
  assert.ok(fake.statements.some((statement) => statement.includes("insert into providers")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into clinical_addenda")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into ai_approvals")));
  assert.ok(fake.statements.some((statement) => statement.includes("insert into budget_reservations")));
});

test("projectDomain rejects ambiguous authoritative inputs and duplicate or divergent normalized writes", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fixture = diagnosticFixture(store, "ambiguous-authoritative");
  const specimenRecord = store.createSpecimen(fixture.context, fixture.request.id, "Tubo ambíguo");
  store.createResult(fixture.context, { requestId: fixture.request.id, specimenId: specimenRecord.id, value: "resultado ambíguo", source: "synthetic-lab", externalOrderId: null, sourceVersion: "v1" });
  const snapshot = store.snapshot();
  const guardian = snapshot.guardians[0];
  const diagnosticRequest = snapshot.diagnosticRequests[0];
  const specimen = snapshot.specimens[0];
  const diagnosticResult = snapshot.diagnosticResults[0];
  assert.ok(guardian && diagnosticRequest && specimen && diagnosticResult);

  const mutuallyExclusive = [
    { writeField: "normalizedGuardianWrite", replayField: "normalizedGuardianReplayId", write: guardian, replay: guardian.id, message: "authoritative guardian write and replay" },
    { writeField: "normalizedDiagnosticRequestWrite", replayField: "normalizedDiagnosticRequestReplayId", write: diagnosticRequest, replay: diagnosticRequest.id, message: "authoritative diagnostic request write and replay" },
    { writeField: "normalizedSpecimenWrite", replayField: "normalizedSpecimenReplayId", write: specimen, replay: specimen.id, message: "authoritative specimen write and replay" },
    { writeField: "normalizedDiagnosticResultWrite", replayField: "normalizedDiagnosticResultReplayId", write: diagnosticResult, replay: diagnosticResult.id, message: "authoritative diagnostic result write and replay" }
  ] as const;
  for (const entry of mutuallyExclusive) {
    const fake = fakePool();
    const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
    await assert.rejects(
      () => persistence.commit({ ...commitInput(store), snapshot, [entry.writeField]: entry.write, [entry.replayField]: entry.replay }),
      (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes(entry.message)
    );
    assert.ok(fake.statements.includes("ROLLBACK"));
  }

  const after = structuredClone(snapshot) as typeof snapshot;
  const service = after.services[0];
  assert.ok(service);
  after.services[0] = { ...service, name: `${service.name} duplicate-check` };
  const plan = buildAud27NormalizedWritePlan(snapshot, after);
  const serviceWrite = plan.writes.find((write) => write.snapshotKey === "services") as Extract<Aud27NormalizedDomainWrite, { snapshotKey: "services" }> | undefined;
  assert.ok(serviceWrite);

  const duplicateFake = fakePool();
  const duplicatePersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: duplicateFake.pool });
  await assert.rejects(
    () => duplicatePersistence.commit({ ...commitInput(store), snapshot: after, normalizedDomainWrites: [serviceWrite, serviceWrite] }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("duplicate AUD27 normalized write services")
  );

  const divergentFake = fakePool();
  const divergentPersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: divergentFake.pool });
  const divergentWrite: Aud27NormalizedDomainWrite = { ...serviceWrite, record: { ...serviceWrite.record, name: `${serviceWrite.record.name} divergent` } };
  await assert.rejects(
    () => divergentPersistence.commit({ ...commitInput(store), snapshot: after, normalizedDomainWrites: [divergentWrite] }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("AUD27 normalized write services") && error.message.includes("not identical")
  );
});

test("AUD27 normalized removals execute tenant-scoped relational deletes in dependency-safe order", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const before = store.snapshot();
  const after = structuredClone(before) as typeof before;
  const knowledge = after.knowledgeDocuments[0];
  assert.ok(knowledge);
  after.knowledgeDocuments = after.knowledgeDocuments.filter((row) => row.id !== knowledge.id);
  const plan = buildAud27NormalizedWritePlan(before, after);
  assert.deepEqual(plan.writes, []);
  assert.deepEqual(plan.removed, [{ snapshotKey: "knowledgeDocuments", id: knowledge.id, organizationId: knowledge.organizationId, unitId: knowledge.unitId, workspaceId: knowledge.workspaceId }]);
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  await persistence.commit({
    ...commitInput(store), snapshot: after, eventType: "SYSTEM", operation: "aud27.normalized-removals.knowledge", aggregateType: "AUD27", aggregateId: null,
    auditRecords: after.auditRecords, commandReceipts: after.commandReceipts, normalizedDomainRemovals: plan.removed
  });
  assert.ok(fake.statements.some((statement) => statement.startsWith("delete from knowledge_documents where id = $1")));
  assert.ok(fake.statements.indexOf("select set_config('cvg.unit_id', $1, true)") < fake.statements.findIndex((statement) => statement.startsWith("delete from knowledge_documents")));
});

test("durable command receipt claim is serialized and body-digest bound", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fakePool().pool });
  const input = { organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, sessionId: null, operation: "clinical.sign", key: "durable-claim-001", resourceId: null, unitId: null, workspaceId: null, body: { expectedVersion: "1" } };
  const claimed = await persistence.claimCommandReceipt(input);
  assert.equal(claimed.status, "CLAIMED");
  assert.equal(claimed.receipt.status, "IN_FLIGHT");
  const concurrent = await persistence.claimCommandReceipt(input);
  assert.equal(concurrent.status, "IN_FLIGHT");
  const divergent = await persistence.claimCommandReceipt({ ...input, body: { expectedVersion: "2" } });
  assert.equal(divergent.status, "CONFLICT");
  claimed.receipt.status = "FAILED";
  claimed.receipt.completedAt = new Date().toISOString();
  await persistence.settleCommandReceipt(claimed.receipt);
  const failed = await persistence.claimCommandReceipt(input);
  assert.equal(failed.status, "FAILED");
});

test("patient creation can own one authoritative normalized write inside the durable commit", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "patients.create", "patient-source-write");
  const guardian = [...store.guardians.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(guardian);
  const patient = store.createPatient(context, { guardianId: guardian.id, name: "Nina", species: "Felina", breed: null, sex: "FEMALE", reproductiveStatus: "NEUTERED", birthDate: null, identifiers: ["MICRO-NEW-001"] });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedPatientWrite: patient });

  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into patients") && statement.includes("on conflict (id) do update") && statement.includes("returning id::text")));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.unit_id', $1, true)"));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.workspace_id', $1, true)"));
});

test("stock product creation uses its owner path once and a durable replay skips product DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const before = store.snapshot();
  const actorId = store.bootstrapCredentials.userId;
  const option = store.contextOptions(actorId)[0];
  assert.ok(option);
  const context = store.resolveContext(actorId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "stock.write", "product-source-write");
  const product = store.createProduct(context, { sku: "SKU-AUD27-PRODUCT-OWNER-001", name: "Produto sintético", category: "INSUMO", unit: "unidade", reorderPoint: 1 });
  const snapshot = store.snapshot();
  const plan = buildAud27NormalizedWritePlan(before, snapshot);
  assert.deepEqual(plan.writes.map((write) => write.snapshotKey), ["products"]);
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot, normalizedProductWrite: product, normalizedDomainWrites: plan.writes });

  const productDml = fake.productStatements.filter(({ params }) => params[0] === product.id);
  assert.equal(productDml.length, 1);
  assert.match(productDml[0]!.sql, /returning id::text/);
  assert.equal(productDml[0]!.params[1], product.organizationId);
  assert.ok(fake.statements.includes("select set_config('cvg.organization_id', $1, true)"));

  await persistence.commit({ ...commitInput(store), expectedRevision: 1n, snapshot, normalizedProductReplayId: product.id });

  assert.equal(fake.productStatements.filter(({ params }) => params[0] === product.id).length, 1, "replay must not issue another product insert or projection");
  const divergentSnapshot = structuredClone(snapshot);
  const divergent = divergentSnapshot.products.find((candidate) => candidate.id === product.id);
  assert.ok(divergent);
  divergent.name = "snapshot divergiu depois do commit";
  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), expectedRevision: 2n, snapshot: divergentSnapshot, normalizedProductReplayId: product.id }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("does not match its normalized row")
  );
  assert.equal(fake.productStatements.filter(({ params }) => params[0] === product.id).length, 1, "a divergent replay must fail without issuing product DML");
});

test("stock product SKU uniqueness remains a typed conflict and rolls back the durable commit", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "stock.write", "product-sku-conflict");
  const product = store.createProduct(context, { sku: "SKU-AUD27-PRODUCT-CONFLICT-001", name: "Produto sintético", category: "INSUMO", unit: "unidade", reorderPoint: 1 });
  const fake = fakePool({ productSkuConflict: true });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedProductWrite: product }),
    (error: unknown) => error instanceof PersistenceProductSkuConflictError
  );
  assert.ok(fake.statements.includes("ROLLBACK"));
  assert.equal(fake.statements.some((statement) => statement.startsWith("insert into cvg_state_snapshots")), false);
});

test("stock product command rejects snapshot divergence before product DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const before = store.snapshot();
  const actorId = store.bootstrapCredentials.userId;
  const option = store.contextOptions(actorId)[0];
  assert.ok(option);
  const context = store.resolveContext(actorId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "stock.write", "product-source-divergence");
  const product = store.createProduct(context, { sku: "SKU-AUD27-PRODUCT-OWNER-002", name: "Produto sintético", category: "INSUMO", unit: "unidade", reorderPoint: 1 });
  const snapshot = store.snapshot();
  const plan = buildAud27NormalizedWritePlan(before, snapshot);
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), snapshot, normalizedProductWrite: { ...product, name: "registro divergente" }, normalizedDomainWrites: plan.writes }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("not identical to the canonical snapshot")
  );
  assert.equal(fake.productStatements.filter(({ params }) => params[0] === product.id).length, 0);
});

test("guardian creation can own one authoritative normalized write inside the durable commit", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "guardians.create", "guardian-source-write");
  const guardian = store.createGuardian(context, { displayName: "Marina Fonte", phone: "+55 11 98888-1200", email: "marina.fonte@example.test" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedGuardianWrite: guardian });

  const authoritative = fake.statements.filter((statement) => statement.startsWith("insert into guardians") && statement.includes("returning id::text"));
  assert.equal(authoritative.length, 1);
  assert.match(authoritative[0]!, /on conflict \(id\) do update/);
  assert.match(authoritative[0]!, /guardians\.email is not distinct from excluded\.email/);
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.unit_id', $1, true)"));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.workspace_id', $1, true)"));
});

test("authoritative guardian writes fail closed when the candidate diverges from the canonical snapshot", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "guardians.create", "guardian-source-corruption");
  const guardian = store.createGuardian(context, { displayName: "Guardian canônico", phone: "+55 11 98888-1201", email: null });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), normalizedGuardianWrite: { ...guardian, displayName: "Guardian divergente" } }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("not identical to the canonical snapshot")
  );
  assert.ok(fake.statements.some((statement) => statement === "ROLLBACK"));
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into guardians") && statement.includes("returning id::text")).length, 0);
});

test("guardian replay advances the audit/receipt snapshot without issuing a second guardian DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "guardians.create", "guardian-replay");
  const guardian = [...store.guardians.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(guardian);
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedGuardianReplayId: guardian.id });

  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into guardians") && statement.includes("returning id::text")).length, 0);
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into guardians")).length, store.snapshot().guardians.length - 1);
});

test("diagnostic request creation can own one authoritative normalized write inside the durable commit", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const vetId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  const option = vetId ? store.contextOptions(vetId)[0] : undefined;
  assert.ok(vetId && option);
  const context = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "diagnostics.create", "diagnostic-source-write");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(patient);
  const encounterContext = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "encounters.create", "diagnostic-source-write-encounter");
  const encounter = store.createEncounter(encounterContext, { patientId: patient.id, appointmentId: null, chiefComplaint: "pedido de exame", urgency: "ROUTINE" });
  const request = store.createDiagnosticRequest(context, { patientId: patient.id, encounterId: encounter.id, testName: "Perfil hematológico sintético", priority: "ROUTINE" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedDiagnosticRequestWrite: request });

  const authoritative = fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_requests") && statement.includes("returning id::text"));
  assert.equal(authoritative.length, 1);
  assert.match(authoritative[0]!, /insert into diagnostic_requests\(id, organization_id, unit_id, workspace_id, patient_id/);
  assert.match(authoritative[0]!, /on conflict \(id\) do update/);
  assert.match(authoritative[0]!, /diagnostic_requests\.unit_id = excluded\.unit_id/);
  assert.match(authoritative[0]!, /diagnostic_requests\.workspace_id = excluded\.workspace_id/);
  assert.match(authoritative[0]!, /diagnostic_requests\.created_at = excluded\.created_at/);
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.unit_id', $1, true)"));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.workspace_id', $1, true)"));
});

test("authoritative diagnostic request writes fail closed when PostgreSQL returns no normalized row", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const vetId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  const option = vetId ? store.contextOptions(vetId)[0] : undefined;
  assert.ok(vetId && option);
  const context = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "diagnostics.create", "diagnostic-source-no-returning");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(patient);
  const encounterContext = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "encounters.create", "diagnostic-source-no-returning-encounter");
  const encounter = store.createEncounter(encounterContext, { patientId: patient.id, appointmentId: null, chiefComplaint: "pedido de exame sem retorno", urgency: "ROUTINE" });
  const request = store.createDiagnosticRequest(context, { patientId: patient.id, encounterId: encounter.id, testName: "Exame sem retorno", priority: "ROUTINE" });
  const fake = fakePool({ diagnosticRequestWriteRows: false });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedDiagnosticRequestWrite: request }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("conflicts with an existing normalized row")
  );
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_requests") && statement.includes("returning id::text")).length, 1);
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("authoritative diagnostic request writes fail closed when the candidate diverges from the canonical snapshot", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const vetId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  const option = vetId ? store.contextOptions(vetId)[0] : undefined;
  assert.ok(vetId && option);
  const context = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "diagnostics.create", "diagnostic-source-corruption");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(patient);
  const encounterContext = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "encounters.create", "diagnostic-source-corruption-encounter");
  const encounter = store.createEncounter(encounterContext, { patientId: patient.id, appointmentId: null, chiefComplaint: "pedido de exame", urgency: "ROUTINE" });
  const request = store.createDiagnosticRequest(context, { patientId: patient.id, encounterId: encounter.id, testName: "Exame canônico", priority: "ROUTINE" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), normalizedDiagnosticRequestWrite: { ...request, testName: "Exame divergente" } }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("not identical to the canonical snapshot")
  );
  assert.ok(fake.statements.includes("ROLLBACK"));
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_requests") && statement.includes("returning id::text")).length, 0);
});

test("diagnostic request replay advances the audit/receipt snapshot without issuing a second diagnostic DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const vetId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  const option = vetId ? store.contextOptions(vetId)[0] : undefined;
  assert.ok(vetId && option);
  const context = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "diagnostics.create", "diagnostic-replay");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(patient);
  const encounterContext = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "encounters.create", "diagnostic-replay-encounter");
  const encounter = store.createEncounter(encounterContext, { patientId: patient.id, appointmentId: null, chiefComplaint: "pedido de exame", urgency: "ROUTINE" });
  const request = store.createDiagnosticRequest(context, { patientId: patient.id, encounterId: encounter.id, testName: "Exame já persistido", priority: "ROUTINE" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedDiagnosticRequestReplayId: request.id });

  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_requests") && statement.includes("returning id::text")).length, 0);
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_requests")).length, store.snapshot().diagnosticRequests.length - 1);
});

test("specimen and diagnostic result creation can own authoritative scoped writes in the durable commit", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fixture = diagnosticFixture(store, "children-source-write");
  const specimen = store.createSpecimen(fixture.context, fixture.request.id, "Tubo EDTA sintético");
  const result = store.createResult(fixture.context, { requestId: fixture.request.id, specimenId: specimen.id, value: "hematócrito 42", source: "synthetic-lab", externalOrderId: null, sourceVersion: "v1" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedSpecimenWrite: specimen, normalizedDiagnosticResultWrite: result });

  const specimenWrites = fake.statements.filter((statement) => statement.startsWith("insert into specimens") && statement.includes("returning id::text"));
  const resultWrites = fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_results") && statement.includes("returning id::text"));
  assert.equal(specimenWrites.length, 1);
  assert.equal(resultWrites.length, 1);
  assert.match(specimenWrites[0]!, /insert into specimens\(id, organization_id, unit_id, workspace_id, request_id/);
  assert.match(specimenWrites[0]!, /specimens\.collected_at = excluded\.collected_at/);
  assert.match(resultWrites[0]!, /insert into diagnostic_results\(id, organization_id, unit_id, workspace_id, request_id/);
  assert.match(resultWrites[0]!, /diagnostic_results\.created_at = excluded\.created_at/);
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.unit_id', $1, true)"));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.workspace_id', $1, true)"));
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into specimens") && !statement.includes("returning id::text")).length, 0);
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_results") && !statement.includes("returning id::text")).length, 0);
});

test("authoritative diagnostic result writes fail closed when PostgreSQL returns no normalized row", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fixture = diagnosticFixture(store, "result-no-returning");
  const specimen = store.createSpecimen(fixture.context, fixture.request.id, "Tubo sem retorno");
  const result = store.createResult(fixture.context, { requestId: fixture.request.id, specimenId: specimen.id, value: "resultado sem retorno", source: "synthetic-lab", externalOrderId: null, sourceVersion: "v1" });
  const fake = fakePool({ diagnosticResultWriteRows: false });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedDiagnosticResultWrite: result }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("conflicts with an existing normalized row")
  );
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_results") && statement.includes("returning id::text")).length, 1);
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("authoritative specimen writes fail closed when the candidate diverges from the canonical snapshot", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fixture = diagnosticFixture(store, "specimen-corruption");
  const specimen = store.createSpecimen(fixture.context, fixture.request.id, "Tubo canônico");
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), normalizedSpecimenWrite: { ...specimen, label: "Tubo divergente" } }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("not identical to the canonical snapshot")
  );
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into specimens") && statement.includes("returning id::text")).length, 0);
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("specimen replay advances the audit/receipt snapshot without issuing a second specimen DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fixture = diagnosticFixture(store, "specimen-replay");
  const specimen = store.createSpecimen(fixture.context, fixture.request.id, "Tubo já persistido");
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedSpecimenReplayId: specimen.id });

  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into specimens") && statement.includes("returning id::text")).length, 0);
  assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into specimens")).length, store.snapshot().specimens.length - 1);
});

test("appointment creation can own one authoritative normalized write inside the durable commit", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "appointments.create", "appointment-source-write");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  const provider = [...store.providers.values()].find((candidate) => candidate.unitId === context.unitId);
  const service = [...store.services.values()].find((candidate) => candidate.organizationId === context.organizationId);
  const resource = [...store.resources.values()].find((candidate) => candidate.unitId === context.unitId);
  assert.ok(patient && provider && service && resource);
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
  const endsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000 + 45 * 60 * 1_000).toISOString();
  const appointment = store.createAppointment(context, { patientId: patient.id, providerId: provider.id, resourceId: resource.id, serviceId: service.id, startsAt, endsAt, purpose: "consulta de retorno" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedAppointmentWrite: appointment });

  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into appointments") && statement.includes("on conflict (id) do update") && statement.includes("returning id::text")));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.unit_id', $1, true)"));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.workspace_id', $1, true)"));
});

test("encounter creation can own one authoritative normalized write inside the durable commit", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "encounters.create", "encounter-source-write");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(patient);
  const encounter = store.createEncounter(context, { patientId: patient.id, appointmentId: null, chiefComplaint: "avaliação de retorno", urgency: "ROUTINE" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedEncounterWrite: encounter });

  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into encounters") && statement.includes("on conflict (id) do update") && statement.includes("returning id::text")));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.unit_id', $1, true)"));
  assert.ok(fake.statements.some((statement) => statement === "select set_config('cvg.workspace_id', $1, true)"));
});

test("authoritative encounter writes fail closed when the candidate diverges from the canonical snapshot", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "encounters.create", "encounter-source-corruption");
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  assert.ok(patient);
  const encounter = store.createEncounter(context, { patientId: patient.id, appointmentId: null, chiefComplaint: "avaliação de retorno", urgency: "ROUTINE" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), snapshot: store.snapshot(), normalizedEncounterWrite: { ...encounter, chiefComplaint: "candidato divergente" } }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("not identical to the canonical snapshot")
  );
  assert.ok(fake.statements.some((statement) => statement === "ROLLBACK"));
});

test("Postgres persistence fails closed when a contextual projection loses its scope", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  snapshot.guardians[0]!.unitId = null;
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), snapshot }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("complete unit/workspace scope")
  );
  assert.ok(fake.statements.some((statement) => statement === "ROLLBACK"));
});

test("authoritative domain registry covers every normalized business collection", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const keys = new Set(AUTHORITATIVE_DOMAIN_REGISTRY.map((entry) => entry.snapshotKey));
  for (const key of ["guardians", "patients", "appointments", "encounters", "clinicalDocuments", "diagnosticRequests", "specimens", "diagnosticResults", "hospitalEpisodes", "medicationOrders", "products", "lots", "stockLocations", "stockMovements", "charges", "payments", "ledgerEntries", "messages", "knowledgeDocuments", "aiSessions", "aiTurns", "aiDrafts", "aiApprovals", "budgetReservations"] as const) assert.ok(keys.has(key), `missing authoritative registry entry for ${key}`);
  validateAuthoritativeSnapshot(snapshot);
});

test("authoritative validation rejects cross-parent and cross-tenant child relationships", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fixture = diagnosticFixture(store, "registry-mismatch");
  const specimen = store.createSpecimen(fixture.context, fixture.request.id, "Tubo de invariantes");
  const result = store.createResult(fixture.context, { requestId: fixture.request.id, specimenId: specimen.id, value: "42", source: "fixture", sourceVersion: "1", externalOrderId: null });
  const snapshot = store.snapshot();
  const patient = snapshot.patients.find((candidate) => candidate.id === result.patientId)!;
  const original = snapshot.patients.find((candidate) => candidate.id !== patient.id && candidate.organizationId === patient.organizationId);
  assert.ok(original);
  result.patientId = original.id;
  const storedResult = snapshot.diagnosticResults.find((candidate) => candidate.id === result.id)!;
  storedResult.patientId = original.id;
  assert.throws(() => validateAuthoritativeSnapshot(snapshot), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("diagnosticResult.patient mismatch"));
});

test("authoritative validation rejects workspace and unit drift in operational children", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const appointment = snapshot.appointments[0]!;
  const otherWorkspace = snapshot.workspaces.find((workspace) => workspace.id !== appointment.workspaceId && workspace.organizationId === appointment.organizationId);
  assert.ok(otherWorkspace);
  appointment.workspaceId = otherWorkspace.id;
  assert.throws(() => validateAuthoritativeSnapshot(snapshot), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("appointment.patient.workspace mismatch"));
});

test("authoritative validation rejects medication product and actor organization drift", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const vetId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  const stockId = [...store.users.values()].find((user) => user.login.startsWith("leo."))?.id;
  assert.ok(vetId && stockId);
  const option = store.contextOptions(vetId)[0];
  assert.ok(option);
  const vet = store.resolveContext(vetId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "medication.prescribe", "medication-integrity-vet");
  const stock = store.resolveContext(stockId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "medication.dispense", "medication-integrity-stock");
  const patient = [...store.patients.values()][0];
  const product = [...store.products.values()][0];
  const lot = [...store.lots.values()][0];
  assert.ok(patient && product && lot);
  const encounter = store.createEncounter(vet, { patientId: patient.id, appointmentId: null, chiefComplaint: "invariante de dispensação", urgency: "ROUTINE" });
  const order = store.createMedicationOrder(vet, { patientId: patient.id, encounterId: encounter.id, productId: product.id, dose: "1", route: "oral", frequency: "12/12h" });
  store.dispenseMedication(stock, order.id, lot.id, 1);
  const snapshot = store.snapshot();
  const secondProduct = { ...snapshot.products[0]!, id: id("00000000-0000-4000-8000-000000009705"), sku: "AMX-OTHER", name: "Produto incompatível" };
  const secondLot = { ...snapshot.lots[0]!, id: id("00000000-0000-4000-8000-000000009706"), productId: secondProduct.id, lotNumber: "AMX-OTHER-LOT" };
  snapshot.products.push(secondProduct);
  snapshot.lots.push(secondLot);
  snapshot.dispensations[0]!.lotId = secondLot.id;
  assert.throws(() => validateAuthoritativeSnapshot(snapshot), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("dispensation.order.product mismatch"));

  const foreignOrganizationId = id("00000000-0000-4000-8000-000000009707");
  const foreignUserId = id("00000000-0000-4000-8000-000000009708");
  const actorSnapshot = store.snapshot();
  actorSnapshot.organizations.push({ ...actorSnapshot.organizations[0]!, id: foreignOrganizationId, name: "Organização estrangeira", slug: "organizacao-estrangeira" });
  actorSnapshot.users.push({ ...actorSnapshot.users[0]!, id: foreignUserId, organizationId: foreignOrganizationId, login: "foreign-medication@example.test", email: "foreign-medication@example.test" });
  actorSnapshot.dispensations[0]!.dispensedBy = foreignUserId;
  assert.throws(() => validateAuthoritativeSnapshot(actorSnapshot), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("dispensation.dispensedBy.organization mismatch"));
});

test("AI projections derive mandatory tenant scope from the persisted session", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const session = store.createSession(store.bootstrapCredentials.userId, digest("ai-projection-token"), "synthetic-csrf", 60);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "ai.turn.SUMMARY", "ai-projection", null, null, session.id);
  const service = new AgentApplicationService(store, new MockHarnessAdapter(new GovernedHarness(store)));
  const input = { sessionId: null, prompt: "resumir a fila", purpose: "SUMMARY" as const, patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "ai-projection-1" };
  const first = await service.executeTurn(context, input);
  const replay = await service.executeTurn(context, input);
  assert.equal(replay.replayed, true);
  assert.equal(first.value.turn.provenance?.usageRecordId, first.value.turn.usage?.id);
  assert.equal(first.value.turn.provenance?.referencesDigest, digest(first.value.turn.references));
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  await persistence.commit({ ...commitInput(store), snapshot: store.snapshot() });
  const turnStatement = fake.statements.find((statement) => statement.startsWith("insert into ai_turns"));
  assert.ok(turnStatement?.includes("organization_id, unit_id, workspace_id, session_id"));
  assert.ok(turnStatement?.includes("usage_record_id, provenance_json"));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into ai_usage_ledger")));
});

test("inbox divergent duplicate is quarantined inside the durable transaction", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const organizationId = store.bootstrapCredentials.organizationId;
  const eventId = makeId();
  const input: DurableInboxInput = {
    id: eventId,
    organizationId,
    consumer: "diagnostic-consumer",
    provider: "synthetic-lab",
    externalEventId: "external-divergent-001",
    eventType: "diagnostic.result.received",
    schemaVersion: 1,
    signatureAlgorithm: "HMAC-SHA256",
    signatureKeyRef: "synthetic-inbox-key",
    signature: "a".repeat(64),
    payload: { resultId: "result-1", value: "original" }
  };
  const existingId = makeId();
  const baseRow = {
    id: String(existingId), organization_id: String(organizationId), consumer: input.consumer, provider: input.provider, external_event_id: input.externalEventId,
    event_type: input.eventType, schema_version: 1, signature_algorithm: "HMAC-SHA256", signature_key_ref: input.signatureKeyRef, signature: input.signature,
    payload: input.payload, record_digest: "0".repeat(64), status: "RECEIVED", conflict_digest: null, last_error: null,
    received_at: "2026-09-22T00:00:00.000Z", processed_at: null, last_seen_at: "2026-09-22T00:00:00.000Z"
  };
  const statements: string[] = [];
  const client = {
    async query(sql: string): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK" || sql.includes("set_config('cvg.organization_id'")) return { rows: [] };
      if (sql.startsWith("insert into integration_inbox_records")) return { rows: [] };
      if (sql.startsWith("select id::text as id") && sql.includes("from integration_inbox_records")) return { rows: [baseRow] };
      if (sql.startsWith("update integration_inbox_records set status = 'QUARANTINED'")) return { rows: [{ ...baseRow, status: "QUARANTINED", conflict_digest: "f".repeat(64), last_error: "DIVERGENT_DUPLICATE_EVENT", last_seen_at: "2026-09-22T00:00:01.000Z" }] };
      return { rows: [] };
    },
    release(): void { /* no-op fake */ }
  } as unknown as PoolClient;
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: { connect: async (): Promise<PoolClient> => client } as unknown as Pool, inboxSignatureVerifier: async () => true });

  const receipt = await persistence.recordInboxEvent(input);

  assert.equal(receipt.duplicate, false);
  assert.equal(receipt.status, "QUARANTINED");
  assert.ok(statements.some((statement) => statement.includes("DIVERGENT_DUPLICATE_EVENT")));
  assert.ok(statements.includes("COMMIT"));
});

test("appointment range parity keeps exact bounds and tenant scope through memory and Postgres repositories", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0]!;
  const session = store.createSession(store.bootstrapCredentials.userId, "range-parity-token", "range-parity-csrf", 60);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "appointments.read", "range-parity", null, null, session.id);
  const patient = [...store.patients.values()].find((item) => item.workspaceId === context.workspaceId)!;
  const provider = [...store.providers.values()].find((item) => item.unitId === context.unitId)!;
  const service = [...store.services.values()][0]!;
  const range = { startsAt: "2030-09-15T03:00:00.000Z", endsAt: "2030-09-16T03:00:00.000Z" };
  const starts = ["2030-09-15T02:59:59.999Z", range.startsAt, "2030-09-16T00:00:00.000Z", "2030-09-16T02:59:59.999Z", range.endsAt];
  const appointments = starts.map((startsAt, index) => store.createAppointment(context, {
    patientId: patient.id, providerId: provider.id, serviceId: service.id, resourceId: null,
    startsAt, endsAt: new Date(Date.parse(startsAt) + 1).toISOString(), purpose: `boundary ${index}`
  }));
  let organization: unknown;
  let selectedBounds: unknown[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (sql.includes("set_config('cvg.organization_id'")) organization = params[0];
      if (!sql.includes("from appointments a")) return { rows: [] };
      assert.ok(sql.includes("a.organization_id = cvg_request_organization()"));
      assert.ok(sql.includes("($1::uuid is null or a.unit_id = $1::uuid)"));
      assert.ok(sql.includes("($2::uuid is null or a.workspace_id = $2::uuid)"));
      assert.ok(sql.includes("a.starts_at >= $3::timestamptz and a.starts_at < $4::timestamptz"));
      selectedBounds = params;
      return { rows: appointments.filter((item) => item.organizationId === organization && (!params[0] || item.unitId === params[0]) && (!params[1] || item.workspaceId === params[1]) && Date.parse(item.startsAt) >= (params[2] as Date).getTime() && Date.parse(item.startsAt) < (params[3] as Date).getTime()).map((item) => ({
        id: item.id, organization_id: item.organizationId, unit_id: item.unitId, workspace_id: item.workspaceId,
        patient_id: item.patientId, provider_id: item.providerId, resource_id: item.resourceId, service_id: item.serviceId,
        starts_at: item.startsAt, ends_at: item.endsAt, purpose: item.purpose, status: item.status, version: item.version,
        created_at: item.createdAt, patient_name: patient.name, provider_name: provider.displayName
      })) };
    },
    release() {}
  } as unknown as PoolClient;
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: { connect: async () => client } as unknown as Pool });
  const memory = createReadApplicationService(store, null);
  const postgres = createReadApplicationService(store, persistence);
  const expected = appointments.slice(1, 4).map((item) => item.id);
  assert.deepEqual((await memory.listAppointments(context, range)).map((item) => item.id), expected);
  assert.deepEqual((await postgres.listAppointments(context, range)).map((item) => item.id), expected);
  assert.deepEqual(selectedBounds, [context.unitId, context.workspaceId, new Date(range.startsAt), new Date(range.endsAt)]);
  for (const other of store.contextOptions(store.bootstrapCredentials.userId).filter((item) => item.workspace.id !== context.workspaceId)) {
    const scoped = store.resolveContext(store.bootstrapCredentials.userId, { unitId: other.unit.id, workspaceId: other.workspace.id }, "appointments.read", "range-other", null, null, session.id);
    assert.deepEqual(await memory.listAppointments(scoped, range), []);
    assert.deepEqual(await postgres.listAppointments(scoped, range), []);
  }
  for (const changed of [{ organizationId: makeId() }, { unitId: makeId() }, { workspaceId: makeId() }]) {
    assert.throws(() => store.listAppointments({ ...context, ...changed }, range), /contexto.*não está/);
    assert.deepEqual(await persistence.listAppointments({ ...context, ...changed }, range), []);
  }
});

test("normalized read repositories scope the transaction and preserve joined projections", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: [...store.units.values()][0]?.id ?? null, workspaceId: [...store.workspaces.values()][0]?.id ?? null }, "persistence.read", "persistence-read");
  assert.ok(context.unitId && context.workspaceId);
  const fake = normalizedReadPool({ unitId: context.unitId, workspaceId: context.workspaceId });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  const guardians = await persistence.listGuardians(context, "Marina");
  const patients = await persistence.listPatients(context, "Luna");
  const appointments = await persistence.listAppointments(context);
  const encounters = await persistence.listEncounters(context);
  const documents = await persistence.listClinicalDocuments(context);
  const diagnosticRequests = await persistence.listDiagnosticRequests(context);
  const specimens = await persistence.listSpecimens(context);
  const diagnosticResults = await persistence.listDiagnosticResults(context);
  const beds = await persistence.listBeds(context);
  const hospitalEpisodes = await persistence.listHospitalEpisodes(context);
  const medicationOrders = await persistence.listMedicationOrders(context);
  const stock = await persistence.listStock(context);
  const charges = await persistence.listCharges(context);
  const payments = await persistence.listPayments(context);
  const ledgerEntries = await persistence.listLedgerEntries(context);
  const messages = await persistence.listMessages(context);
  const knowledgeDocuments = await persistence.listKnowledgeDocuments(context);
  const queue = await persistence.listQueue(context);
  const aiSessions = await persistence.listAiSessions(context);
  const audit = await persistence.listAudit(context, 10);

  assert.equal(fake.scope.organizationId, context.organizationId);
  assert.equal(guardians[0]?.displayName, "Marina Souza");
  assert.equal(patients[0]?.guardian?.displayName, "Marina Souza");
  assert.equal(appointments[0]?.patient?.name, "Luna");
  assert.equal(encounters[0]?.patient.name, "Luna");
  assert.equal(documents[0]?.title, "Evolução sintética");
  assert.equal(diagnosticRequests[0]?.testName, "Hemograma sintético");
  assert.equal(specimens[0]?.label, "LUNA-HEM-001");
  assert.equal(diagnosticResults[0]?.status, "VALID");
  assert.equal(beds[0]?.status, "AVAILABLE");
  assert.equal(hospitalEpisodes[0]?.status, "ADMITTED");
  assert.equal(medicationOrders[0]?.product?.name, "Antibiótico sintético");
  assert.equal(stock[0]?.location?.name, "Farmácia — Centro");
  assert.equal(charges[0]?.status, "OPEN");
  assert.equal(payments[0]?.method, "PIX");
  assert.equal(ledgerEntries[0]?.kind, "CHARGE");
  assert.equal(messages[0]?.status, "APPROVAL_REQUIRED");
  assert.equal(messages[0]?.createdBy, id("00000000-0000-4000-0000-000000000002"));
  assert.equal(knowledgeDocuments[0]?.title, "Protocolo sintético");
  assert.equal(queue[0]?.patient?.name, "Luna");
  assert.equal(aiSessions[0]?.turns, 2);
  assert.equal(audit[0]?.action, "patients.read");
  assert.deepEqual(audit[0]?.metadata, { count: 1 });
  assert.ok(fake.statements.filter((statement) => statement === "BEGIN READ ONLY").length === 20);
  assert.ok(fake.statements.filter((statement) => statement === "COMMIT").length === 20);
  assert.ok(fake.statements.some((statement) => statement.includes("p.organization_id = cvg_request_organization()")));
  assert.ok(fake.statements.some((statement) => statement.includes("a.workspace_id = $2::uuid")));
  assert.ok(fake.statements.some((statement) => statement.includes("cvg_request_scope_allows(e.unit_id, e.workspace_id)")));
  assert.ok(fake.statements.some((statement) => statement.includes("cvg_request_scope_allows(d.unit_id, d.workspace_id)")));
  assert.ok(fake.statements.some((statement) => statement.includes("cvg_request_scope_allows(e.unit_id, e.workspace_id)")));
  assert.ok(fake.statements.some((statement) => statement.includes("from diagnostic_requests r")));
  assert.ok(fake.statements.some((statement) => statement.includes("from specimens s")));
  assert.ok(fake.statements.some((statement) => statement.includes("from diagnostic_results dr")));
  assert.ok(fake.statements.some((statement) => statement.includes("from beds b")));
  assert.ok(fake.statements.some((statement) => statement.includes("from hospital_episodes h")));
  assert.ok(fake.statements.some((statement) => statement.includes("from medication_orders m")));
  assert.ok(fake.statements.some((statement) => statement.includes("from lots l")));
  assert.ok(fake.statements.some((statement) => statement.includes("from charges c")));
  assert.ok(fake.statements.some((statement) => statement.includes("from payments p")));
  assert.ok(fake.statements.some((statement) => statement.includes("from ledger_entries l")));
  assert.ok(fake.statements.some((statement) => statement.includes("from communication_messages m")));
  assert.ok(fake.statements.some((statement) => statement.includes("from knowledge_documents d")));
  assert.ok(fake.statements.some((statement) => statement.includes("from queue_entries q")));
  assert.ok(fake.statements.some((statement) => statement.includes("from ai_sessions s")));
  assert.ok(fake.statements.some((statement) => statement.includes("from audit_records a")));
  assert.ok(fake.statements.some((statement) => statement.includes("cvg_request_scope_allows(a.unit_id, a.workspace_id)")));
});

test("normalized audit reads quarantine malformed durable rows", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: [...store.units.values()][0]?.id ?? null, workspaceId: [...store.workspaces.values()][0]?.id ?? null }, "persistence.read", "persistence-audit-corruption");
  const fake = normalizedReadPool({ auditMetadata: { unsafe: ["secret"] }, unitId: context.unitId, workspaceId: context.workspaceId });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(() => persistence.listAudit(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("audit.metadata.unsafe"));
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("normalized clinical reads quarantine unsupported durable status", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: [...store.units.values()][0]?.id ?? null, workspaceId: [...store.workspaces.values()][0]?.id ?? null }, "persistence.read", "persistence-clinical-corruption");
  const fake = normalizedReadPool({ clinicalStatus: "UNTRUSTED", unitId: context.unitId, workspaceId: context.workspaceId });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(() => persistence.listClinicalDocuments(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("clinical.status"));
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("normalized diagnostic reads quarantine unsupported durable status", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: [...store.units.values()][0]?.id ?? null, workspaceId: [...store.workspaces.values()][0]?.id ?? null }, "persistence.read", "persistence-diagnostic-corruption");
  const fake = normalizedReadPool({ diagnosticStatus: "UNTRUSTED", unitId: context.unitId, workspaceId: context.workspaceId });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(() => persistence.listDiagnosticRequests(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("diagnostic.status"));
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("normalized stock reads quarantine unsupported durable status", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: [...store.units.values()][0]?.id ?? null, workspaceId: [...store.workspaces.values()][0]?.id ?? null }, "persistence.read", "persistence-stock-corruption");
  const fake = normalizedReadPool({ stockStatus: "UNTRUSTED", unitId: context.unitId, workspaceId: context.workspaceId });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(() => persistence.listStock(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("stock.status"));
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("normalized finance, communication and knowledge reads quarantine unsupported durable status", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: [...store.units.values()][0]?.id ?? null, workspaceId: [...store.workspaces.values()][0]?.id ?? null }, "persistence.read", "persistence-domain-corruption");

  const financeFake = normalizedReadPool({ financeStatus: "UNTRUSTED", unitId: context.unitId, workspaceId: context.workspaceId });
  const financePersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: financeFake.pool });
  await assert.rejects(() => financePersistence.listCharges(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("charge.status"));
  assert.ok(financeFake.statements.includes("ROLLBACK"));

  const communicationFake = normalizedReadPool({ communicationStatus: "UNTRUSTED", unitId: context.unitId, workspaceId: context.workspaceId });
  const communicationPersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: communicationFake.pool });
  await assert.rejects(() => communicationPersistence.listMessages(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("communication.status"));
  assert.ok(communicationFake.statements.includes("ROLLBACK"));

  const knowledgeFake = normalizedReadPool({ knowledgeStatus: "UNTRUSTED", unitId: context.unitId, workspaceId: context.workspaceId });
  const knowledgePersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: knowledgeFake.pool });
  await assert.rejects(() => knowledgePersistence.listKnowledgeDocuments(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("knowledge.status"));
  assert.ok(knowledgeFake.statements.includes("ROLLBACK"));
});

test("normalized queue and AI session reads quarantine unsupported durable status", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: [...store.units.values()][0]?.id ?? null, workspaceId: [...store.workspaces.values()][0]?.id ?? null }, "persistence.read", "persistence-queue-ai-corruption");

  const queueFake = normalizedReadPool({ queueStatus: "UNTRUSTED", unitId: context.unitId, workspaceId: context.workspaceId });
  const queuePersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: queueFake.pool });
  await assert.rejects(() => queuePersistence.listQueue(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("queue.status"));
  assert.ok(queueFake.statements.includes("ROLLBACK"));

  const aiFake = normalizedReadPool({ aiStatus: "UNTRUSTED", unitId: context.unitId, workspaceId: context.workspaceId });
  const aiPersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: aiFake.pool });
  await assert.rejects(() => aiPersistence.listAiSessions(context), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("ai-session.status"));
  assert.ok(aiFake.statements.includes("ROLLBACK"));
});

test("durable break-glass lifecycle keeps evidence immutable behind the transaction boundary", async () => {
  const statements: string[] = [];
  const grantId = "00000000-0000-4000-0000-000000000201";
  const organizationId = "00000000-0000-4000-0000-000000000010";
  const actorId = "00000000-0000-4000-0000-000000000001";
  const approverId = "00000000-0000-4000-0000-000000000002";
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const row: Record<string, unknown> = {
    id: grantId,
    organization_id: organizationId,
    actor_id: actorId,
    approver_id: approverId,
    reason: "synthetic incident review",
    target: "patient:synthetic",
    mfa_method: "WEBAUTHN",
    issued_at: issuedAt,
    expires_at: expiresAt,
    status: "ACTIVE",
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    revoked_at: null,
    created_at: issuedAt
  };
  const client = {
    async query(sql: string): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      if (sql.includes("insert into break_glass_grants")) return { rows: [row] };
      if (sql.includes("set status = 'REVOKED'")) {
        row.status = "REVOKED";
        row.revoked_at = new Date().toISOString();
        return { rows: [row] };
      }
      if (sql.includes("update break_glass_grants as grant_row")) {
        row.status = "REVIEWED";
        row.reviewed_by = approverId;
        row.reviewed_at = new Date().toISOString();
        row.review_note = "independent synthetic post-incident review";
        return { rows: [row] };
      }
      if (sql.includes("select id::text as id")) return { rows: [row] };
      return { rows: [] };
    },
    release(): void { /* no-op fake */ }
  } as unknown as PoolClient;
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: { connect: async (): Promise<PoolClient> => client } as unknown as Pool });
  const grant = await persistence.createBreakGlassGrant({ grantId: id(grantId), organizationId: id(organizationId), actorId: id(actorId), approverId: id(approverId), reason: "synthetic incident review", target: "patient:synthetic", mfaMethod: "WEBAUTHN", issuedAt, expiresAt });
  assert.equal(grant.status, "ACTIVE");
  assert.equal((await persistence.assertActiveBreakGlassGrant(id(organizationId), id(grantId))).grantId, id(grantId));
  assert.equal((await persistence.revokeBreakGlassGrant(id(organizationId), id(grantId))).status, "REVOKED");
  const reviewed = await persistence.reviewBreakGlassGrant(id(organizationId), id(grantId), id(approverId), "independent synthetic post-incident review");
  assert.equal(reviewed.status, "REVIEWED");
  assert.equal(reviewed.reviewedBy, id(approverId));
  assert.ok(statements.some((statement) => statement.includes("insert into break_glass_grants")));
  assert.ok(statements.some((statement) => statement.includes("update break_glass_grants set status = 'REVOKED'")));
  assert.ok(statements.some((statement) => statement.includes("update break_glass_grants as grant_row")));
});

test("Postgres persistence exposes readiness, revision and empty-snapshot boundaries", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  assert.deepEqual(await persistence.check(), { database: "cvg_synthetic", serverVersion: "16.0" });
  await assert.doesNotReject(() => persistence.assertSchema());
  assert.equal(await persistence.currentRevision(store.bootstrapCredentials.organizationId), 0n);
  assert.equal(await persistence.loadLatest(store.bootstrapCredentials.organizationId), null);
});

test("Postgres persistence rolls back a failed projection and rejects stale writers", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const failing = fakePool({ failSnapshotInsert: true });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: failing.pool });
  await assert.rejects(() => persistence.commit(commitInput(store)), (error: unknown) => error instanceof PersistenceUnavailableError);
  assert.ok(failing.statements.some((statement) => statement === "ROLLBACK"));

  const stale = fakePool({ revision: "4" });
  const stalePersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: stale.pool });
  await assert.rejects(() => stalePersistence.commit({ ...commitInput(store), expectedRevision: 3n }), (error: unknown) => error instanceof PersistenceConflictError && error.actualRevision === 4n);
  assert.ok(stale.statements.some((statement) => statement === "ROLLBACK"));
});

test("normal commit rejects recovered runtime projection before opening a connection", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const recoveredCommit = {
    ...commitInput(store),
    recoveredAgentSessions: [],
    recoveredAgentTurns: [],
    recoveredAgentCheckpoints: [],
    recoveredAgentLeases: []
  } as never;

  await assert.rejects(
    () => persistence.commit(recoveredCommit),
    (error: unknown) => error instanceof PersistenceStateError && error.message.includes("use restore")
  );
  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), eventType: "RESTORE_QUARANTINED" } as never),
    (error: unknown) => error instanceof PersistenceStateError && error.message.includes("restore event type")
  );
  assert.deepEqual(fake.statements, []);
});

test("Postgres persistence preserves corruption signals instead of downgrading them to outage", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  store.recordAudit({ organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, unitId: null, workspaceId: null, action: "test.corruption", resourceType: "Fixture", resourceId: null, result: "ALLOWED", reason: null, correlationId: "persistence-corruption", metadata: {} });
  const corrupt = fakePool({ auditLedgerConflict: true });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: corrupt.pool });
  await assert.rejects(() => persistence.commit({ ...commitInput(store), auditRecords: store.snapshot().auditRecords }), (error: unknown) => error instanceof Error && error.name === "PersistenceCorruptionError");
  assert.ok(corrupt.statements.some((statement) => statement === "ROLLBACK"));
});

test("outbox failure cannot mutate an expired lease", async () => {
  const statements: string[] = [];
  const client = {
    async query(sql: string): Promise<QueryResult> {
      statements.push(sql.trim().replace(/\s+/g, " "));
      return { rows: [] };
    },
    release(): void { /* no-op fake */ }
  } as unknown as PoolClient;
  const pool = { connect: async (): Promise<PoolClient> => client } as unknown as Pool;
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool });
  await assert.rejects(
    () => persistence.failOutbox(id("00000000-0000-4000-0000-000000000010"), id("00000000-0000-4000-0000-000000000905"), "worker-a", 7n, "expired lease"),
    (error: unknown) => error instanceof OutboxLeaseLostError
  );
  assert.ok(statements.some((statement) => statement.includes("and lease_until > now() returning status")));
  assert.ok(statements.includes("ROLLBACK"));
});

test("recovery bundle encryption round-trips BigInt state and rejects tampering", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const recoveryData = {
    revision: 7n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: []
  };
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "020_auth_security_boundary", checksum: "synthetic-checksum" }]) })
  };
  const key = randomBytes(32);
  const encrypted = encryptRecoveryBundle(bundle, key, "synthetic-kms-key");
  assert.equal(encrypted.algorithm, "AES-256-GCM");
  assert.equal(encrypted.version, 2);
  assert.equal(encrypted.expiresAt, null);
  assert.doesNotMatch(JSON.stringify(encrypted), /Marina Souza/);
  const restored = decryptRecoveryBundle(encrypted, key);
  assert.equal(restored.revision, 7n);
  assert.equal(restored.eventId, bundle.eventId);
  assert.equal(restored.manifest.watermark.revision, "7");
  assert.equal(restored.manifest.organizationId, store.bootstrapCredentials.organizationId);
  assert.equal(serializeSnapshot(restored.snapshot), serializeSnapshot(snapshot));

  const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
  assert.throws(() => decryptRecoveryBundle({ ...encrypted, ciphertext: ciphertext.toString("base64") }, key), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => decryptRecoveryBundle(encrypted, randomBytes(32)), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => encryptRecoveryBundle(bundle, randomBytes(31), "synthetic-kms-key"), (error: unknown) => error instanceof Error && error.name === "PersistenceStateError");
  const expired = encryptRecoveryBundle(bundle, key, "synthetic-kms-key", { expiresAt: new Date(Date.now() - 1_000).toISOString() });
  assert.throws(() => decryptRecoveryBundle(expired, key), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("expired"));
  assert.throws(() => decryptRecoveryBundle({ ...expired, expiresAt: "2099-01-01T00:00:00.000Z" }, key), (error: unknown) => error instanceof PersistenceCorruptionError);
});

test("recovery validation rejects a rehashed snapshot with a tampered audit chain", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  store.recordAudit({ organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, unitId: null, workspaceId: null, action: "recovery.audit.fixture", resourceType: "RecoveryFixture", resourceId: null, result: "ALLOWED", reason: null, correlationId: "recovery-audit-chain", metadata: { source: "test" } });
  const snapshot = store.snapshot();
  const tamperedSnapshot = structuredClone(snapshot);
  tamperedSnapshot.auditRecords[0]!.action = "recovery.audit.tampered";
  const recoveryData = {
    revision: 7n,
    snapshot: tamperedSnapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(tamperedSnapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: []
  };
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "036_runtime_migration_metadata_privileges", checksum: "synthetic-checksum" }]) })
  };
  assert.throws(() => validateRecoveryBundle(bundle), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("audit chain"));
  assert.throws(() => encryptRecoveryBundle(bundle, randomBytes(32), "synthetic-kms-key"), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("audit chain"));
});

test("sealed restore rejects invalid recovered agent state before connection", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const organizationId = store.bootstrapCredentials.organizationId;
  const invalidSessionWithoutDigest = {
    sessionId: randomUUID(),
    organizationId,
    actorId: randomUUID(),
    unitId: null,
    workspaceId: null,
    purpose: "SUMMARY",
    taskObjective: "invalid recovered actor",
    status: "ACTIVE",
    runState: "RUNNING",
    fence: 0,
    checkpointDigest: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:01.000Z",
    expiresAt: "2026-09-20T01:00:00.000Z"
  };
  const { recordDigest: _ignored, ...sessionContent } = invalidSessionWithoutDigest as Record<string, unknown>;
  const invalidSession = { ...invalidSessionWithoutDigest, recordDigest: digest(sessionContent) } as unknown as DurableAgentSessionRecord;
  const snapshot = store.snapshot();
  const recoveryData = {
    revision: 0n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: [],
    agentSessions: [invalidSession],
    agentTurns: [],
    agentCheckpoints: [],
    agentLeases: []
  };
  const bundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({
      organizationId,
      ...recoveryData,
      migrationFingerprint: "a".repeat(64)
    })
  } as unknown as DurableRecoveryBundle;
  const migrationRows = [{ version: "synthetic-restore-schema", checksum: "synthetic-restore-checksum" }];
  const migrationFingerprint = digest(migrationRows);
   const fake = fakePool({ migrationRows, failOnSecondConnectionBegin: true });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  await assert.rejects(
    () => persistence.restore({
      expectedRevision: null,
      bundle,
      migrationFingerprint: "a".repeat(64),
      authority: { role: "cvg_restore_authority", reference: "persistence-test" },
      operation: "test.sealed-restore",
      actorId: null,
      correlationId: "sealed-restore-test",
      aggregateType: "Restore",
      aggregateId: null,
      payload: { synthetic: true }
    }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("actorId")
  );
  assert.deepEqual(fake.statements, []);

  const validRecoveryData = {
    revision: 0n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: [],
    agentSessions: [],
    agentTurns: [],
    agentCheckpoints: [],
    agentLeases: []
  };
  const validBundle = {
    ...validRecoveryData,
    manifest: createRecoveryBundleManifest({ organizationId, ...validRecoveryData, migrationFingerprint })
  } as unknown as DurableRecoveryBundle;

  await assert.rejects(
    () => persistence.restore({
      expectedRevision: null,
      bundle: validBundle,
      migrationFingerprint,
      authority: undefined as never,
      operation: "test.sealed-restore-authority",
      actorId: null,
      correlationId: "sealed-restore-authority-test",
      aggregateType: "Restore",
      aggregateId: null,
      payload: { synthetic: true }
    }),
    (error: unknown) => error instanceof PersistenceStateError && error.message.includes("dedicated restore authority")
  );

  await assert.rejects(
    () => persistence.restore({
      expectedRevision: null,
      bundle: validBundle,
      migrationFingerprint: "c".repeat(64),
      authority: { role: "cvg_restore_authority", reference: "persistence-test" },
      operation: "test.sealed-restore-fingerprint",
      actorId: null,
      correlationId: "sealed-restore-fingerprint-test",
      aggregateType: "Restore",
      aggregateId: null,
      payload: { synthetic: true }
    }),
    (error: unknown) => error instanceof PersistenceStateError && error.message.includes("migration fingerprint")
  );
  assert.deepEqual(fake.statements, []);

  const baseRestoreInput: DurableRestoreInput = {
    expectedRevision: null,
    bundle: validBundle,
    migrationFingerprint,
    authority: { role: "cvg_restore_authority", reference: "persistence-test" },
    operation: "test.sealed-restore-destination-authority",
    actorId: null,
    correlationId: "sealed-restore-destination-authority-test",
    aggregateType: "Restore",
    aggregateId: null,
    payload: { synthetic: true }
  };
  const assertDestinationRejects = async (options: Parameters<typeof fakePool>[0], message: string): Promise<void> => {
    const destination = fakePool({ migrationRows, ...options });
    const destinationPersistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: destination.pool });
    await assert.rejects(
      () => destinationPersistence.restore(baseRestoreInput),
      (error: unknown) => error instanceof PersistenceStateError && error.message.includes(message)
    );
    assert.equal(destination.statements.some((statement) => statement === "BEGIN"), false);
  };
  await assertDestinationRejects({ sessionUser: "cvg_maintenance" }, "schema-owner executor connection");
  await assertDestinationRejects({ restoreRoleLogin: true }, "authority role contract");
  await assertDestinationRejects({ restoreRoleCreatedb: true }, "authority role contract");
  await assertDestinationRejects({ restoreRoleCreateRole: true }, "authority role contract");
  await assertDestinationRejects({ restoreRoleReplication: true }, "authority role contract");
  await assertDestinationRejects({ schemaOwnerCanAssumeRestore: false }, "not a member of the dedicated restore authority");
  await assertDestinationRejects({ runtimeCanAssumeRestore: true }, "runtime role must not be a member");
  await assertDestinationRejects({ migrationRows: [{ version: "synthetic-restore-schema", checksum: "destination-drift" }] }, "migration fingerprint");

  const restored = await persistence.restore({
    ...baseRestoreInput,
    operation: "test.sealed-restore-known-good",
    correlationId: "sealed-restore-known-good-test"
  });
  assert.equal(restored.revision, 1n);
  assert.equal(fake.connectCount, 1, "restore must use one PoolClient from authority preflight through commit");
  assert.equal(fake.releaseCount, 1, "restore must release the shared PoolClient exactly once");
  assert.ok(fake.statements.some((statement) => statement === 'set local role "cvg_restore_authority"'));
  assert.ok(fake.statements.some((statement) => statement === "reset role"));
});

test("recovery validation binds durable ledger digests to immutable record content", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const organizationId = store.bootstrapCredentials.organizationId;
  const aggregateId = id(randomUUID());
  const outboxRecord: DurableOutboxRecord = {
    id: id(randomUUID()),
    organizationId,
    eventType: "recovery.ledger.fixture",
    aggregateId,
    payload: { source: "fixture", value: 1 },
    status: "PENDING",
    attempts: 0,
    availableAt: "2026-09-10T00:00:00.000Z",
    claimedBy: null,
    leaseUntil: null,
    fenceToken: 0n,
    lastError: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    processedAt: null,
    recordDigest: digest({ organizationId, eventType: "recovery.ledger.fixture", aggregateId, payload: { source: "fixture", value: 1 } })
  };
  const recoveryData = {
    revision: 7n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [outboxRecord],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: []
  };
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({ organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "036_runtime_migration_metadata_privileges", checksum: "synthetic-checksum" }]) })
  };
  assert.doesNotThrow(() => validateRecoveryBundle(bundle));

  const tamperedOutbox = { ...outboxRecord, payload: { source: "fixture", value: 2 } };
  const tamperedBundle: DurableRecoveryBundle = {
    ...bundle,
    outboxRecords: [tamperedOutbox],
    manifest: createRecoveryBundleManifest({
      organizationId,
      revision: bundle.revision,
      snapshotDigest: bundle.snapshotDigest,
      eventId: bundle.eventId,
      outboxRecords: [tamperedOutbox],
      usageRecords: [],
      inboxRecords: [],
      externalEffects: [],
      migrationFingerprint: bundle.manifest.migrationFingerprint,
      createdAt: bundle.manifest.createdAt
    })
  };
  assert.throws(() => validateRecoveryBundle(tamperedBundle), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("outboxRecords[0].recordDigest"));
  assert.throws(() => encryptRecoveryBundle(tamperedBundle, randomBytes(32), "synthetic-kms-key"), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("outboxRecords[0].recordDigest"));
});

test("sealed restore projects non-empty recovery ledgers under the restore authority", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const organizationId = store.bootstrapCredentials.organizationId;
  const actorId = store.bootstrapCredentials.userId;
  const timestamp = "2026-09-20T00:00:00.000Z";
  const sessionId = randomUUID();
  const outboxId = id(randomUUID());
  const usageId = id(randomUUID());
  const checkpointPayload = { step: 1 };
  const contentDigest = (record: Record<string, unknown>): string => {
    const { recordDigest: _recordDigest, checkpointId: _checkpointId, ...content } = record;
    return digest(content);
  };
  const session = { sessionId, organizationId, actorId, unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "restore ledgers", status: "ACTIVE", runState: "RUNNING", fence: 2, checkpointDigest: checkpointDigest(checkpointPayload, 1), createdAt: timestamp, updatedAt: "2026-09-20T00:00:10.000Z", expiresAt: "2026-09-20T01:00:00.000Z" };
  const turn = { turnId: randomUUID(), sessionId, organizationId, sequence: 1, status: "COMPLETED", inputDigest: "a".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: { provider: "synthetic" }, startedAt: "2026-09-20T00:00:02.000Z", completedAt: "2026-09-20T00:00:03.000Z", fence: 1 };
  const checkpoint = { checkpointId: "1", sessionId, organizationId, sequence: 1, schemaVersion: 1, digest: checkpointDigest(checkpointPayload, 1), payload: checkpointPayload, fence: 1, createdAt: "2026-09-20T00:00:04.000Z" };
  const lease = { sessionId, organizationId, ownerId: "restore-owner", fence: 2, acquiredAt: "2026-09-20T00:00:05.000Z", expiresAt: "2026-09-20T00:10:05.000Z" };
  const agentSessions = [{ ...session, recordDigest: contentDigest(session) }] as unknown as DurableAgentSessionRecord[];
  const agentTurns = [{ ...turn, recordDigest: contentDigest(turn) }] as unknown as DurableAgentTurnRecord[];
  const agentCheckpoints = [{ ...checkpoint, recordDigest: contentDigest(checkpoint) }] as unknown as DurableAgentCheckpointRecord[];
  const agentLeases = [{ ...lease, recordDigest: contentDigest(lease) }] as unknown as DurableAgentLeaseRecord[];
  const usage = {
    id: usageId, organizationId, reservationId: null, providerRequestId: null, idempotencyKey: "restore-usage-1", usageKind: "TOKENS", reservedUnits: 4, consumedUnits: 4, status: "SETTLED" as const, record: { synthetic: true }, createdAt: timestamp,
    recordDigest: digest({ organizationId, reservationId: null, providerRequestId: null, idempotencyKey: "restore-usage-1", usageKind: "TOKENS", reservedUnits: 4, consumedUnits: 4, status: "SETTLED", record: { synthetic: true } })
  } as DurableUsageRecord;
  const outbox = {
    id: outboxId, organizationId, eventType: "restore.synthetic", aggregateId: organizationId, payload: { synthetic: true }, status: "PENDING" as const, attempts: 0, availableAt: timestamp, claimedBy: null, leaseUntil: null, fenceToken: 0n, lastError: null, createdAt: timestamp, processedAt: null,
    recordDigest: digest({ organizationId, eventType: "restore.synthetic", aggregateId: organizationId, payload: { synthetic: true } })
  } as DurableOutboxRecord;
  const inbox = {
    id: id(randomUUID()), organizationId, consumer: "restore-consumer", provider: "synthetic", externalEventId: "restore-event-1", eventType: "restore.event", schemaVersion: 1, signatureAlgorithm: "HMAC-SHA256" as const, signatureKeyRef: "restore-key", signature: "a".repeat(64), payload: { synthetic: true }, status: "RECEIVED" as const, conflictDigest: null, lastError: null, receivedAt: timestamp, processedAt: null, lastSeenAt: timestamp,
    recordDigest: digest({ organizationId, consumer: "restore-consumer", provider: "synthetic", externalEventId: "restore-event-1", eventType: "restore.event", schemaVersion: 1, signatureAlgorithm: "HMAC-SHA256", signatureKeyRef: "restore-key", payload: { synthetic: true } })
  } as DurableInboxRecord;
  const externalEffect = {
    id: id(randomUUID()), organizationId, outboxId, integrationId: "restore-integration", idempotencyKey: "restore-effect-1", request: { synthetic: true }, status: "ADMISSION_PENDING" as const, attempts: 0, claimedBy: null, leaseUntil: null, fenceToken: 0n, providerRequestId: null, response: null, lastError: null, outcomeDigest: null, reconciliationSource: null, reconciledAt: null, createdAt: timestamp, updatedAt: timestamp,
    requestDigest: digest({ organizationId, outboxId, integrationId: "restore-integration", idempotencyKey: "restore-effect-1", request: { synthetic: true } })
  } as DurableExternalEffectRecord;
  const workerJob = {
    id: id(randomUUID()), organizationId, lane: "jobs" as const, jobType: "restore.synthetic", idempotencyKey: "restore-job-1", payload: { synthetic: true }, status: "PENDING" as const, attempts: 0, maxAttempts: 2, availableAt: timestamp, claimedBy: null, leaseUntil: null, fenceToken: 0n, lastError: null, createdAt: timestamp, processedAt: null,
    recordDigest: digest({ organizationId, lane: "jobs", jobType: "restore.synthetic", idempotencyKey: "restore-job-1", payload: { synthetic: true }, maxAttempts: 2, availableAt: timestamp })
  } as DurableWorkerJobRecord;
  const snapshot = store.snapshot();
  const recoveryData = { revision: 7n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(), outboxRecords: [outbox], usageRecords: [usage], inboxRecords: [inbox], externalEffects: [externalEffect], workerJobs: [workerJob], agentSessions, agentTurns, agentCheckpoints, agentLeases };
  const migrationRows = [{ version: "synthetic-restore-runtime", checksum: "synthetic-restore-runtime-checksum" }];
  const migrationFingerprint = digest(migrationRows);
  const bundle: DurableRecoveryBundle = { ...recoveryData, manifest: createRecoveryBundleManifest({ organizationId, ...recoveryData, migrationFingerprint }) };
  const fake = fakePool({ migrationRows, recoveredProjectionRows: true });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });

  const restored = await persistence.restore({ expectedRevision: null, bundle, migrationFingerprint, authority: { role: "cvg_restore_authority", reference: "non-empty-ledger-restore" }, operation: "test.restore-non-empty-ledgers", actorId: null, correlationId: "restore-non-empty-ledgers", aggregateType: "Restore", aggregateId: null, payload: { synthetic: true } });
  assert.equal(restored.revision, 1n);
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into outbox_records")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into ai_usage_ledger")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into integration_inbox_records")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into external_effects")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into cvg_worker_jobs")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into agent_sessions")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into agent_turns")));
  assert.ok(fake.statements.some((statement) => statement.startsWith("insert into agent_checkpoints")));
  assert.ok(fake.statements.includes('set local role "cvg_restore_authority"'));
  assert.ok(fake.statements.includes("reset role"));
});

test("recovery validation rejects authentication records with missing temporal fields", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  store.createSession(store.bootstrapCredentials.userId, digest("recovery-auth-session"), "synthetic-csrf", 60);
  store.createAuthChallenge("MFA", store.bootstrapCredentials.userId, digest("recovery-auth-challenge"), 60, 3);
  const createBundle = (snapshot: ReturnType<CvgStore["snapshot"]>): DurableRecoveryBundle => {
    const recoveryData = {
      revision: 7n,
      snapshot,
      snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
      eventId: randomUUID(),
      outboxRecords: [],
      usageRecords: [],
      inboxRecords: [],
      externalEffects: []
    };
    return {
      ...recoveryData,
      manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "036_runtime_migration_metadata_privileges", checksum: "synthetic-checksum" }]) })
    };
  };

  const missingExpiresAt = store.snapshot();
  missingExpiresAt.sessions[0]!.expiresAt = undefined as never;
  const missingExpiresAtBundle = createBundle(missingExpiresAt);
  assert.throws(() => validateRecoveryBundle(missingExpiresAtBundle), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("snapshot.sessions[0].expiresAt"));
  assert.throws(() => encryptRecoveryBundle(missingExpiresAtBundle, randomBytes(32), "synthetic-kms-key"), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("snapshot.sessions[0].expiresAt"));

  const missingCreatedAt = structuredClone(store.snapshot());
  delete (missingCreatedAt.sessions[0] as unknown as Record<string, unknown>).createdAt;
  const missingCreatedAtBundle = createBundle(missingCreatedAt);
  assert.throws(() => validateRecoveryBundle(missingCreatedAtBundle), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("snapshot.sessions[0].createdAt"));

  const missingChallengeCreatedAt = structuredClone(store.snapshot());
  delete (missingChallengeCreatedAt.authChallenges[0] as unknown as Record<string, unknown>).createdAt;
  const missingChallengeCreatedAtBundle = createBundle(missingChallengeCreatedAt);
  assert.throws(() => validateRecoveryBundle(missingChallengeCreatedAtBundle), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("snapshot.authChallenges[0].createdAt"));

  const missingSecurity = structuredClone(store.snapshot());
  delete (missingSecurity.users[0] as unknown as Record<string, unknown>).security;
  const missingSecurityBundle = createBundle(missingSecurity);
  assert.throws(() => validateRecoveryBundle(missingSecurityBundle), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("snapshot.users[0].security"));
});

test("CVG-AUD19-010: recovery bundle validates, binds and rejects agent runtime state", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const organizationId = store.bootstrapCredentials.organizationId;
  const snapshot = store.snapshot();
  const snapshotDigest = digest(JSON.parse(serializeSnapshot(snapshot)));
  const migrationFingerprint = digest([{ version: "041_agent_restore_fence_guard", checksum: "synthetic-checksum" }]);
  const sessionId = randomUUID();
  const actorId = store.bootstrapCredentials.userId;
  const agentContentDigest = (record: Record<string, unknown>): string => {
    const { recordDigest: _recordDigest, checkpointId: _checkpointId, ...content } = record;
    return digest(content);
  };
   const checkpointPayload = { step: 1 };
   const session = { sessionId, organizationId, actorId, unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "bundle", status: "ACTIVE", runState: "CREATED", fence: 2, checkpointDigest: checkpointDigest(checkpointPayload, 1), createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:01:00.000Z", expiresAt: "2026-09-20T01:00:00.000Z" };
  const turnOne = { turnId: randomUUID(), sessionId, organizationId, sequence: 1, status: "COMPLETED", inputDigest: "a".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: { provider: "fixture" }, startedAt: "2026-09-20T00:00:10.000Z", completedAt: "2026-09-20T00:00:11.000Z", fence: 1 };
  const turnTwo = { ...turnOne, turnId: randomUUID(), sequence: 2, fence: 2, startedAt: "2026-09-20T00:00:20.000Z", completedAt: "2026-09-20T00:00:21.000Z" };
   const checkpoint = { checkpointId: "1", sessionId, organizationId, sequence: 1, schemaVersion: 1, digest: checkpointDigest(checkpointPayload, 1), payload: checkpointPayload, fence: 1, createdAt: "2026-09-20T00:00:12.000Z" };
  const lease = { sessionId, organizationId, ownerId: "fixture-owner", fence: 2, acquiredAt: "2026-09-20T00:00:30.000Z", expiresAt: "2026-09-20T00:10:30.000Z" };
  const withDigests = <T extends Record<string, unknown>>(record: T): T & { recordDigest: string } => ({ ...record, recordDigest: agentContentDigest(record) });
  const agentSessions = [withDigests(session)];
  const agentTurns = [withDigests(turnOne), withDigests(turnTwo)];
  const agentCheckpoints = [withDigests(checkpoint)];
  const agentLeases = [withDigests(lease)];
  const recoveryData = { revision: 7n, snapshot, snapshotDigest, eventId: randomUUID(), outboxRecords: [], usageRecords: [], inboxRecords: [], externalEffects: [] };
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    agentSessions,
    agentTurns,
    agentCheckpoints,
    agentLeases,
    manifest: createRecoveryBundleManifest({ organizationId, ...recoveryData, migrationFingerprint, agentSessions, agentTurns, agentCheckpoints, agentLeases })
  };
  assert.doesNotThrow(() => validateRecoveryBundle(bundle));
  assert.doesNotThrow(() => assertRestorableRecoveryBundle(bundle));

  // A legacy bundle still validates but restore rejects it explicitly.
  const legacy: DurableRecoveryBundle = { ...recoveryData, manifest: createRecoveryBundleManifest({ organizationId, ...recoveryData, migrationFingerprint }) };
  assert.doesNotThrow(() => validateRecoveryBundle(legacy));
  assert.throws(() => assertRestorableRecoveryBundle(legacy), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("predates agent runtime state"));

  // Tampered content, cross-tenant record and non-deterministic ordering fail closed.
  const tamperedTurn = { ...agentTurns[1]!, status: "FAILED" };
  const tampered: DurableRecoveryBundle = { ...bundle, agentTurns: [agentTurns[0]!, tamperedTurn] };
  assert.throws(() => validateRecoveryBundle(tampered), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("agentTurns[1].recordDigest"));
  const foreignSession = withDigests({ ...session, organizationId: randomUUID() });
  const crossTenant: DurableRecoveryBundle = { ...bundle, agentSessions: [foreignSession] };
  assert.throws(() => validateRecoveryBundle(crossTenant), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("different organization scope"));
  const outOfOrder: DurableRecoveryBundle = { ...bundle, agentTurns: [agentTurns[1]!, agentTurns[0]!] };
  assert.throws(() => validateRecoveryBundle(outOfOrder), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("not ordered deterministically"));
});

test("operational backup writes an atomic manifest, verifies before rotation and rejects tampering", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const recoveryData = { revision: 7n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(), outboxRecords: [], usageRecords: [], inboxRecords: [], externalEffects: [] };
  const migrationFingerprint = digest([{ version: "034_diagnostic_child_integrity_backstop", checksum: "synthetic-checksum" }]);
  const bundle: DurableRecoveryBundle = { ...recoveryData, manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint }) };
  const key = randomBytes(32);
  const directory = await mkdtemp(join(tmpdir(), "cvg-operational-backup-"));
  try {
    const first = await writeOperationalBackup({ directory, bundle, key, keyRef: "synthetic-backup-key", backupId: "backup-1", createdAt: "2026-09-10T00:00:00.000Z", retention: { keepLast: 2 } });
    assert.deepEqual(await rotateOperationalBackups(join(directory, "not-created-yet")), []);
    await assert.rejects(() => writeOperationalBackup({ directory, bundle, key, keyRef: "synthetic-backup-key", backupId: "invalid id" }), /backup id is invalid/);
    await assert.rejects(() => writeOperationalBackup({ directory, bundle, key, keyRef: "synthetic-backup-key", createdAt: "invalid" }), /createdAt must be a valid timestamp/);
    await assert.rejects(() => writeOperationalBackup({ directory, bundle, key, keyRef: "synthetic-backup-key", expiresAt: "invalid" }), /expiresAt must be a valid timestamp/);
    await assert.rejects(() => rotateOperationalBackups(directory, { keepLast: 0 }), /keepLast must be between/);
    const secondDirectory = await mkdtemp(join(tmpdir(), "cvg-operational-backup-existing-"));
    try {
      await chmod(secondDirectory, 0o755);
      const secured = await writeOperationalBackup({ directory: secondDirectory, bundle, key, keyRef: "synthetic-backup-key", backupId: "backup-existing-dir", createdAt: "2026-09-10T00:30:00.000Z", retention: { keepLast: 2 } });
      assert.equal((await stat(secondDirectory)).mode & 0o777, 0o700);
      assert.equal((await stat(secured.path)).mode & 0o777, 0o600);
      assert.deepEqual(await rotateOperationalBackups(secondDirectory, { keepLast: 10, maxAgeMs: 0, now: "2026-09-11T00:00:00.000Z" }), [secured.path]);
    } finally {
      await rm(secondDirectory, { recursive: true, force: true });
    }
    const second = await writeOperationalBackup({ directory, bundle, key, keyRef: "synthetic-backup-key", backupId: "backup-2", createdAt: "2026-09-10T01:00:00.000Z", retention: { keepLast: 2 } });
    const third = await writeOperationalBackup({ directory, bundle, key, keyRef: "synthetic-backup-key", backupId: "backup-3", createdAt: "2026-09-10T02:00:00.000Z", retention: { keepLast: 2 } });
    assert.deepEqual(third.removed, [first.path]);
    const verified = await verifyOperationalBackupDirectory({ directory, resolveKey: (keyRef) => keyRef === "synthetic-backup-key" ? key : null, expectedMigrationFingerprint: migrationFingerprint, retention: { keepLast: 2 } });
    assert.equal(verified.verified.length, 2);
    assert.deepEqual(verified.verified.map((entry) => entry.manifest.backupId), ["backup-2", "backup-3"]);
    assert.equal(verified.removed.length, 0);
    const restored = await verifyOperationalBackupFile(second.path, key, { expectedMigrationFingerprint: migrationFingerprint });
    assert.equal(restored.bundle.revision, 7n);
    const tampered = JSON.parse(await readFile(second.path, "utf8")) as { envelope: { ciphertext: string }; manifest: { envelopeDigest: string } };
    tampered.envelope.ciphertext = `${tampered.envelope.ciphertext.slice(0, -4)}AAAA`;
    await writeFile(second.path, `${JSON.stringify(tampered)}\n`, { encoding: "utf8", mode: 0o600 });
    await assert.rejects(() => verifyOperationalBackupDirectory({ directory, resolveKey: () => key, retention: { keepLast: 2 } }), (error: unknown) => error instanceof PersistenceCorruptionError);
    await assert.rejects(() => verifyOperationalBackupFile(third.path, randomBytes(32)), (error: unknown) => error instanceof PersistenceCorruptionError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("operational backup job runs periodically, serializes ticks and records failures", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const recoveryData = { revision: 8n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(), outboxRecords: [], usageRecords: [], inboxRecords: [], externalEffects: [] };
  const migrationFingerprint = digest([{ version: "034_diagnostic_child_integrity_backstop", checksum: "synthetic-checksum" }]);
  const bundle: DurableRecoveryBundle = { ...recoveryData, manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint }) };
  const key = randomBytes(32);
  const directory = await mkdtemp(join(tmpdir(), "cvg-operational-backup-job-"));
  let created = 0;
  try {
    const job = new OperationalBackupJob({
      directory,
      keyRef: "synthetic-backup-key",
      intervalMs: 10,
      createBundle: async () => {
        created += 1;
        return bundle;
      },
      resolveKey: (keyRef) => keyRef === "synthetic-backup-key" ? key : null,
      expectedMigrationFingerprint: migrationFingerprint,
      retention: { keepLast: 2 }
    });
    const [first, second] = await Promise.all([job.runOnce(), job.runOnce()]);
    assert.equal(first.verification.verified.length, 1);
    assert.equal(second.verification.verified.length, 1);
    assert.equal(created, 1);
    const next = await job.runOnce();
    assert.equal(next.verification.verified.length, 2);
    assert.equal(created, 2);
    assert.equal(job.status().lastFailure, null);
    job.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await job.stop();
    assert.equal(job.status().running, false);
    assert.ok(created >= 3);

    const failed = new OperationalBackupJob({ directory, keyRef: "missing-key", intervalMs: 10, createBundle: async () => bundle, resolveKey: () => null, retention: { keepLast: 2 } });
    await assert.rejects(() => failed.runOnce(), (error: unknown) => error instanceof PersistenceUnavailableError);
    assert.match(failed.status().lastFailure ?? "", /key is unavailable/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("governed export binds policy, secret resolution and idempotent encrypted delivery", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const session = store.createSession(store.bootstrapCredentials.userId, digest("export-token"), "synthetic-csrf", 60);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "ops.export", "export-test", null, null, session.id);
  const snapshot = store.snapshot();
  const recoveryData = { revision: 9n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(), outboxRecords: [], usageRecords: [], inboxRecords: [], externalEffects: [] };
  const bundle: DurableRecoveryBundle = { ...recoveryData, manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "029_ai_turn_provenance_usage_and_dml_scope", checksum: "synthetic-checksum" }]) }) };
  const persistence = { exportRecoveryBundle: async () => bundle } as unknown as PostgresPersistence;
  const key = randomBytes(32).toString("base64");
  const secretProvider = { status: () => "READY" as const, has: (reference: string) => reference === "synthetic-export-key", resolve: async (reference: string) => reference === "synthetic-export-key" ? key : null };
  const service = new ExportApplicationService(store, persistence, secretProvider, "synthetic-export-key");
  const first = await service.create(context, { purpose: "INCIDENT_RECOVERY", scopeType: "ORGANIZATION", ttlSeconds: 300 }, "export-idempotency-1");
  const replay = await service.create(context, { purpose: "INCIDENT_RECOVERY", scopeType: "ORGANIZATION", ttlSeconds: 300 }, "export-idempotency-1");
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.value.envelope.ciphertext, first.value.envelope.ciphertext);
  assert.equal(replay.value.envelope.expiresAt, first.value.envelope.expiresAt);
  assert.equal(first.value.purpose, "INCIDENT_RECOVERY");
  assert.equal(first.value.purposeDigest, digest("INCIDENT_RECOVERY"));
  assert.doesNotMatch(JSON.stringify(first.value.envelope), /Marina Souza/);
  assert.equal(first.value.scope.organizationId, store.bootstrapCredentials.organizationId);
  assert.equal(first.value.scope.unitId, null);
  assert.equal(first.value.scope.workspaceId, null);
  await assert.rejects(() => service.create(context, { purpose: "INCIDENT_RECOVERY", scopeType: "UNIT", ttlSeconds: 300 } as never, "export-narrow-scope"), /registry/);
  await assert.rejects(() => service.create(context, { purpose: "free-form export", scopeType: "ORGANIZATION", ttlSeconds: 300 } as never, "export-free-form"), /registry/);
});

test("governed export rejects expired, tampered, wrong-key and cross-organization recovery use", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
  assert.ok(option);
  const session = store.createSession(store.bootstrapCredentials.userId, digest("export-negative-token"), "synthetic-csrf", 60);
  const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "ops.export", "export-negative-test", null, null, session.id);
  const snapshot = store.snapshot();
  const recoveryData = { revision: 12n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(), outboxRecords: [], usageRecords: [], inboxRecords: [], externalEffects: [] };
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "030_break_glass_durable_lifecycle", checksum: "synthetic-checksum" }]) })
  };
  const persistence = { exportRecoveryBundle: async () => bundle } as unknown as PostgresPersistence;
  const key = randomBytes(32).toString("base64");
  const secretProvider = { status: () => "READY" as const, has: (reference: string) => reference === "synthetic-export-key", resolve: async (reference: string) => reference === "synthetic-export-key" ? key : null };
  const service = new ExportApplicationService(store, persistence, secretProvider, "synthetic-export-key");
  const exported = await service.create(context, { purpose: "AUDIT_REVIEW", scopeType: "ORGANIZATION", ttlSeconds: 300 }, "export-negative-idempotency");

  const expiredEnvelope = { ...exported.value.envelope, expiresAt: new Date(Date.now() - 1_000).toISOString() };
  assert.throws(() => decryptRecoveryBundle(expiredEnvelope, Buffer.from(key, "base64")), (error: unknown) => error instanceof PersistenceStateError || error instanceof PersistenceCorruptionError);
  const tamperedCiphertext = Buffer.from(exported.value.envelope.ciphertext, "base64");
  tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1;
  assert.throws(() => decryptRecoveryBundle({ ...exported.value.envelope, ciphertext: tamperedCiphertext.toString("base64") }, Buffer.from(key, "base64")), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => decryptRecoveryBundle(exported.value.envelope, randomBytes(32)), (error: unknown) => error instanceof PersistenceCorruptionError);

  const foreignContext = { ...context, organizationId: makeId() } as typeof context;
  await assert.rejects(() => service.create(foreignContext, { purpose: "AUDIT_REVIEW", scopeType: "ORGANIZATION", ttlSeconds: 300 }, "export-cross-org"), /context|organiza|sessão|escopo/i);
});

test("recovery manifest rejects partial, stale, and migration-incompatible restores", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const recoveryData = {
    revision: 7n,
    snapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))),
    eventId: randomUUID(),
    outboxRecords: [],
    usageRecords: [],
    inboxRecords: [],
    externalEffects: []
  };
  const migrationFingerprint = digest([{ version: "020_auth_security_boundary", checksum: "synthetic-checksum" }]);
  const bundle: DurableRecoveryBundle = {
    ...recoveryData,
    manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...recoveryData, migrationFingerprint, createdAt: "2026-09-09T00:00:00.000Z" })
  };
  assert.doesNotThrow(() => validateRecoveryBundle(bundle, { expectedMigrationFingerprint: migrationFingerprint, minimumRevision: 7n, maxAgeMs: 86_400_000, now: "2026-09-09T12:00:00.000Z" }));
  assert.throws(() => validateRecoveryBundle(bundle, { expectedMigrationFingerprint: "invalid" }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("expected recovery migration fingerprint"));
  assert.throws(() => validateRecoveryBundle(bundle, { minimumRevision: -1n }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("minimum recovery revision"));
  assert.throws(() => validateRecoveryBundle(bundle, { maxAgeMs: -1 }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("maximum recovery bundle age"));
  assert.throws(() => validateRecoveryBundle(bundle, { maxAgeMs: 60_000, now: "invalid" }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("reference time"));
  assert.throws(() => validateRecoveryBundle(bundle, { maxAgeMs: 60_000, now: "2026-09-08T12:00:00.000Z" }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("future"));

  const partial = { ...bundle, inboxRecords: undefined } as unknown as DurableRecoveryBundle;
  assert.throws(() => validateRecoveryBundle(partial), (error: unknown) => error instanceof PersistenceCorruptionError);
  assert.throws(() => validateRecoveryBundle(bundle, { minimumRevision: 8n }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("stale"));
  assert.throws(() => validateRecoveryBundle(bundle, { maxAgeMs: 60_000, now: "2026-09-09T12:00:00.000Z" }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("stale"));
  assert.throws(() => validateRecoveryBundle(bundle, { expectedMigrationFingerprint: digest([{ version: "021_future", checksum: "different" }]) }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("migration fingerprint"));

  const mismatchedWatermark = { ...bundle, manifest: { ...bundle.manifest, watermark: { ...bundle.manifest.watermark, revision: "6" } } };
  assert.throws(() => validateRecoveryBundle(mismatchedWatermark), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("watermark"));

  const invalidSnapshot = store.snapshot();
  invalidSnapshot.appointments[0]!.patientId = id("00000000-0000-4000-8000-000000009992");
  const invalidRecoveryData = {
    ...recoveryData,
    snapshot: invalidSnapshot,
    snapshotDigest: digest(JSON.parse(serializeSnapshot(invalidSnapshot)))
  };
  const invalidRecoveryBundle: DurableRecoveryBundle = {
    ...invalidRecoveryData,
    manifest: createRecoveryBundleManifest({ organizationId: store.bootstrapCredentials.organizationId, ...invalidRecoveryData, migrationFingerprint, createdAt: "2026-09-09T00:00:00.000Z" })
  };
  assert.throws(() => validateRecoveryBundle(invalidRecoveryBundle), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("snapshot failed validation"));
});

test("PostgreSQL runtime wires bootstrap and HTTP mutations through the durable boundary", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  assert.equal(runtime.store.storageMode, "postgres");
  const result = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
  assert.equal(result.statusCode, 200);
  assert.ok(fake.statements.filter((statement) => statement === "COMMIT").length >= 2);
  assert.ok(fake.statements.some((statement) => statement.includes("insert into cvg_event_journal")));
  await runtime.app.close();
});

test("a final durable commit failure settles the claimed command as OUTCOME_UNKNOWN", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  // Bootstrap and login commits succeed; the first idempotent patient commit
  // fails after the claim has already been durably admitted.
  const fake = fakePool({ failSnapshotInsertAfter: 3 });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    const guardian = [...runtime.store.guardians.values()].find((candidate) => candidate.unitId === unit?.id && candidate.workspaceId === workspace?.id);
    assert.ok(unit && workspace && guardian);
    const failed = await runtime.app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "idempotency-key": "patient-final-commit-failure-001", "content-type": "application/json" },
      payload: JSON.stringify({ guardianId: guardian.id, name: "Nina Final Commit", species: "Felina", breed: null, sex: "FEMALE", reproductiveStatus: "NEUTERED", birthDate: null, identifiers: ["MICRO-FINAL-001"] })
    });
    assert.equal(failed.statusCode, 503, failed.body);
    const receipt = [...fake.durableReceipts.values()].find((candidate) => candidate.operation === "patients.create");
    assert.ok(receipt);
    assert.equal(receipt.status, "OUTCOME_UNKNOWN");
    assert.equal(typeof receipt.completed_at, "string");
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL patient creation commits its normalized source row before the HTTP response", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    const guardian = [...runtime.store.guardians.values()].find((candidate) => candidate.unitId === unit?.id && candidate.workspaceId === workspace?.id);
    assert.ok(unit && workspace && guardian);
    const created = await runtime.app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "idempotency-key": "patient-http-source-001", "content-type": "application/json" },
      payload: JSON.stringify({ guardianId: guardian.id, name: "Nina HTTP", species: "Felina", breed: null, sex: "FEMALE", reproductiveStatus: "NEUTERED", birthDate: null, identifiers: ["MICRO-HTTP-001"] })
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.ok(fake.statements.some((statement) => statement.startsWith("insert into patients") && statement.includes("returning id::text")));
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL guardian creation commits one normalized row and replays without a second guardian DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    assert.ok(unit && workspace);
    const headers = { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "idempotency-key": "guardian-http-source-001", "content-type": "application/json" };
    const payload = JSON.stringify({ displayName: "Marina HTTP", phone: "+55 11 98888-1202", email: "marina.http@example.test" });
    const created = await runtime.app.inject({ method: "POST", url: "/api/v1/guardians", headers, payload });
    assert.equal(created.statusCode, 201, created.body);
    const replay = await runtime.app.inject({ method: "POST", url: "/api/v1/guardians", headers, payload });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into guardians") && statement.includes("returning id::text")).length, 1);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into command_receipts") && statement.includes("on conflict (idempotency_lookup)")).length, 1);
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL stock product creation commits once and replays without a second product DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    assert.ok(unit && workspace);
    const headers = { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "idempotency-key": "product-http-source-001", "content-type": "application/json" };
    const payload = JSON.stringify({ sku: "SKU-HTTP-PRODUCT-001", name: "Produto HTTP sintético", category: "INSUMO", unit: "unidade", reorderPoint: 2 });
    const created = await runtime.app.inject({ method: "POST", url: "/api/v1/stock/products", headers, payload });
    assert.equal(created.statusCode, 201, created.body);
    const productId = (created.json() as { data: { product: { id: string } } }).data.product.id;
    const replay = await runtime.app.inject({ method: "POST", url: "/api/v1/stock/products", headers, payload });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal((replay.json() as { data: { product: { id: string } } }).data.product.id, productId);
    assert.equal(fake.productStatements.filter(({ params }) => params[0] === productId).length, 1);
    assert.ok(fake.productStatements.some(({ params, sql }) => params[0] === productId && sql.includes("returning id::text")));
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into command_receipts") && statement.includes("on conflict (idempotency_lookup)")).length, 1);
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL stock product SKU collision returns 409 and settles its receipt as failed", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool({ productSkuConflict: true });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    assert.ok(unit && workspace);
    const created = await runtime.app.inject({
      method: "POST",
      url: "/api/v1/stock/products",
      headers: { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "idempotency-key": "product-sku-conflict-http-001", "content-type": "application/json" },
      payload: JSON.stringify({ sku: "SKU-HTTP-PRODUCT-CONFLICT-001", name: "Produto duplicado sintético", category: "INSUMO", unit: "unidade", reorderPoint: 0 })
    });
    assert.equal(created.statusCode, 409, created.body);
    assert.equal((created.json() as { error: { code: string } }).error.code, "CONFLICT");
    const receipt = [...fake.durableReceipts.values()].find((candidate) => candidate.operation === "stock.write");
    assert.ok(receipt);
    assert.equal(receipt.status, "FAILED");
    assert.equal(receipt.failure_phase, "PRE_DISPATCH");
    assert.equal([...runtime.store.products.values()].some((product) => product.sku === "SKU-HTTP-PRODUCT-CONFLICT-001"), false);
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL diagnostic request creation commits one normalized row and replays without a second diagnostic DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "ana.vet@cvg.local", password: "veterinario-synthetic-0002" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    const patient = [...runtime.store.patients.values()].find((candidate) => candidate.unitId === unit?.id && candidate.workspaceId === workspace?.id);
    assert.ok(unit && workspace && patient);
    const headers = { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "idempotency-key": "diagnostic-http-source-001", "content-type": "application/json" };
    const encounterResponse = await runtime.app.inject({ method: "POST", url: "/api/v1/encounters", headers: { ...headers, "idempotency-key": "diagnostic-http-encounter-001" }, payload: JSON.stringify({ patientId: patient.id, appointmentId: null, chiefComplaint: "pedido de exame HTTP", urgency: "ROUTINE" }) });
    assert.equal(encounterResponse.statusCode, 201, encounterResponse.body);
    const encounterId = (encounterResponse.json() as { data: { encounter: { id: string } } }).data.encounter.id;
    const claimsBeforeDiagnostic = fake.statements.filter((statement) => statement.startsWith("insert into command_receipts") && statement.includes("on conflict (idempotency_lookup)")).length;
    const payload = JSON.stringify({ patientId: patient.id, encounterId, testName: "Perfil hematológico HTTP", priority: "ROUTINE" });
    const created = await runtime.app.inject({ method: "POST", url: "/api/v1/diagnostics/requests", headers, payload });
    assert.equal(created.statusCode, 201, created.body);
    const replay = await runtime.app.inject({ method: "POST", url: "/api/v1/diagnostics/requests", headers, payload });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_requests") && statement.includes("returning id::text")).length, 1);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into command_receipts") && statement.includes("on conflict (idempotency_lookup)")).length - claimsBeforeDiagnostic, 1);
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL diagnostic child creation commits authoritative specimen/result rows and replays without duplicate DML", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "ana.vet@cvg.local", password: "veterinario-synthetic-0002" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    const patient = [...runtime.store.patients.values()].find((candidate) => candidate.unitId === unit?.id && candidate.workspaceId === workspace?.id);
    assert.ok(unit && workspace && patient);
    const scopeHeaders = { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "content-type": "application/json" };
    const encounter = await runtime.app.inject({ method: "POST", url: "/api/v1/encounters", headers: { ...scopeHeaders, "idempotency-key": "diagnostic-child-http-encounter-001" }, payload: JSON.stringify({ patientId: patient.id, appointmentId: null, chiefComplaint: "coleta diagnóstica HTTP", urgency: "ROUTINE" }) });
    assert.equal(encounter.statusCode, 201, encounter.body);
    const encounterId = (encounter.json() as { data: { encounter: { id: string } } }).data.encounter.id;
    const requestHeaders = { ...scopeHeaders, "idempotency-key": "diagnostic-child-http-request-001" };
    const requestPayload = JSON.stringify({ patientId: patient.id, encounterId, testName: "Exame filho HTTP", priority: "ROUTINE" });
    const request = await runtime.app.inject({ method: "POST", url: "/api/v1/diagnostics/requests", headers: requestHeaders, payload: requestPayload });
    assert.equal(request.statusCode, 201, request.body);
    const requestId = (request.json() as { data: { request: { id: string } } }).data.request.id;
    const specimenHeaders = { ...scopeHeaders, "idempotency-key": "diagnostic-child-http-specimen-001" };
    const specimenPayload = JSON.stringify({ label: "Tubo HTTP" });
    const specimen = await runtime.app.inject({ method: "POST", url: `/api/v1/diagnostics/requests/${requestId}/specimens`, headers: specimenHeaders, payload: specimenPayload });
    assert.equal(specimen.statusCode, 201, specimen.body);
    const specimenId = (specimen.json() as { data: { specimen: { id: string } } }).data.specimen.id;
    const specimenReplay = await runtime.app.inject({ method: "POST", url: `/api/v1/diagnostics/requests/${requestId}/specimens`, headers: specimenHeaders, payload: specimenPayload });
    assert.equal(specimenReplay.statusCode, 201, specimenReplay.body);
    const resultHeaders = { ...scopeHeaders, "idempotency-key": "diagnostic-child-http-result-001" };
    const resultPayload = JSON.stringify({ requestId, specimenId, value: "resultado HTTP", source: "synthetic-lab", sourceVersion: "v1" });
    const result = await runtime.app.inject({ method: "POST", url: "/api/v1/diagnostics/results", headers: resultHeaders, payload: resultPayload });
    assert.equal(result.statusCode, 201, result.body);
    const resultId = (result.json() as { data: { result: { id: string } } }).data.result.id;
    const resultReplay = await runtime.app.inject({ method: "POST", url: "/api/v1/diagnostics/results", headers: resultHeaders, payload: resultPayload });
    assert.equal(resultReplay.statusCode, 201, resultReplay.body);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into specimens") && statement.includes("returning id::text")).length, 1);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into diagnostic_results") && statement.includes("returning id::text")).length, 1);
    assert.equal((specimenReplay.json() as { data: { specimen: { id: string } } }).data.specimen.id, specimenId);
    assert.equal((resultReplay.json() as { data: { result: { id: string } } }).data.result.id, resultId);
    const malformedKey = await runtime.app.inject({ method: "POST", url: `/api/v1/diagnostics/requests/${requestId}/specimens`, headers: { ...scopeHeaders, "idempotency-key": "invalid key with spaces" }, payload: specimenPayload });
    assert.equal(malformedKey.statusCode, 400, malformedKey.body);
    assert.equal((malformedKey.json() as { error: { code: string } }).error.code, "INVALID_INPUT");
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL appointment creation commits its normalized source row before the HTTP response", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    const patient = [...runtime.store.patients.values()].find((candidate) => candidate.unitId === unit?.id && candidate.workspaceId === workspace?.id);
    const provider = [...runtime.store.providers.values()].find((candidate) => candidate.unitId === unit?.id);
    const service = [...runtime.store.services.values()].find((candidate) => candidate.organizationId === runtime.store.bootstrapCredentials.organizationId);
    const resource = [...runtime.store.resources.values()].find((candidate) => candidate.unitId === unit?.id);
    assert.ok(unit && workspace && patient && provider && service && resource);
    const startsAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1_000).toISOString();
    const endsAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1_000 + 45 * 60 * 1_000).toISOString();
    const created = await runtime.app.inject({
      method: "POST",
      url: "/api/v1/appointments",
      headers: { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "idempotency-key": "appointment-http-source-001", "content-type": "application/json" },
      payload: JSON.stringify({ patientId: patient.id, providerId: provider.id, resourceId: resource.id, serviceId: service.id, startsAt, endsAt, purpose: "consulta de retorno" })
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.ok(fake.statements.some((statement) => statement.startsWith("insert into appointments") && statement.includes("returning id::text")));
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL encounter creation commits its normalized source row before the HTTP response", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    const patient = [...runtime.store.patients.values()].find((candidate) => candidate.unitId === unit?.id && candidate.workspaceId === workspace?.id);
    assert.ok(unit && workspace && patient);
    const headers = { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "idempotency-key": "encounter-http-source-001", "content-type": "application/json" };
    const payload = JSON.stringify({ patientId: patient.id, appointmentId: null, chiefComplaint: "avaliação de retorno", urgency: "ROUTINE" });
    const created = await runtime.app.inject({ method: "POST", url: "/api/v1/encounters", headers, payload });
    assert.equal(created.statusCode, 201, created.body);
    const replay = await runtime.app.inject({ method: "POST", url: "/api/v1/encounters", headers, payload });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into encounters") && statement.includes("returning id::text")).length, 1);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into command_receipts") && statement.includes("on conflict (idempotency_lookup)")).length, 1);
  } finally {
    await runtime.app.close();
  }
});

test("PostgreSQL clinical signing commits one authoritative update and replays idempotently", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "ana.vet@cvg.local", password: "veterinario-synthetic-0002" }) });
    assert.equal(login.statusCode, 200, login.body);
    const cookieValues = (Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"] : [login.headers["set-cookie"]]).filter((value): value is string => typeof value === "string");
    const cookiePairs = cookieValues.map((value) => value.split(";")[0]).filter((value): value is string => Boolean(value));
    const cookie = cookiePairs.join("; ");
    const csrfCookie = cookiePairs.find((pair) => pair.startsWith("cvg_csrf="));
    assert.ok(csrfCookie);
    const csrf = decodeURIComponent(csrfCookie.slice("cvg_csrf=".length));
    const unit = [...runtime.store.units.values()][0];
    const workspace = [...runtime.store.workspaces.values()][0];
    const patient = [...runtime.store.patients.values()].find((candidate) => candidate.unitId === unit?.id && candidate.workspaceId === workspace?.id);
    assert.ok(unit && workspace && patient);
    const scopeHeaders = { cookie, "x-csrf-token": csrf, "x-cvg-unit-id": unit.id, "x-cvg-workspace-id": workspace.id, "content-type": "application/json" };
    const encounter = await runtime.app.inject({ method: "POST", url: "/api/v1/encounters", headers: { ...scopeHeaders, "idempotency-key": "clinical-sign-encounter-001" }, payload: JSON.stringify({ patientId: patient.id, appointmentId: null, chiefComplaint: "assinatura clínica", urgency: "ROUTINE" }) });
    assert.equal(encounter.statusCode, 201, encounter.body);
    const encounterId = (encounter.json() as { data: { encounter: { id: string } } }).data.encounter.id;
    const document = await runtime.app.inject({ method: "POST", url: "/api/v1/clinical/documents", headers: { ...scopeHeaders, "idempotency-key": "clinical-sign-document-001" }, payload: JSON.stringify({ encounterId, documentType: "EVOLUTION", title: "Evolução assinável", content: "observação para assinatura", dataClass: "D3" }) });
    assert.equal(document.statusCode, 201, document.body);
    const documentId = (document.json() as { data: { document: { id: string } } }).data.document.id;
    const review = await runtime.app.inject({ method: "POST", url: `/api/v1/clinical/documents/${documentId}/review`, headers: { ...scopeHeaders, "idempotency-key": "clinical-review-001" }, payload: JSON.stringify({ expectedVersion: "1" }) });
    assert.equal(review.statusCode, 200, review.body);
    const signHeaders = { ...scopeHeaders, "idempotency-key": "clinical-sign-001" };
    const signPayload = JSON.stringify({ expectedVersion: "2" });
    const signed = await runtime.app.inject({ method: "POST", url: `/api/v1/clinical/documents/${documentId}/sign`, headers: signHeaders, payload: signPayload });
    assert.equal(signed.statusCode, 200, signed.body);
    assert.equal((signed.json() as { data: { document: { status: string; version: number } } }).data.document.status, "SIGNED");
    assert.equal((signed.json() as { data: { document: { status: string; version: number } } }).data.document.version, 3);
    const originalReceipt = [...runtime.store.commandReceipts.values()].find((receipt) => receipt.operation === "clinical.sign");
    assert.ok(originalReceipt?.auditRecordId);
    const originalAuditId = originalReceipt.auditRecordId;
    const signUpdatesBeforeReplay = fake.statements.filter((statement) => statement.startsWith("update clinical_documents") && statement.includes("returning id::text")).length;
    const documentInsertsBeforeReplay = fake.statements.filter((statement) => statement.startsWith("insert into clinical_documents")).length;
    const replay = await runtime.app.inject({ method: "POST", url: `/api/v1/clinical/documents/${documentId}/sign`, headers: signHeaders, payload: signPayload });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("update clinical_documents") && statement.includes("returning id::text")).length, signUpdatesBeforeReplay);
    assert.equal(fake.statements.filter((statement) => statement.startsWith("insert into clinical_documents")).length, documentInsertsBeforeReplay);
    assert.equal([...runtime.store.commandReceipts.values()].find((receipt) => receipt.operation === "clinical.sign")?.auditRecordId, originalAuditId);
    assert.equal([...runtime.store.auditRecords.values()].filter((record) => record.action === "clinical.sign").length, 2);
  } finally {
    await runtime.app.close();
  }
});

test("authoritative clinical signing fails closed when the CAS update affects no row", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const vetId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  const unit = [...store.units.values()][0];
  const workspace = [...store.workspaces.values()][0];
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === unit?.id && candidate.workspaceId === workspace?.id);
  assert.ok(vetId && unit && workspace && patient);
  const context = store.resolveContext(vetId, { unitId: unit.id, workspaceId: workspace.id }, "clinical.sign", "clinical-sign-cas-failure");
  const encounter = store.createEncounter(context, { patientId: patient.id, appointmentId: null, chiefComplaint: "CAS clínico", urgency: "ROUTINE" });
  const document = store.createClinicalDocument(context, { encounterId: encounter.id, documentType: "EVOLUTION", title: "CAS", content: "conteúdo", dataClass: "D3" });
  store.reviewClinicalDocument(context, document.id, "1");
  const signed = store.signClinicalDocument(context, document.id, "2");
  const fake = fakePool({ clinicalSignUpdateRows: false });
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  await assert.rejects(() => persistence.commit({ ...commitInput(store), normalizedClinicalSignWrite: signed }), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("clinical sign"));
  assert.equal(fake.statements.filter((statement) => statement.startsWith("update clinical_documents") && statement.includes("returning id::text")).length, 1);
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("PostgreSQL runtime routes audit reads through the normalized repository", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const runtime = await createRuntime({ store, persistence, config: { storageMode: "postgres", demoMode: true } });
  try {
    const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: "synthetic-password-123" }) });
    assert.equal(login.statusCode, 200);
    const loginBody = login.json<{ data: { contexts: Array<{ unit: { id: string }; workspace: { id: string } }> } }>();
    const context = loginBody.data.contexts[0];
    assert.ok(context);
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";")[0];
    assert.ok(cookie);
    const audit = await runtime.app.inject({ method: "GET", url: "/api/v1/audit", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(audit.statusCode, 200, audit.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from audit_records a")));
    const encounters = await runtime.app.inject({ method: "GET", url: "/api/v1/encounters", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(encounters.statusCode, 200, encounters.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from encounters e")));
    const clinical = await runtime.app.inject({ method: "GET", url: "/api/v1/clinical/documents", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(clinical.statusCode, 200, clinical.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from clinical_documents d")));
    const diagnosticRequests = await runtime.app.inject({ method: "GET", url: "/api/v1/diagnostics/requests", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(diagnosticRequests.statusCode, 200, diagnosticRequests.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from diagnostic_requests r")));
    const specimens = await runtime.app.inject({ method: "GET", url: "/api/v1/diagnostics/specimens", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(specimens.statusCode, 200, specimens.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from specimens s")));
    const diagnosticResults = await runtime.app.inject({ method: "GET", url: "/api/v1/diagnostics/results", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(diagnosticResults.statusCode, 200, diagnosticResults.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from diagnostic_results dr")));
    const beds = await runtime.app.inject({ method: "GET", url: "/api/v1/hospitalization/beds", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(beds.statusCode, 200, beds.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from beds b")));
    const episodes = await runtime.app.inject({ method: "GET", url: "/api/v1/hospitalization/episodes", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(episodes.statusCode, 200, episodes.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from hospital_episodes h")));
    const medicationOrders = await runtime.app.inject({ method: "GET", url: "/api/v1/medications/orders", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(medicationOrders.statusCode, 200, medicationOrders.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from medication_orders m")));
    const stock = await runtime.app.inject({ method: "GET", url: "/api/v1/stock", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(stock.statusCode, 200, stock.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from lots l")));
    const charges = await runtime.app.inject({ method: "GET", url: "/api/v1/finance/charges", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(charges.statusCode, 200, charges.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from charges c")));
    const payments = await runtime.app.inject({ method: "GET", url: "/api/v1/finance/payments", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(payments.statusCode, 200, payments.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from payments p")));
    const ledger = await runtime.app.inject({ method: "GET", url: "/api/v1/finance/ledger", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(ledger.statusCode, 200, ledger.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from ledger_entries l")));
    const communications = await runtime.app.inject({ method: "GET", url: "/api/v1/communications", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(communications.statusCode, 200, communications.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from communication_messages m")));
    const knowledge = await runtime.app.inject({ method: "GET", url: "/api/v1/knowledge", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(knowledge.statusCode, 200, knowledge.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from knowledge_documents d")));
    const queue = await runtime.app.inject({ method: "GET", url: "/api/v1/queue", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(queue.statusCode, 200, queue.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from queue_entries q")));
    const aiSessions = await runtime.app.inject({ method: "GET", url: "/api/v1/ai/sessions", headers: { cookie, "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } });
    assert.equal(aiSessions.statusCode, 200, aiSessions.body);
    assert.ok(fake.statements.some((statement) => statement.includes("from ai_sessions s")));
  } finally {
    await runtime.app.close();
  }
});

test("durable claim fence reconciles expired NOT_STARTED as safe failure and DISPATCHED as unknown", async () => {
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const organizationId = id(randomUUID());
  const actorId = id(randomUUID());
  const baseInput = { organizationId, actorId, sessionId: id(randomUUID()), operation: "test.claim", key: "fence-key", resourceId: null, unitId: null, workspaceId: null, body: { value: 1 } };
  const claim = await persistence.claimCommandReceipt(baseInput);
  assert.equal(claim.status, "CLAIMED");
  const secondProcess = await persistence.claimCommandReceipt({ ...baseInput, sessionId: id(randomUUID()) });
  assert.equal(secondProcess.status, "IN_FLIGHT");
  const stored = fake.durableReceipts.get(claim.receipt.idempotencyLookup);
  assert.ok(stored);
  stored.claim_expires_at = new Date(Date.now() - 1_000).toISOString();
  const reconciled = await persistence.reconcileCommandReceiptClaim(secondProcess.receipt);
  assert.equal(reconciled?.status, "FAILED");
  assert.equal(reconciled?.failurePhase, "PRE_DISPATCH");
  assert.equal(reconciled?.claimExpiresAt, null);
  const afterReconcile = await persistence.claimCommandReceipt(baseInput);
  assert.equal(afterReconcile.status, "FAILED");
  assert.equal(afterReconcile.receipt.failurePhase, "PRE_DISPATCH");

  const dispatchedInput = { ...baseInput, key: "fence-key-dispatched" };
  const dispatchedClaim = await persistence.claimCommandReceipt(dispatchedInput);
  assert.equal(dispatchedClaim.status, "CLAIMED");
  const fenced = await persistence.markCommandReceiptDispatched(organizationId, dispatchedClaim.receipt.id, dispatchedClaim.receipt.claimEpoch ?? 1, { unitId: dispatchedClaim.receipt.unitId, workspaceId: dispatchedClaim.receipt.workspaceId });
  assert.equal(fenced?.dispatchState, "DISPATCHED");
  const redispatched = await persistence.claimCommandReceipt(dispatchedInput);
  assert.equal(redispatched.status, "IN_FLIGHT");
  assert.equal(redispatched.receipt.dispatchState, "DISPATCHED");
  const dispatchedRow = fake.durableReceipts.get(dispatchedClaim.receipt.idempotencyLookup);
  assert.ok(dispatchedRow);
  dispatchedRow.claim_expires_at = new Date(Date.now() - 1_000).toISOString();
  const unknown = await persistence.reconcileCommandReceiptClaim(redispatched.receipt);
  assert.equal(unknown?.status, "OUTCOME_UNKNOWN");
  assert.equal(unknown?.failurePhase, "POST_DISPATCH");
  const afterUnknown = await persistence.claimCommandReceipt(dispatchedInput);
  assert.equal(afterUnknown.status, "OUTCOME_UNKNOWN");
});

test("a stale command commit cannot resurrect a receipt reconciled by another process", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const fake = fakePool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const input = { organizationId: store.bootstrapCredentials.organizationId, actorId: store.bootstrapCredentials.userId, sessionId: null, operation: "test.stale-commit", key: "stale-commit-key", resourceId: null, unitId: null, workspaceId: null, body: { value: 1 } };
  const claim = await persistence.claimCommandReceipt(input);
  const durable = fake.durableReceipts.get(claim.receipt.idempotencyLookup);
  assert.ok(durable);
  durable.claim_expires_at = new Date(Date.now() - 1_000).toISOString();
  const reconciled = await persistence.reconcileCommandReceiptClaim(claim.receipt);
  assert.equal(reconciled?.status, "FAILED");

  store.setCommandReceipt({ ...claim.receipt, status: "SUCCEEDED", result: { late: true }, completedAt: new Date().toISOString() });
  const staleSnapshot = store.snapshot();
  await assert.rejects(
    () => persistence.commit({ ...commitInput(store), snapshot: staleSnapshot, commandReceipts: staleSnapshot.commandReceipts, eventType: "HTTP_REQUEST", operation: input.operation }),
    (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("command receipt")
  );
  assert.equal(durable.status, "FAILED");
});
