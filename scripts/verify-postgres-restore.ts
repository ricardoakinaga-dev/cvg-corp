import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { CvgStore } from "@cvg/domain";
import { createRuntime } from "@cvg/api";
import { decryptRecoveryBundle, encryptRecoveryBundle, PersistenceCorruptionError, PostgresPersistence } from "@cvg/persistence";

const { Client } = pg;
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required; use an explicitly identified synthetic source database");

const bootstrapPassword = process.env.CVG_BOOTSTRAP_PASSWORD ?? "synthetic-password-123";
const restoreDatabase = `cvg_restore_${randomUUID().replaceAll("-", "")}`;
const quoteIdentifier = (value: string): string => `"${value.replaceAll("\"", "\"\"")}"`;

function withDatabase(connectionString: string, database: string): string {
  const queryIndex = connectionString.indexOf("?");
  const main = queryIndex >= 0 ? connectionString.slice(0, queryIndex) : connectionString;
  const query = queryIndex >= 0 ? connectionString.slice(queryIndex) : "";
  const separator = main.lastIndexOf("/");
  if (separator < main.indexOf("://") + 3) throw new Error("DATABASE_URL must use a URL form with an explicit database name");
  return `${main.slice(0, separator + 1)}${database}${query}`;
}

function maintenanceUrl(connectionString: string): string {
  return withDatabase(connectionString, "postgres");
}

async function migrate(connectionString: string): Promise<void> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2_500 });
  await client.connect();
  try {
    await client.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now(), checksum text not null)");
    const files = (await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const sql = await readFile(join("db/migrations", file), "utf8");
      const checksum = (await import("node:crypto")).createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>("select checksum from schema_migrations where version = $1", [version]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`restore migration checksum changed: ${file}`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(version, checksum) values ($1, $2)", [version, checksum]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

const sourcePersistence = new PostgresPersistence({ connectionString: sourceUrl });
const sourceOrganizationId = new CvgStore({ bootstrapPassword }).bootstrapCredentials.organizationId;
const admin = new Client({ connectionString: maintenanceUrl(sourceUrl), connectionTimeoutMillis: 2_500 });
let targetPersistence: PostgresPersistence | null = null;
let runtime: Awaited<ReturnType<typeof createRuntime>> | null = null;
let created = false;
let adminConnected = false;

try {
  const sourceCandidate = await sourcePersistence.loadLatest(sourceOrganizationId);
  if (!sourceCandidate) throw new Error("source database has no durable snapshot to restore");
  if (!sourceCandidate.snapshot.organizations.some((organization) => organization.id === sourceOrganizationId)) throw new Error(`source database snapshot has no expected organization ${sourceOrganizationId}`);
  const sourceBefore = await sourcePersistence.exportRecoveryBundle(sourceOrganizationId);
  if (!sourceBefore) throw new Error("source database has no recovery bundle to restore");
  if (sourceBefore.revision !== sourceCandidate.revision || sourceBefore.eventId !== sourceCandidate.eventId) throw new Error("source recovery bundle changed while it was being exported");
  const backupKey = randomBytes(32);
  const encryptedBackup = encryptRecoveryBundle(sourceBefore, backupKey, "synthetic-kms-key");
  const restoredBundle = decryptRecoveryBundle(encryptedBackup, backupKey);
  if (restoredBundle.revision !== sourceBefore.revision || restoredBundle.eventId !== sourceBefore.eventId || restoredBundle.snapshotDigest !== sourceBefore.snapshotDigest || restoredBundle.outboxRecords.length !== sourceBefore.outboxRecords.length || restoredBundle.usageRecords.length !== sourceBefore.usageRecords.length || restoredBundle.inboxRecords.length !== sourceBefore.inboxRecords.length || restoredBundle.externalEffects.length !== sourceBefore.externalEffects.length) throw new Error("encrypted recovery bundle round-trip changed durable recovery state");
  const tamperedCiphertext = Buffer.from(encryptedBackup.ciphertext, "base64");
  tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1;
  let tamperRejected = false;
  try {
    decryptRecoveryBundle({ ...encryptedBackup, ciphertext: tamperedCiphertext.toString("base64") }, backupKey);
  } catch (error) {
    tamperRejected = error instanceof PersistenceCorruptionError;
  }
  if (!tamperRejected) throw new Error("encrypted recovery bundle accepted tampered ciphertext");
  await admin.connect();
  adminConnected = true;
  await admin.query(`create database ${quoteIdentifier(restoreDatabase)}`);
  created = true;

  const targetUrl = withDatabase(sourceUrl, restoreDatabase);
  await migrate(targetUrl);

  const restoredStore = new CvgStore({ bootstrapPassword });
  restoredStore.restore(restoredBundle.snapshot);
  const restoredSnapshot = restoredStore.snapshot();
  if (restoredSnapshot.healthStatus !== "QUARANTINED") throw new Error("restore fixture did not enter quarantine");
  if ([...restoredSnapshot.sessions].some((session) => session.revokedAt === null)) throw new Error("restore fixture retained an active session");

  targetPersistence = new PostgresPersistence({ connectionString: targetUrl });
  const targetCommit = await targetPersistence.commit({
    expectedRevision: null,
    snapshot: restoredSnapshot,
    eventType: "RESTORE_QUARANTINED",
    operation: "verify.postgres.restore",
    organizationId: restoredSnapshot.organizations[0]?.id ?? null,
    actorId: null,
    correlationId: "verify-postgres-restore",
    aggregateType: "Restore",
    aggregateId: null,
    payload: { synthetic: true, sourceRevision: restoredBundle.revision.toString(), sourceEventId: restoredBundle.eventId, quarantine: true, recoveredOutbox: restoredBundle.outboxRecords.length, recoveredUsage: restoredBundle.usageRecords.length, recoveredInbox: restoredBundle.inboxRecords.length, recoveredExternalEffects: restoredBundle.externalEffects.length },
    recoveredOutboxRecords: restoredBundle.outboxRecords,
    recoveredUsageRecords: restoredBundle.usageRecords,
    recoveredInboxRecords: restoredBundle.inboxRecords,
    recoveredExternalEffects: restoredBundle.externalEffects
  });
  if (targetCommit.revision !== 1n) throw new Error(`restore target revision is ${targetCommit.revision}, expected 1`);

  const targetLatest = await targetPersistence.loadLatest(sourceOrganizationId);
  if (!targetLatest || targetLatest.snapshot.healthStatus !== "QUARANTINED") throw new Error("quarantined restore was not durable");
  const targetBundle = await targetPersistence.exportRecoveryBundle(sourceOrganizationId);
  if (!targetBundle) throw new Error("quarantined restore has no recovery bundle");
  const sortedDigests = (values: Array<{ recordDigest: string }>): string[] => values.map((value) => value.recordDigest).sort();
  if (JSON.stringify(sortedDigests(targetBundle.outboxRecords)) !== JSON.stringify(sortedDigests(sourceBefore.outboxRecords))) throw new Error("restore did not preserve the outbox recovery ledger");
  if (JSON.stringify(sortedDigests(targetBundle.usageRecords)) !== JSON.stringify(sortedDigests(sourceBefore.usageRecords))) throw new Error("restore did not preserve the usage recovery ledger");
  if (JSON.stringify(targetBundle.inboxRecords.map((record) => record.recordDigest).sort()) !== JSON.stringify(sourceBefore.inboxRecords.map((record) => record.recordDigest).sort())) throw new Error("restore did not preserve the inbox recovery ledger");
  if (JSON.stringify(targetBundle.externalEffects.map((record) => record.requestDigest).sort()) !== JSON.stringify(sourceBefore.externalEffects.map((record) => record.requestDigest).sort())) throw new Error("restore did not preserve the external effect recovery ledger");

  runtime = await createRuntime({ config: { storageMode: "postgres", demoMode: true, databaseUrl: targetUrl, bootstrapPassword }, persistence: targetPersistence });
  const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: bootstrapPassword }) });
  if (login.statusCode !== 401) throw new Error(`quarantined restore accepted login with status ${login.statusCode}`);
  const ready = await runtime.app.inject({ method: "GET", url: "/api/v1/ready" });
  if (ready.statusCode !== 503) throw new Error(`quarantined restore reported ready with status ${ready.statusCode}`);

  const sourceAfter = await sourcePersistence.exportRecoveryBundle(sourceOrganizationId);
  if (!sourceAfter || sourceAfter.revision !== sourceBefore.revision || sourceAfter.eventId !== sourceBefore.eventId) throw new Error("restore drill changed the source database");
  if (JSON.stringify(sortedDigests(sourceAfter.outboxRecords)) !== JSON.stringify(sortedDigests(sourceBefore.outboxRecords)) || JSON.stringify(sortedDigests(sourceAfter.usageRecords)) !== JSON.stringify(sortedDigests(sourceBefore.usageRecords)) || JSON.stringify(sourceAfter.inboxRecords.map((record) => record.recordDigest).sort()) !== JSON.stringify(sourceBefore.inboxRecords.map((record) => record.recordDigest).sort()) || JSON.stringify(sourceAfter.externalEffects.map((record) => record.requestDigest).sort()) !== JSON.stringify(sourceBefore.externalEffects.map((record) => record.requestDigest).sort())) throw new Error("restore drill changed the source recovery ledgers");
  console.log(JSON.stringify({ restore: "PASS", encryptedBackup: true, backupAlgorithm: encryptedBackup.algorithm, tamperRejected, sourceRevision: sourceBefore.revision.toString(), targetDatabase: restoreDatabase, targetRevision: targetLatest.revision.toString(), targetStatus: targetLatest.snapshot.healthStatus, recoveredOutbox: targetBundle.outboxRecords.length, recoveredUsage: targetBundle.usageRecords.length, recoveredInbox: targetBundle.inboxRecords.length, recoveredExternalEffects: targetBundle.externalEffects.length, loginBlocked: true, readinessBlocked: true, sourceUnchanged: true }, null, 2));
} finally {
  if (runtime) await runtime.app.close().catch(() => undefined);
  await targetPersistence?.close().catch(() => undefined);
  await sourcePersistence.close().catch(() => undefined);
  if (adminConnected) await admin.end().catch(() => undefined);
  if (created) {
    const cleanup = new Client({ connectionString: maintenanceUrl(sourceUrl), connectionTimeoutMillis: 2_500 });
    try {
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${quoteIdentifier(restoreDatabase)}`);
    } finally {
      await cleanup.end().catch(() => undefined);
    }
  }
}
