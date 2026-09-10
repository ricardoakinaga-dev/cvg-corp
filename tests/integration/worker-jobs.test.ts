import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { id } from "@cvg/contracts";
import { CvgStore, digest, serializeSnapshot } from "@cvg/domain";
import { createRecoveryBundleManifest, decryptRecoveryBundle, encryptRecoveryBundle, OutboxLeaseLostError, PersistenceCorruptionError, PersistenceStateError, PostgresPersistence, type DurableRecoveryBundle, type DurableWorkerJobRecord } from "@cvg/persistence";

const organizationId = id("00000000-0000-4000-8000-000000000010");
const jobId = id("00000000-0000-4000-8000-000000000901");
const secondJobId = id("00000000-0000-4000-8000-000000000902");

type QueryResult = { rows: Array<Record<string, unknown>> };
type JobState = {
  id: string;
  organization_id: string;
  lane: string;
  job_type: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  available_at: string;
  claimed_by: string | null;
  lease_until: string | null;
  fence_token: bigint;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
  record_digest: string;
};

type HeartbeatState = {
  organization_id: string;
  worker_id: string;
  status: string;
  lane: string | null;
  cycle_id: string | null;
  started_at: string;
  last_seen_at: string;
  expires_at: string;
  detail: string | null;
  updated_at: string;
};

function jobRow(row: JobState): Record<string, unknown> {
  return { ...row, id: row.id, organization_id: row.organization_id, fence_token: row.fence_token.toString() };
}

function heartbeatRow(row: HeartbeatState): Record<string, unknown> {
  return { ...row, organization_id: row.organization_id, cycle_id: row.cycle_id };
}

function workerPool(initial: JobState[] = []): { pool: Pool; jobs: JobState[]; heartbeats: HeartbeatState[]; statements: string[] } {
  const jobs = [...initial];
  const heartbeats: HeartbeatState[] = [];
  const statements: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
      const normalized = sql.trim().replace(/\s+/g, " ");
      statements.push(normalized);
      if (normalized === "BEGIN" || normalized === "BEGIN READ ONLY" || normalized === "COMMIT" || normalized === "ROLLBACK" || normalized.startsWith("select set_config")) return { rows: [] };
      if (normalized.startsWith("insert into cvg_worker_jobs")) {
        const organization = String(params[1]);
        const lane = String(params[2]);
        const key = String(params[4]);
        if (jobs.some((row) => row.organization_id === organization && row.lane === lane && row.idempotency_key === key)) return { rows: [] };
        const created = "2026-09-10T00:00:00.000Z";
        const available = params[7] === null ? created : String(params[7]);
        const row: JobState = { id: String(params[0]), organization_id: organization, lane, job_type: String(params[3]), idempotency_key: key, payload: JSON.parse(String(params[5])) as Record<string, unknown>, status: "PENDING", attempts: 0, max_attempts: Number(params[6]), available_at: available, claimed_by: null, lease_until: null, fence_token: 0n, last_error: null, created_at: created, processed_at: null, record_digest: String(params[8]) };
        jobs.push(row);
        return { rows: [jobRow(row)] };
      }
      if (normalized.startsWith("select id::text as id") && normalized.includes("from cvg_worker_jobs")) {
        const row = jobs.find((candidate) => candidate.lane === String(params[0]) && candidate.idempotency_key === String(params[1]));
        return { rows: row ? [jobRow(row)] : [] };
      }
      if (normalized.startsWith("with expired_poison as")) {
        const worker = String(params[0]);
        const lane = String(params[1]);
        const selected = jobs.filter((row) => row.organization_id === organizationId && (row.lane === lane || row.lane === "BROKEN") && row.attempts < row.max_attempts && (row.status === "PENDING" || row.status === "CLAIMED")).slice(0, Number(params[2]));
        for (const row of selected) {
          row.status = "CLAIMED";
          row.claimed_by = worker;
          row.lease_until = "2099-01-01T00:00:00.000Z";
          row.fence_token += 1n;
          row.attempts += 1;
        }
        return { rows: selected.map(jobRow) };
      }
      if (normalized.startsWith("update cvg_worker_jobs set status = 'COMPLETED'")) {
        const row = jobs.find((candidate) => candidate.id === String(params[0]) && candidate.organization_id === organizationId && candidate.status === "CLAIMED" && candidate.claimed_by === String(params[1]) && candidate.fence_token === BigInt(String(params[2])));
        if (!row) return { rows: [] };
        row.status = "COMPLETED";
        row.claimed_by = null;
        row.lease_until = null;
        row.processed_at = "2026-09-10T00:01:00.000Z";
        return { rows: [{ id: row.id }] };
      }
      if (normalized.startsWith("update cvg_worker_jobs set status = case")) {
        const row = jobs.find((candidate) => candidate.id === String(params[0]) && candidate.organization_id === organizationId && candidate.status === "CLAIMED" && candidate.claimed_by === String(params[1]) && candidate.fence_token === BigInt(String(params[2])));
        if (!row) return { rows: [] };
        const quarantine = String(params[3]) === "QUARANTINED" || row.attempts >= row.max_attempts;
        row.status = quarantine ? "QUARANTINED" : "PENDING";
        row.claimed_by = null;
        row.lease_until = null;
        row.last_error = String(params[5]);
        row.processed_at = quarantine ? "2026-09-10T00:02:00.000Z" : null;
        return { rows: [{ status: row.status }] };
      }
      if (normalized.startsWith("select count(*) filter") && normalized.includes("from cvg_worker_jobs")) {
        const lane = params[0] === null ? null : String(params[0]);
        const scoped = jobs.filter((row) => lane === null || row.lane === lane);
        return { rows: [{ depth: scoped.filter((row) => row.status === "PENDING" || row.status === "CLAIMED").length, oldest_age_ms: "10", poison_messages: scoped.filter((row) => row.status === "QUARANTINED").length }] };
      }
      if (normalized.startsWith("insert into cvg_worker_heartbeats")) {
        const organization = String(params[0]);
        const worker = String(params[1]);
        const existing = heartbeats.find((row) => row.organization_id === organization && row.worker_id === worker);
        const lastSeen = String(params[6]);
        if (existing && existing.last_seen_at > lastSeen) return { rows: [] };
        const row: HeartbeatState = { organization_id: organization, worker_id: worker, status: String(params[2]), lane: params[3] === null ? null : String(params[3]), cycle_id: params[4] === null ? null : String(params[4]), started_at: String(params[5]), last_seen_at: lastSeen, expires_at: String(params[7]), detail: params[8] === null ? null : String(params[8]), updated_at: "2026-09-10T00:03:00.000Z" };
        if (existing) Object.assign(existing, row);
        else heartbeats.push(row);
        return { rows: [heartbeatRow(row)] };
      }
      if (normalized.startsWith("select organization_id::text as organization_id") && normalized.includes("from cvg_worker_heartbeats")) {
        const worker = params.length ? String(params[0]) : null;
        return { rows: heartbeats.filter((row) => worker === null || row.worker_id === worker).map(heartbeatRow) };
      }
      return { rows: [] };
    },
    release(): void { /* no-op fake */ }
  } as unknown as PoolClient;
  return { pool: { connect: async (): Promise<PoolClient> => client } as unknown as Pool, jobs, heartbeats, statements };
}

function input(overrides: Partial<{ id: typeof jobId; payload: Record<string, unknown>; maxAttempts: number; availableAt: string }> = {}) {
  return { id: overrides.id ?? jobId, organizationId, lane: "jobs" as const, jobType: "synthetic.rebuild", idempotencyKey: "worker-job-1", payload: overrides.payload ?? { patientId: "synthetic" }, maxAttempts: overrides.maxAttempts ?? 2, ...(overrides.availableAt ? { availableAt: overrides.availableAt } : {}) };
}

test("durable worker admission is tenant-scoped and idempotent by immutable digest", async () => {
  const fake = workerPool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const first = await persistence.enqueueWorkerJob(input());
  const replay = await persistence.enqueueWorkerJob(input({ id: secondJobId }));
  assert.equal(first.id, jobId);
  assert.equal(replay.id, jobId);
  assert.equal(fake.jobs.length, 1);
  await assert.rejects(() => persistence.enqueueWorkerJob(input({ payload: { patientId: "different" } })), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("immutable admission"));
  assert.ok(fake.statements.includes("BEGIN"));
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("durable worker claim fences stale completion and quarantines poison attempts", async () => {
  const fake = workerPool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const admitted = await persistence.enqueueWorkerJob(input());
  const claimed = await persistence.claimWorkerJobs(organizationId, "jobs", "worker-a", 10, 30);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.fenceToken, 1n);
  await assert.rejects(() => persistence.completeWorkerJob(organizationId, admitted.id, "worker-a", 0n), (error: unknown) => error instanceof OutboxLeaseLostError);
  await persistence.failWorkerJob(organizationId, admitted.id, "worker-a", claimed[0]!.fenceToken, "synthetic poison", true);
  assert.equal(fake.jobs[0]?.status, "QUARANTINED");
  const stats = await persistence.workerJobStats(organizationId, "jobs");
  assert.deepEqual(stats, { depth: 0, oldestAgeMs: 10, poisonMessages: 1 });
});

test("worker heartbeat upsert rejects stale liveness and preserves tenant scope", async () => {
  const fake = workerPool();
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  const current = await persistence.recordWorkerHeartbeat({ organizationId, workerId: "worker-a", status: "RUNNING", lane: null, cycleId: id("00000000-0000-4000-8000-000000000903"), startedAt: "2026-09-10T00:00:00.000Z", lastSeenAt: "2026-09-10T00:03:00.000Z", expiresAt: "2026-09-10T00:04:00.000Z", detail: "synthetic" });
  assert.equal(current.status, "RUNNING");
  const updated = await persistence.recordWorkerHeartbeat({ organizationId, workerId: "worker-a", status: "DEGRADED", lane: "jobs", cycleId: current.cycleId, startedAt: current.startedAt, lastSeenAt: "2026-09-10T00:03:30.000Z", expiresAt: "2026-09-10T00:04:30.000Z", detail: "lane blocked" });
  assert.equal(updated.status, "DEGRADED");
  await assert.rejects(() => persistence.recordWorkerHeartbeat({ organizationId, workerId: "worker-a", status: "RUNNING", lane: null, cycleId: current.cycleId, startedAt: current.startedAt, lastSeenAt: "2026-09-10T00:02:00.000Z", expiresAt: "2026-09-10T00:04:00.000Z", detail: null }), (error: unknown) => error instanceof PersistenceStateError && error.message.includes("stale"));
  const listed = await persistence.listWorkerHeartbeats(organizationId);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.workerId, "worker-a");
  assert.ok(fake.statements.includes("BEGIN READ ONLY"));
});

test("malformed durable worker rows fail closed before application code can consume them", async () => {
  const fake = workerPool([{ id: jobId, organization_id: organizationId, lane: "BROKEN", job_type: "synthetic.rebuild", idempotency_key: "bad", payload: {}, status: "PENDING", attempts: 0, max_attempts: 2, available_at: "2026-09-10T00:00:00.000Z", claimed_by: null, lease_until: null, fence_token: 0n, last_error: null, created_at: "2026-09-10T00:00:00.000Z", processed_at: null, record_digest: digest("valid") }]);
  const persistence = new PostgresPersistence({ connectionString: "postgres://synthetic.invalid", pool: fake.pool });
  await assert.rejects(() => persistence.claimWorkerJobs(organizationId, "jobs", "worker-a"), (error: unknown) => error instanceof PersistenceCorruptionError && error.message.includes("worker job.lane"));
  assert.ok(fake.statements.includes("ROLLBACK"));
});

test("recovery encryption carries durable worker jobs and their fence token", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const snapshot = store.snapshot();
  const workerJob: DurableWorkerJobRecord = { id: jobId, organizationId, lane: "jobs", jobType: "synthetic.rebuild", idempotencyKey: "recovery-worker-job-1", payload: { synthetic: true }, maxAttempts: 2, status: "CLAIMED", attempts: 1, availableAt: "2026-09-10T00:00:00.000Z", claimedBy: "worker-a", leaseUntil: "2026-09-10T00:05:00.000Z", fenceToken: 3n, lastError: null, createdAt: "2026-09-10T00:00:00.000Z", processedAt: null, recordDigest: digest("worker-job-admission") };
  const recoveryData = { revision: 1n, snapshot, snapshotDigest: digest(JSON.parse(serializeSnapshot(snapshot))), eventId: randomUUID(), outboxRecords: [], usageRecords: [], inboxRecords: [], externalEffects: [], workerJobs: [workerJob] };
  const bundle: DurableRecoveryBundle = { ...recoveryData, manifest: createRecoveryBundleManifest({ organizationId, ...recoveryData, migrationFingerprint: digest([{ version: "031_worker_jobs_and_heartbeats", checksum: "synthetic-checksum" }]) }) };
  const encrypted = encryptRecoveryBundle(bundle, new Uint8Array(32), "synthetic-worker-recovery-key");
  const recovered = decryptRecoveryBundle(encrypted, new Uint8Array(32));
  assert.equal(recovered.workerJobs?.[0]?.fenceToken, 3n);
  assert.equal(recovered.manifest.ledgerDigests.workerJobs, digest([{ ...workerJob, fenceToken: "3" }]));
});
