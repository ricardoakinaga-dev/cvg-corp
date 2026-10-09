import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { CvgStore } from "@cvg/domain";
import { id as opaqueId } from "@cvg/contracts";
import { OutboxWorker, type ExternalEffectLedger, type OutboxSink } from "@cvg/integrations";
import { PostgresPersistence } from "@cvg/persistence";

/**
 * CVG-AUD19-017: adversarial worker/effect matrix against real PostgreSQL in a
 * disposable database with two independent worker instances.  Covers lease
 * loss with a late acknowledgement, duplicate delivery, poison exhaustion,
 * acknowledgement failure and OUTCOME_UNKNOWN without blind retry.
 *
 * Requires DATABASE_URL (runtime role), MIGRATION_DATABASE_URL (schema owner)
 * and ADMIN_DATABASE_URL (maintenance connection).
 */

const runtimeUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const adminUrl = process.env.ADMIN_DATABASE_URL ?? migrationUrl;
if (!runtimeUrl || !migrationUrl || !adminUrl) {
  process.stderr.write("POSTGRES_WORKER_EFFECTS_BLOCKED_EXTERNAL DATABASE_URL, MIGRATION_DATABASE_URL and ADMIN_DATABASE_URL are required\n");
  process.exit(2);
}
const bootstrapPassword = process.env.CVG_BOOTSTRAP_PASSWORD ?? "synthetic-password-123";
const runtimeUser = new URL(runtimeUrl).username;
const databaseName = `cvg_worker_effects_${randomUUID().replaceAll("-", "")}`;
const quoteIdentifier = (value: string): string => `"${value.replaceAll("\"", "\"\"")}"`;

function withDatabase(connectionString: string, name: string): string {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const files = (await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).sort();
const admin = new pg.Client({ connectionString: adminUrl });
const scenarioResults: Record<string, unknown> = {};
let created = false;

async function applyMigrations(client: pg.Client): Promise<void> {
  await client.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now(), checksum text not null)");
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const sql = await readFile(join("db/migrations", file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations(version, checksum) values ($1, $2)", [version, checksum]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

let persistence: PostgresPersistence | null = null;
const reader = { pool: null as pg.Pool | null };
try {
  await admin.connect();
  await admin.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`);
  await admin.query(`create database ${quoteIdentifier(databaseName)}`);
  created = true;
  const owner = new pg.Client({ connectionString: withDatabase(migrationUrl, databaseName) });
  await owner.connect();
  try {
    await applyMigrations(owner);
    await owner.query(`grant connect on database ${quoteIdentifier(databaseName)} to ${quoteIdentifier(runtimeUser)}`);
    await owner.query(`grant usage on schema public to ${quoteIdentifier(runtimeUser)}`);
    await owner.query(`revoke insert, update, delete on table public.schema_migrations from ${quoteIdentifier(runtimeUser)}`);
    await owner.query(`grant select on table public.schema_migrations to ${quoteIdentifier(runtimeUser)}`);
    await owner.query(`grant usage, select on all sequences in schema public to ${quoteIdentifier(runtimeUser)}`);
    await owner.query(`revoke create on schema public from ${quoteIdentifier(runtimeUser)}`);
  } finally {
    await owner.end();
  }

  const targetUrl = withDatabase(runtimeUrl, databaseName);
  persistence = new PostgresPersistence({ connectionString: targetUrl });
  const store = new CvgStore({ bootstrapPassword });
  const organizationId = store.bootstrapCredentials.organizationId;
  const bootstrapSnapshot = store.snapshot();
  await persistence.commit({ expectedRevision: null, snapshot: bootstrapSnapshot, eventType: "BOOTSTRAP", operation: "system.bootstrap", organizationId, actorId: null, correlationId: randomUUID(), aggregateType: "Organization", aggregateId: organizationId, payload: { synthetic: true }, auditRecords: bootstrapSnapshot.auditRecords, commandReceipts: bootstrapSnapshot.commandReceipts });

  reader.pool = new pg.Pool({ connectionString: targetUrl, max: 1, application_name: "cvg-worker-effects-reader" });
  const outboxStatus = async (id: string): Promise<string | null> => {
    const client = await reader.pool!.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
      const result = await client.query<{ status: string }>("select status from outbox_records where id = $1", [id]);
      await client.query("rollback");
      return result.rows[0]?.status ?? null;
    } finally {
      client.release();
    }
  };
  const seedOutbox = async (eventType: string): Promise<string> => {
    const id = randomUUID();
    const latest = await persistence!.loadLatest(organizationId);
    if (!latest) throw new Error("worker-effects drill has no durable snapshot");
    await persistence!.commit({ expectedRevision: latest.revision, snapshot: latest.snapshot, eventType: "SYSTEM", operation: "verify.postgres.worker-effects.seed", organizationId, actorId: null, correlationId: `seed-${id}`, aggregateType: "Outbox", aggregateId: opaqueId(id), payload: { synthetic: true, outboxId: id }, outboxRecords: [{ id: opaqueId(id), organizationId, eventType, aggregateId: organizationId, payload: { synthetic: true, id } }] });
    return id;
  };

  // 1. Lease loss: A claims with a short lease, B takes over with a higher
  //    fence, and A's late acknowledgement is rejected.
  {
    const id = await seedOutbox("verify.lease-loss");
    const claimedA = await persistence.claimOutbox(organizationId, "worker-a", 1, 1);
    const recordA = claimedA.find((candidate) => candidate.id === id);
    if (!recordA) throw new Error(`lease-loss: worker A did not claim the record (${claimedA.length})`);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const workerB = new OutboxWorker(persistence, null);
    let bDeliveries = 0;
    const claimedB = await workerB.runOnce(organizationId, "worker-b", { deliver: async () => { bDeliveries += 1; return "DELIVERED"; } } as OutboxSink, { limit: 1, leaseSeconds: 30 });
    if (claimedB.delivered !== 1 || bDeliveries !== 1) throw new Error(`lease-loss: worker B did not complete exactly one delivery (${JSON.stringify(claimedB)})`);
    let lateAckRejected = false;
    try {
      await persistence.completeOutbox(organizationId, opaqueId(id), "worker-a", recordA.fenceToken);
    } catch {
      lateAckRejected = true;
    }
    if (!lateAckRejected) throw new Error("lease-loss: the stale worker acknowledged a record it no longer owns");
    const after = await outboxStatus(id);
    if (after !== "DELIVERED") throw new Error(`lease-loss: record status is ${after}`);
    scenarioResults["leaseLoss"] = { workerAFence: recordA.fenceToken.toString(), workerBDelivered: claimedB.delivered, deliveries: bDeliveries, lateAckRejected, status: after };
  }

  // 2. Duplicate delivery: an already delivered record is not claimed again.
  {
    const id = await seedOutbox("verify.duplicate");
    const worker = new OutboxWorker(persistence, null);
    let deliveries = 0;
    const sink: OutboxSink = { deliver: async () => { deliveries += 1; return "DELIVERED"; } };
    await worker.runOnce(organizationId, "worker-dup-1", sink, { limit: 1, leaseSeconds: 30 });
    const second = await worker.runOnce(organizationId, "worker-dup-2", sink, { limit: 10, leaseSeconds: 30 });
    if (deliveries !== 1 || second.claimed !== 0) throw new Error(`duplicate: deliveries=${deliveries} secondClaim=${second.claimed}`);
    const after = await outboxStatus(id);
    scenarioResults["duplicate"] = { deliveries, secondClaim: second.claimed, status: after };
  }

  // 3. Poison exhaustion: repeated failures quarantine and stop redelivery.
  {
    const id = await seedOutbox("verify.poison");
    const worker = new OutboxWorker(persistence, null);
    const failing: OutboxSink = { deliver: async () => { throw new Error("synthetic provider failure"); } };
    let attempts = 0;
    for (let attempt = 0; attempt < 4 && (await outboxStatus(id)) !== "QUARANTINED"; attempt += 1) {
      await worker.runOnce(organizationId, `worker-poison-${attempt}`, failing, { limit: 1, leaseSeconds: 30, maxAttempts: 2 });
      attempts += 1;
    }
    const after = await outboxStatus(id);
    if (after !== "QUARANTINED") throw new Error(`poison: record status is ${after} after exhaustion`);
    scenarioResults["poison"] = { attempts, status: after };
  }

  // 4. Ack failure: a completed delivery whose acknowledgement fails is not
  //    reported as SUCCEEDED and remains durable for a later cycle.
  {
    const id = await seedOutbox("verify.ack-failure");
    const audits: string[] = [];
    const realComplete = persistence.completeOutbox.bind(persistence);
    (persistence as unknown as { completeOutbox: typeof persistence.completeOutbox }).completeOutbox = async () => { throw new Error("synthetic acknowledgement failure"); };
    try {
      const worker = new OutboxWorker(persistence, null);
      let rejected = false;
      let delivered = -1;
      try {
        const result = await worker.runOnce(organizationId, "worker-ack", { deliver: async () => "DELIVERED" } as OutboxSink, { limit: 1, leaseSeconds: 30, hooks: { cycleId: opaqueId("ack"), audit: async (event) => { audits.push(event.outcome); }, metrics: () => undefined } });
        delivered = result.delivered;
      } catch {
        rejected = true;
      }
      if (audits.includes("SUCCEEDED")) throw new Error("ack failure: SUCCEEDED was audited before the durable acknowledgement");
      if (!rejected || delivered > 0) throw new Error(`ack failure: rejected=${rejected} delivered=${delivered}`);
      scenarioResults["ackFailure"] = { audits, rejected, delivered, status: await outboxStatus(id) };
    } finally {
      (persistence as unknown as { completeOutbox: typeof persistence.completeOutbox }).completeOutbox = realComplete;
    }
  }

  // 5. OUTCOME_UNKNOWN: a dispatched effect with no durable outcome is never
  //    retried blindly; the record is quarantined for explicit reconciliation.
  {
    const id = await seedOutbox("verify.outcome-unknown");
    let providerDeliveries = 0;
    const effects = persistence as unknown as ExternalEffectLedger;
    const worker = new OutboxWorker(persistence, effects);
    const result = await worker.runOnce(organizationId, "worker-unknown", {
      requiresDurableEffectLedger: true,
      deliver: async () => { providerDeliveries += 1; return { status: "OUTCOME_UNKNOWN", providerRequestId: "provider-unknown-1", evidence: { accepted: true }, reason: "synthetic ambiguous provider outcome" }; }
    } as OutboxSink, { limit: 1, leaseSeconds: 30 });
    if (result.outcomeUnknown !== 1 || providerDeliveries !== 1) throw new Error(`outcome-unknown: result=${JSON.stringify(result)} deliveries=${providerDeliveries}`);
    const second = await worker.runOnce(organizationId, "worker-unknown-retry", {
      requiresDurableEffectLedger: true,
      deliver: async () => { providerDeliveries += 1; return "DELIVERED"; }
    } as OutboxSink, { limit: 1, leaseSeconds: 30 });
    if (providerDeliveries !== 1 || second.claimed !== 0) throw new Error(`outcome-unknown: blind retry happened (deliveries=${providerDeliveries}, second=${JSON.stringify(second)})`);
    const effectStatus = await outboxStatus(id);
    if (effectStatus !== "QUARANTINED") throw new Error(`outcome-unknown: record status is ${effectStatus}`);
    scenarioResults["outcomeUnknown"] = { deliveries: providerDeliveries, secondClaim: second.claimed, status: effectStatus };
  }

  console.log(`POSTGRES_WORKER_EFFECTS_VERIFIED ${JSON.stringify(scenarioResults)}`);
} catch (error) {
  process.stderr.write(`POSTGRES_WORKER_EFFECTS_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await reader.pool?.end().catch(() => undefined);
  await persistence?.close().catch(() => undefined);
  if (created) await admin.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`).catch(() => undefined);
  await admin.end().catch(() => undefined);
}
