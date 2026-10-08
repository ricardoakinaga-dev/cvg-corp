import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg, { type Client as PgClient, type Pool } from "pg";
import { CvgStore, digest } from "@cvg/domain";
import { createRuntime } from "@cvg/api";
import { PostgresAgentSessionStore, createScopedSqlExecutor } from "@cvg/agent-session";
import { assertRestorableRecoveryBundle, createRecoveryBundleManifest, CVG_RESTORE_AUTHORITY_ROLE, decryptRecoveryBundle, encryptRecoveryBundle, PersistenceCorruptionError, PersistenceStateError, PostgresPersistence, validateRecoveryBundle, validateRecoveryStoreCoverage, type DurableRecoveryBundle, type DurableRestoreInput, type EncryptedRecoveryBundle } from "@cvg/persistence";

const { Client } = pg;
validateRecoveryStoreCoverage();
const sourceUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!sourceUrl || !migrationUrl) {
  process.stderr.write("POSTGRES_RESTORE_BLOCKED_EXTERNAL DATABASE_URL and MIGRATION_DATABASE_URL are required; use explicitly identified runtime and schema-owner databases\n");
  process.exit(2);
}
const maintenanceConnectionString = process.env.ADMIN_DATABASE_URL ?? maintenanceUrl(migrationUrl);

const bootstrapPassword = process.env.CVG_BOOTSTRAP_PASSWORD ?? "synthetic-password-123";
const restoreDatabase = `cvg_restore_${randomUUID().replaceAll("-", "")}`;
const quoteIdentifier = (value: string): string => `"${value.replaceAll("\"", "\"\"")}"`;
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

function withDatabase(connectionString: string, database: string): string {
  const queryIndex = connectionString.indexOf("?");
  const main = queryIndex >= 0 ? connectionString.slice(0, queryIndex) : connectionString;
  const query = queryIndex >= 0 ? connectionString.slice(queryIndex) : "";
  const separator = main.lastIndexOf("/");
  if (separator < main.indexOf("://") + 3) throw new Error("DATABASE_URL must use a URL form with an explicit database name");
  return `${main.slice(0, separator + 1)}${database}${query}`;
}

function withCredentials(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

function maintenanceUrl(connectionString: string): string {
  return withDatabase(connectionString, "postgres");
}

function recoveryJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested);
}

function runtimeRecordDigest(record: Record<string, unknown>): string {
  const { recordDigest: _recordDigest, checkpointId: _checkpointId, ...content } = record;
  return digest(content);
}

function rebindRecoveryRuntime(
  bundle: DurableRecoveryBundle,
  overrides: {
    agentSessions?: DurableRecoveryBundle["agentSessions"];
    agentTurns?: DurableRecoveryBundle["agentTurns"];
    agentCheckpoints?: DurableRecoveryBundle["agentCheckpoints"];
    agentLeases?: DurableRecoveryBundle["agentLeases"];
  }
): DurableRecoveryBundle {
  const agentSessions = overrides.agentSessions ?? bundle.agentSessions ?? [];
  const agentTurns = overrides.agentTurns ?? bundle.agentTurns ?? [];
  const agentCheckpoints = overrides.agentCheckpoints ?? bundle.agentCheckpoints ?? [];
  const agentLeases = overrides.agentLeases ?? bundle.agentLeases ?? [];
  return {
    ...bundle,
    agentSessions,
    agentTurns,
    agentCheckpoints,
    agentLeases,
    manifest: createRecoveryBundleManifest({
      organizationId: bundle.manifest.organizationId,
      revision: bundle.revision,
      snapshotDigest: bundle.snapshotDigest,
      eventId: bundle.eventId,
      migrationFingerprint: bundle.manifest.migrationFingerprint,
      outboxRecords: bundle.outboxRecords,
      usageRecords: bundle.usageRecords,
      inboxRecords: bundle.inboxRecords,
      externalEffects: bundle.externalEffects,
      workerJobs: bundle.workerJobs ?? [],
      agentSessions,
      agentTurns,
      agentCheckpoints,
      agentLeases,
      createdAt: bundle.manifest.createdAt,
      snapshotSchemaVersion: bundle.manifest.snapshotSchemaVersion
    })
  };
}

function reencryptRecoveryPayload(envelope: EncryptedRecoveryBundle, key: Uint8Array, payload: unknown): EncryptedRecoveryBundle {
  const plaintext = Buffer.from(recoveryJson(payload), "utf8");
  const payloadDigest = digest(JSON.parse(plaintext.toString("utf8")));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), nonce);
  const associatedData: { format: "CVG-RECOVERY-BUNDLE"; version: 1 | 2; algorithm: "AES-256-GCM"; keyRef: string; payloadDigest: string; expiresAt?: string | null } = {
    format: "CVG-RECOVERY-BUNDLE",
    version: envelope.version,
    algorithm: "AES-256-GCM",
    keyRef: envelope.keyRef,
    payloadDigest
  };
  if (envelope.version === 2) associatedData.expiresAt = envelope.expiresAt;
  cipher.setAAD(Buffer.from(JSON.stringify(associatedData), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ...envelope,
    payloadDigest,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

function durableStateDigest(bundle: DurableRecoveryBundle): string {
  const { manifest: _manifest, ...durableState } = bundle;
  return digest(JSON.parse(recoveryJson(durableState)));
}

function expectRecoveryRejection(label: string, action: () => void, messageFragment: string): void {
  try {
    action();
  } catch (error) {
    if (error instanceof PersistenceCorruptionError && error.message.includes(messageFragment)) return;
    throw new Error(`${label} rejected with an unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${label} was accepted`);
}

type PreconnectionProbe = {
  connect: number;
  begin: number;
  dml: number;
  statements: string[];
};

function preconnectionPool(probe: PreconnectionProbe): Pool {
  const client = {
    async query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> {
      const statement = sql.trim().replace(/\s+/g, " ");
      probe.statements.push(statement);
      if (/^BEGIN\b/i.test(statement)) probe.begin += 1;
      if (/^(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke)\b/i.test(statement)) probe.dml += 1;
      throw new Error(`preconnection probe received an unexpected SQL statement: ${statement}`);
    },
    release(): void {}
  };
  return {
    connect: async () => {
      probe.connect += 1;
      return client;
    }
  } as unknown as Pool;
}

type DirectSqlRelation = {
  count: number;
  digest: string;
  rows: Array<Record<string, unknown>>;
};

type DirectSqlOracle = Record<string, DirectSqlRelation>;

const DIRECT_SQL_RELATIONS: Array<{ name: string; sql: string }> = [
  { name: "organizations", sql: "select row_to_json(row_data)::jsonb as row from (select * from organizations where id = $1) row_data" },
  { name: "sessions", sql: "select row_to_json(row_data)::jsonb as row from (select * from sessions where organization_id = $1 order by id) row_data" },
  { name: "cvg_state_snapshots", sql: "select row_to_json(row_data)::jsonb as row from (select * from cvg_state_snapshots order by revision) row_data" },
  { name: "cvg_event_journal", sql: "select row_to_json(row_data)::jsonb as row from (select * from cvg_event_journal where organization_id = $1 order by sequence_id) row_data" },
  { name: "audit_records", sql: "select row_to_json(row_data)::jsonb as row from (select * from audit_records where organization_id = $1 order by id) row_data" },
  { name: "cvg_audit_ledger", sql: "select row_to_json(row_data)::jsonb as row from (select * from cvg_audit_ledger where organization_id = $1 order by sequence_id) row_data" },
  { name: "command_receipts", sql: "select row_to_json(row_data)::jsonb as row from (select * from command_receipts where organization_id = $1 order by id) row_data" },
  { name: "cvg_command_receipt_ledger", sql: "select row_to_json(row_data)::jsonb as row from (select * from cvg_command_receipt_ledger where organization_id = $1 order by sequence_id) row_data" },
  { name: "outbox_records", sql: "select row_to_json(row_data)::jsonb as row from (select * from outbox_records where organization_id = $1 order by id) row_data" },
  { name: "ai_usage_ledger", sql: "select row_to_json(row_data)::jsonb as row from (select * from ai_usage_ledger where organization_id = $1 order by id) row_data" },
  { name: "integration_inbox_records", sql: "select row_to_json(row_data)::jsonb as row from (select * from integration_inbox_records where organization_id = $1 order by id) row_data" },
  { name: "external_effects", sql: "select row_to_json(row_data)::jsonb as row from (select * from external_effects where organization_id = $1 order by id) row_data" },
  { name: "cvg_worker_jobs", sql: "select row_to_json(row_data)::jsonb as row from (select * from cvg_worker_jobs where organization_id = $1 order by id) row_data" },
  { name: "agent_sessions", sql: "select row_to_json(row_data)::jsonb as row from (select * from agent_sessions where organization_id = $1 order by session_id) row_data" },
  { name: "agent_turns", sql: "select row_to_json(row_data)::jsonb as row from (select * from agent_turns where organization_id = $1 order by session_id, sequence) row_data" },
  { name: "agent_checkpoints", sql: "select row_to_json(row_data)::jsonb as row from (select * from agent_checkpoints where organization_id = $1 order by session_id, sequence) row_data" },
  { name: "agent_leases", sql: "select row_to_json(row_data)::jsonb as row from (select * from agent_leases where organization_id = $1 order by session_id) row_data" }
];

async function readDirectSqlOracle(client: PgClient, organizationId: string): Promise<DirectSqlOracle> {
  await client.query("select set_config('cvg.organization_id', $1, false)", [organizationId]);
  const oracle: DirectSqlOracle = {};
  for (const relation of DIRECT_SQL_RELATIONS) {
    const result = await client.query<{ row: Record<string, unknown> }>(relation.sql, relation.sql.includes("$1") ? [organizationId] : []);
    const rows = result.rows.map(({ row }) => row);
    oracle[relation.name] = { count: rows.length, digest: digest(comparableDirectSqlRows(relation.name, rows)), rows };
  }
  return oracle;
}

function comparableDirectSqlRows(name: string, rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const content = name === "cvg_audit_ledger" || name === "cvg_command_receipt_ledger"
      ? (({ sequence_id: _sequenceId, created_at: _createdAt, ...rest }) => rest)(row)
      : name === "agent_checkpoints"
        ? (({ checkpoint_id: _checkpointId, ...rest }) => rest)(row)
        : name === "agent_turns"
          ? (({ created_at: _createdAt, ...rest }) => rest)(row)
        : row;
    return normalizeDirectSqlValue(content) as Record<string, unknown>;
  });
}

function normalizeDirectSqlValue(value: unknown): unknown {
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return value;
    const fraction = match[2] ? `.${match[2].slice(0, 3).padEnd(3, "0")}` : "";
    return `${match[1]}${fraction}${match[3]}`;
  }
  if (Array.isArray(value)) return value.map(normalizeDirectSqlValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeDirectSqlValue(entry)]));
  return value;
}

function directSqlOracleSummary(oracle: DirectSqlOracle): Record<string, { count: number; digest: string }> {
  return Object.fromEntries(Object.entries(oracle).map(([name, relation]) => [name, { count: relation.count, digest: relation.digest }]));
}

function requiredDirectSqlRelation(oracle: DirectSqlOracle, name: string): DirectSqlRelation {
  const relation = oracle[name];
  if (!relation) throw new Error(`direct SQL oracle relation ${name} is missing`);
  return relation;
}

function immutableAgentSessionRows(oracle: DirectSqlOracle): Array<Record<string, unknown>> {
  return requiredDirectSqlRelation(oracle, "agent_sessions").rows.map(({ status: _status, run_state: _runState, updated_at: _updatedAt, ...immutable }) => normalizeDirectSqlValue(immutable) as Record<string, unknown>);
}

function immutableAgentSessionDifferenceFields(source: DirectSqlOracle, target: DirectSqlOracle): Array<{ sessionId: string; fields: string[] }> {
  const sourceRows = immutableAgentSessionRows(source);
  const targetRows = immutableAgentSessionRows(target);
  const sourceById = new Map(sourceRows.map((row) => [String(row.session_id), row]));
  const targetById = new Map(targetRows.map((row) => [String(row.session_id), row]));
  const sessionIds = [...new Set([...sourceById.keys(), ...targetById.keys()])].sort();
  return sessionIds.flatMap((sessionId) => {
    const sourceRow = sourceById.get(sessionId);
    const targetRow = targetById.get(sessionId);
    if (!sourceRow || !targetRow) return [{ sessionId, fields: [sourceRow ? "missing_at_target" : "missing_at_source"] }];
    const fields = [...new Set([...Object.keys(sourceRow), ...Object.keys(targetRow)])]
      .filter((field) => JSON.stringify(sourceRow[field]) !== JSON.stringify(targetRow[field]))
      .sort();
    return fields.length ? [{ sessionId, fields }] : [];
  });
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
        throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const runtimeRole = (process.env.CVG_RUNTIME_DB_USER ?? "cvg_runtime").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(runtimeRole)) throw new Error("CVG_RUNTIME_DB_USER is invalid");
    const runtimeIdentifier = quoteIdentifier(runtimeRole);
    const exists = await client.query<{ exists: boolean }>("select exists (select 1 from pg_roles where rolname = $1) as exists", [runtimeRole]);
    if (!exists.rows[0]?.exists) {
      const password = process.env.CVG_RUNTIME_DB_PASSWORD;
      if (!password || password.length < 16 || password.length > 256) throw new Error("CVG_RUNTIME_DB_PASSWORD is required to provision the restore runtime role");
      await client.query(`create role ${runtimeIdentifier} login password '${password.replaceAll("'", "''")}' noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
    } else {
      await client.query(`alter role ${runtimeIdentifier} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
    }
    const database = (await client.query<{ database: string }>("select current_database() as database")).rows[0]?.database;
    if (!database) throw new Error("restore database name is unavailable");
    await client.query(`grant connect on database ${quoteIdentifier(database)} to ${runtimeIdentifier}`);
    await client.query(`grant usage on schema public to ${runtimeIdentifier}`);
    await client.query(`revoke insert, update, delete on table public.schema_migrations from ${runtimeIdentifier}`);
    await client.query(`grant select on table public.schema_migrations to ${runtimeIdentifier}`);
    await client.query(`revoke create on schema public from ${runtimeIdentifier}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function readMigrationFingerprint(connectionString: string): Promise<string> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2_500 });
  await client.connect();
  try {
    const result = await client.query<{ version: string; checksum: string }>("select version, checksum from schema_migrations order by version");
    return digest(result.rows.map(({ version, checksum }) => ({ version, checksum })));
  } finally {
    await client.end().catch(() => undefined);
  }
}

const sourcePersistence = new PostgresPersistence({ connectionString: sourceUrl });
const sourceOrganizationId = new CvgStore({ bootstrapPassword }).bootstrapCredentials.organizationId;
const admin = new Client({ connectionString: maintenanceConnectionString, connectionTimeoutMillis: 2_500 });
let targetPersistence: PostgresPersistence | null = null;
let runtimePersistence: PostgresPersistence | null = null;
let targetLedgerClient: PgClient | null = null;
let sourceOracleClient: PgClient | null = null;
let runtime: Awaited<ReturnType<typeof createRuntime>> | null = null;
let created = false;
let adminConnected = false;
let authorityOwnerRole: string | null = null;
let sourceDirectSqlOracle: DirectSqlOracle | null = null;
let directSqlOracleReport: Record<string, unknown> | null = null;

try {
  const sourceCandidate = await sourcePersistence.loadLatest(sourceOrganizationId);
  if (!sourceCandidate) throw new Error("source database has no durable snapshot to restore");
  if (!sourceCandidate.snapshot.organizations.some((organization) => organization.id === sourceOrganizationId)) throw new Error(`source database snapshot has no expected organization ${sourceOrganizationId}`);
  // CVG-AUD19-010/011: seed durable agent runtime state (two fences, an
  // active lease and history under a historical fence) so the restore proves
  // continuity, quarantine and lease handling.
  const sourceActorId = new CvgStore({ bootstrapPassword }).bootstrapCredentials.userId;
  const agentSessionId = randomUUID();
  const sourceAgentPool = new pg.Pool({ connectionString: sourceUrl, max: 2, application_name: "cvg-restore-agent-seed" });
  try {
    const sourceAgentStore = new PostgresAgentSessionStore(createScopedSqlExecutor({
      connect: async () => {
        const client = await sourceAgentPool.connect();
        return { query: async (text: string, params: readonly unknown[]) => ({ rows: (await client.query(text, params as unknown[])).rows as Record<string, unknown>[] }), release: () => client.release() };
      }
    }));
    await sourceAgentStore.create({ sessionId: agentSessionId, organizationId: sourceOrganizationId, actorId: sourceActorId, unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "restore drill agent session", ttlMs: 600_000 });
    const firstLease = await sourceAgentStore.acquireLease({ sessionId: agentSessionId, organizationId: sourceOrganizationId, ownerId: "restore-source-1", ttlMs: 600_000 });
    if (!firstLease) throw new Error("restore drill could not acquire the first source lease");
    await sourceAgentStore.checkpoint({ sessionId: agentSessionId, organizationId: sourceOrganizationId, fence: firstLease.fence, payload: { step: "checkpoint-1" } });
    await sourceAgentStore.appendTurn({ turnId: randomUUID(), sessionId: agentSessionId, organizationId: sourceOrganizationId, sequence: 0, status: "COMPLETED", inputDigest: digest({ turn: 1 }), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: { provider: "restore-drill", fence: firstLease.fence }, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), fence: firstLease.fence });
    await sourceAgentStore.releaseLease({ sessionId: agentSessionId, organizationId: sourceOrganizationId, ownerId: firstLease.ownerId, fence: firstLease.fence });
    const secondLease = await sourceAgentStore.acquireLease({ sessionId: agentSessionId, organizationId: sourceOrganizationId, ownerId: "restore-source-2", ttlMs: 600_000 });
    if (!secondLease) throw new Error("restore drill could not acquire the second source lease");
    await sourceAgentStore.appendTurn({ turnId: randomUUID(), sessionId: agentSessionId, organizationId: sourceOrganizationId, sequence: 0, status: "COMPLETED", inputDigest: digest({ turn: 2 }), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: { provider: "restore-drill", fence: secondLease.fence }, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), fence: secondLease.fence });
    // The second lease stays active at export time: restore must drop it.
  } finally {
    await sourceAgentPool.end();
  }
  const sourceBefore = await sourcePersistence.exportRecoveryBundle(sourceOrganizationId);
  if (!sourceBefore) throw new Error("source database has no recovery bundle to restore");
  assertRestorableRecoveryBundle(sourceBefore);
  const seededSession = (sourceBefore.agentSessions ?? []).find((record) => record.sessionId === agentSessionId);
  const seededTurns = (sourceBefore.agentTurns ?? []).filter((record) => record.sessionId === agentSessionId);
  const seededCheckpoints = (sourceBefore.agentCheckpoints ?? []).filter((record) => record.sessionId === agentSessionId);
  const seededLeases = (sourceBefore.agentLeases ?? []).filter((record) => record.sessionId === agentSessionId);
  if (!seededSession || seededSession.fence !== 2 || seededTurns.length !== 2 || seededCheckpoints.length !== 1 || seededLeases.length !== 1) throw new Error(`source agent runtime state is incomplete: session=${JSON.stringify(seededSession)} turns=${seededTurns.length} checkpoints=${seededCheckpoints.length} leases=${seededLeases.length}`);
  if (sourceBefore.revision !== sourceCandidate.revision || sourceBefore.eventId !== sourceCandidate.eventId) throw new Error("source recovery bundle changed while it was being exported");
  const sourceMigrationFingerprint = await readMigrationFingerprint(sourceUrl);
  validateRecoveryBundle(sourceBefore, { expectedMigrationFingerprint: sourceMigrationFingerprint });
  sourceOracleClient = new Client({ connectionString: sourceUrl, connectionTimeoutMillis: 2_500 });
  await sourceOracleClient.connect();
  sourceDirectSqlOracle = await readDirectSqlOracle(sourceOracleClient, sourceOrganizationId);
  const sourceAgentSessions = sourceBefore.agentSessions ?? [];
  const sourceAgentTurns = sourceBefore.agentTurns ?? [];
  const sourceAgentCheckpoints = sourceBefore.agentCheckpoints ?? [];
  const sourceAgentLeases = sourceBefore.agentLeases ?? [];
  if (!seededSession || !seededTurns[1] || !seededCheckpoints[0] || !seededLeases[0]) throw new Error("semantic recovery fixture is incomplete");

  const tamperedCheckpoint = { ...seededCheckpoints[0], payload: { ...seededCheckpoints[0].payload, semanticTamper: true } };
  expectRecoveryRejection(
    "checkpoint payload digest",
    () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentCheckpoints: sourceAgentCheckpoints.map((record) => record.sessionId === agentSessionId && record.sequence === seededCheckpoints[0]!.sequence ? tamperedCheckpoint : record) })),
    "does not match schema and payload"
  );

  const staleSessionCheckpointDigest = { ...seededSession, checkpointDigest: "0".repeat(64) };
  staleSessionCheckpointDigest.recordDigest = runtimeRecordDigest(staleSessionCheckpointDigest);
  expectRecoveryRejection(
    "session checkpoint digest",
    () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === agentSessionId ? staleSessionCheckpointDigest : record) })),
    "checkpointDigest does not match its latest checkpoint"
  );

  const foreignActorSession = { ...seededSession, actorId: randomUUID() };
  foreignActorSession.recordDigest = runtimeRecordDigest(foreignActorSession);
  expectRecoveryRejection(
    "agent session actor foreign key",
    () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === agentSessionId ? foreignActorSession : record) })),
    "actorId " + foreignActorSession.actorId + " is not present in the snapshot"
  );

  const sequenceGapTurn = { ...seededTurns[1], sequence: seededTurns[1].sequence + 1 };
  sequenceGapTurn.recordDigest = runtimeRecordDigest(sequenceGapTurn);
  expectRecoveryRejection(
    "agent turn sequence gap",
    () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentTurns: sourceAgentTurns.map((record) => record.turnId === sequenceGapTurn.turnId ? sequenceGapTurn : record) })),
    "sequence is not contiguous"
  );

  const futureFenceCheckpoint = { ...seededCheckpoints[0], fence: seededSession.fence + 1 };
  futureFenceCheckpoint.recordDigest = runtimeRecordDigest(futureFenceCheckpoint);
   expectRecoveryRejection(
     "agent checkpoint future fence",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentCheckpoints: sourceAgentCheckpoints.map((record) => record.sessionId === agentSessionId && record.sequence === seededCheckpoints[0]!.sequence ? futureFenceCheckpoint : record) })),
     "fence is newer than its authoritative session fence"
   );

   const danglingUsageTurn = { ...seededTurns[0]!, usageRecordId: randomUUID() };
   danglingUsageTurn.recordDigest = runtimeRecordDigest(danglingUsageTurn);
   expectRecoveryRejection(
     "agent turn dangling usage reference",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentTurns: sourceAgentTurns.map((record) => record.turnId === danglingUsageTurn.turnId ? danglingUsageTurn : record) })),
     "usageRecordId"
   );

   const zeroFenceLease = { ...seededLeases[0]!, fence: 0 };
   zeroFenceLease.recordDigest = runtimeRecordDigest(zeroFenceLease);
   expectRecoveryRejection(
     "agent lease zero fence",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentLeases: sourceAgentLeases.map((record) => record.sessionId === zeroFenceLease.sessionId ? zeroFenceLease : record) })),
      "agentLeases["
   );

   const mismatchedLease = { ...seededLeases[0]!, fence: seededSession.fence - 1 };
   mismatchedLease.recordDigest = runtimeRecordDigest(mismatchedLease);
   expectRecoveryRejection(
     "agent lease/session fence mismatch",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentLeases: sourceAgentLeases.map((record) => record.sessionId === mismatchedLease.sessionId ? mismatchedLease : record) })),
     "not the authoritative session fence"
   );

   const terminalSession = { ...seededSession, status: "COMPLETED", runState: "COMPLETED" };
   terminalSession.recordDigest = runtimeRecordDigest(terminalSession);
   expectRecoveryRejection(
     "agent lease on terminal session",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === terminalSession.sessionId ? terminalSession : record) })),
     "terminal session"
   );

   const invertedLease = { ...seededLeases[0]!, expiresAt: new Date(Date.parse(seededLeases[0]!.acquiredAt) - 1).toISOString() };
   invertedLease.recordDigest = runtimeRecordDigest(invertedLease);
   expectRecoveryRejection(
     "agent lease inverted timestamp",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentLeases: sourceAgentLeases.map((record) => record.sessionId === invertedLease.sessionId ? invertedLease : record) })),
     "expiresAt precedes acquiredAt"
   );

   const invalidScopeSession = { ...seededSession, unitId: randomUUID(), workspaceId: null };
   invalidScopeSession.recordDigest = runtimeRecordDigest(invalidScopeSession);
   expectRecoveryRejection(
     "agent session invalid unit/workspace scope",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === invalidScopeSession.sessionId ? invalidScopeSession : record) })),
     "incomplete unit/workspace scope"
   );

   const turnSequenceGap = { ...seededTurns[1]!, sequence: seededTurns[1]!.sequence + 1 };
   turnSequenceGap.recordDigest = runtimeRecordDigest(turnSequenceGap);
   expectRecoveryRejection(
     "agent turn sequence gap",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentTurns: sourceAgentTurns.map((record) => record.turnId === turnSequenceGap.turnId ? turnSequenceGap : record) })),
     "sequence is not contiguous"
   );

   const checkpointSequenceGap = { ...seededCheckpoints[0]!, sequence: seededCheckpoints[0]!.sequence + 1 };
   checkpointSequenceGap.recordDigest = runtimeRecordDigest(checkpointSequenceGap);
   const sessionWithCheckpointGap = { ...seededSession, checkpointDigest: checkpointSequenceGap.digest };
   sessionWithCheckpointGap.recordDigest = runtimeRecordDigest(sessionWithCheckpointGap);
   expectRecoveryRejection(
     "agent checkpoint sequence gap",
     () => validateRecoveryBundle(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === sessionWithCheckpointGap.sessionId ? sessionWithCheckpointGap : record), agentCheckpoints: sourceAgentCheckpoints.map((record) => record.sessionId === checkpointSequenceGap.sessionId && record.sequence === seededCheckpoints[0]!.sequence ? checkpointSequenceGap : record) })),
     "sequence is not contiguous"
   );

   const backupKey = randomBytes(32);
  const encryptedBackup = encryptRecoveryBundle(sourceBefore, backupKey, "synthetic-kms-key");
  const restoredBundle = decryptRecoveryBundle(encryptedBackup, backupKey);
  validateRecoveryBundle(restoredBundle, { expectedMigrationFingerprint: sourceMigrationFingerprint });
  const rehashedPayload = JSON.parse(recoveryJson(restoredBundle)) as { agentCheckpoints?: Array<{ sessionId: string; sequence: number; payload: Record<string, unknown> }> };
  const rehashedCheckpoint = rehashedPayload.agentCheckpoints?.find((checkpoint) => checkpoint.sessionId === agentSessionId && checkpoint.sequence === seededCheckpoints[0]!.sequence);
  if (!rehashedCheckpoint) throw new Error("rehashed envelope fixture has no checkpoint");
  rehashedCheckpoint.payload = { ...rehashedCheckpoint.payload, semanticTamper: "rehashed-envelope" };
  const rehashedEnvelope = reencryptRecoveryPayload(encryptedBackup, backupKey, rehashedPayload);
  let rehashedEnvelopeRejected = false;
  let rehashedEnvelopeError: string | null = null;
  try {
    decryptRecoveryBundle(rehashedEnvelope, backupKey);
  } catch (error) {
    rehashedEnvelopeError = error instanceof Error ? error.message : String(error);
    rehashedEnvelopeRejected = error instanceof PersistenceCorruptionError && error.message.toLowerCase().includes("checkpoint");
  }
  if (!rehashedEnvelopeRejected) throw new Error(`rehashed recovery envelope with a tampered checkpoint was accepted or rejected unexpectedly: ${rehashedEnvelopeError ?? "accepted"}; payload=${JSON.stringify(rehashedCheckpoint.payload)}`);
  if (restoredBundle.revision !== sourceBefore.revision || restoredBundle.eventId !== sourceBefore.eventId || restoredBundle.snapshotDigest !== sourceBefore.snapshotDigest || restoredBundle.snapshot.auditRecords.length !== sourceBefore.snapshot.auditRecords.length || restoredBundle.snapshot.commandReceipts.length !== sourceBefore.snapshot.commandReceipts.length || restoredBundle.outboxRecords.length !== sourceBefore.outboxRecords.length || restoredBundle.usageRecords.length !== sourceBefore.usageRecords.length || restoredBundle.inboxRecords.length !== sourceBefore.inboxRecords.length || restoredBundle.externalEffects.length !== sourceBefore.externalEffects.length || (restoredBundle.workerJobs?.length ?? 0) !== (sourceBefore.workerJobs?.length ?? 0) || (restoredBundle.agentSessions?.length ?? 0) !== (sourceBefore.agentSessions?.length ?? 0) || (restoredBundle.agentTurns?.length ?? 0) !== (sourceBefore.agentTurns?.length ?? 0) || (restoredBundle.agentCheckpoints?.length ?? 0) !== (sourceBefore.agentCheckpoints?.length ?? 0) || (restoredBundle.agentLeases?.length ?? 0) !== (sourceBefore.agentLeases?.length ?? 0)) throw new Error("encrypted recovery bundle round-trip changed durable recovery state");
  const tamperedCiphertext = Buffer.from(encryptedBackup.ciphertext, "base64");
  tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1;
  let tamperRejected = false;
  try {
    decryptRecoveryBundle({ ...encryptedBackup, ciphertext: tamperedCiphertext.toString("base64") }, backupKey);
  } catch (error) {
    tamperRejected = error instanceof PersistenceCorruptionError;
  }
  if (!tamperRejected) throw new Error("encrypted recovery bundle accepted tampered ciphertext");
  let partialRejected = false;
  try {
    validateRecoveryBundle({ ...restoredBundle, inboxRecords: undefined } as unknown as typeof restoredBundle, { expectedMigrationFingerprint: sourceMigrationFingerprint });
  } catch {
    partialRejected = true;
  }
  if (!partialRejected) throw new Error("partial recovery bundle was accepted");
  let staleRejected = false;
  try {
    validateRecoveryBundle(restoredBundle, { minimumRevision: restoredBundle.revision + 1n });
  } catch {
    staleRejected = true;
  }
  if (!staleRejected) throw new Error("stale recovery bundle was accepted");
  let migrationMismatchRejected = false;
  try {
    validateRecoveryBundle(restoredBundle, { expectedMigrationFingerprint: digest([{ version: "synthetic-mismatch", checksum: "synthetic-mismatch" }]) });
  } catch {
    migrationMismatchRejected = true;
  }
  if (!migrationMismatchRejected) throw new Error("recovery bundle with a migration mismatch was accepted");
  await admin.connect();
  adminConnected = true;
  authorityOwnerRole = `cvg_restore_matrix_owner_${randomUUID().replaceAll("-", "")}`;
  const authorityOwnerPassword = randomBytes(24).toString("base64url");
  // Historical migrations 016 and 022 require a privileged schema-install
  // executor (RLS bypass and alteration of the cluster-wide runtime role).
  // This disposable bootstrap role is downgraded before any authority matrix
  // or restore proof; it is never granted application table privileges.
  await admin.query(`create role ${quoteIdentifier(authorityOwnerRole)} login password ${quoteLiteral(authorityOwnerPassword)} noinherit superuser bypassrls createdb createrole noreplication`);
  await admin.query(`create database ${quoteIdentifier(restoreDatabase)} owner ${quoteIdentifier(authorityOwnerRole)}`);
  created = true;

   const targetOwnerUrl = withCredentials(withDatabase(migrationUrl, restoreDatabase), authorityOwnerRole, authorityOwnerPassword);
   const targetMigrationUrl = targetOwnerUrl;
   const targetUrl = withDatabase(sourceUrl, restoreDatabase);
   await migrate(targetOwnerUrl);
   // The migration connection is the actual schema-owner executor. The role
   // was provisioned only with CREATEROLE so migrations can install their
   // declared roles; revoke that bootstrap capability before the matrix. No
   // broad table grants, CREATE grants or ownership rewrites are used.
   await admin.query(`alter role ${quoteIdentifier(authorityOwnerRole)} nosuperuser nocreatedb nocreaterole nobypassrls`);
  // These variables are migration-role inputs, not application configuration.
  // Remove them before booting the restored API so the strict CVG_ config
  // allowlist does not confuse database provisioning credentials with runtime
  // settings.
   const runtimeDatabaseRole = (process.env.CVG_RUNTIME_DB_USER ?? "cvg_runtime").trim();
   delete process.env.CVG_RUNTIME_DB_USER;
   delete process.env.CVG_RUNTIME_DB_PASSWORD;
   const targetMigrationFingerprint = await readMigrationFingerprint(targetMigrationUrl);
   validateRecoveryBundle(restoredBundle, { expectedMigrationFingerprint: targetMigrationFingerprint });

    const restoredStore = new CvgStore({ bootstrapPassword });
   restoredStore.restore(restoredBundle.snapshot);
   const restoredSnapshot = restoredStore.snapshot();
   if (restoredSnapshot.healthStatus !== "QUARANTINED") throw new Error("restore fixture did not enter quarantine");
   if ([...restoredSnapshot.sessions].some((session) => session.revokedAt === null)) throw new Error("restore fixture retained an active session");

    targetLedgerClient = new Client({ connectionString: targetMigrationUrl, connectionTimeoutMillis: 2_500 });
    await targetLedgerClient.connect();
    await targetLedgerClient.query("select set_config('cvg.organization_id', $1, false)", [sourceOrganizationId]);
   const restoreInput: DurableRestoreInput = {
     expectedRevision: null,
     bundle: restoredBundle,
     migrationFingerprint: targetMigrationFingerprint,
     authority: { role: CVG_RESTORE_AUTHORITY_ROLE, reference: "verify-postgres-restore" },
     operation: "verify.postgres.restore",
     actorId: null,
     correlationId: "verify-postgres-restore",
     aggregateType: "Restore",
     aggregateId: null,
     payload: { synthetic: true, sourceRevision: restoredBundle.revision.toString(), sourceEventId: restoredBundle.eventId, quarantine: true, recoveredAuditRecords: restoredSnapshot.auditRecords.length, recoveredCommandReceipts: restoredSnapshot.commandReceipts.length, recoveredOutbox: restoredBundle.outboxRecords.length, recoveredUsageRecords: restoredBundle.usageRecords.length, recoveredInbox: restoredBundle.inboxRecords.length, recoveredExternalEffects: restoredBundle.externalEffects.length, recoveredWorkerJobs: restoredBundle.workerJobs?.length ?? 0 }
   };
    const authorityOwner = (await targetLedgerClient.query<{ current_user: string }>("select current_user")).rows[0]?.current_user;
    if (!authorityOwner) throw new Error("authority matrix could not resolve the schema-owner executor identity");
    const restoreRoleIdentifier = quoteIdentifier(CVG_RESTORE_AUTHORITY_ROLE);
    const runtimeRoleIdentifier = quoteIdentifier(runtimeDatabaseRole);
    type AuthorityState = { journal: number; snapshots: number; auditRows: number; auditLedger: number; receiptRows: number; receiptLedger: number; outbox: number; usageLedger: number; inbox: number; externalEffects: number; workerJobs: number; sessions: number; turns: number; checkpoints: number; leases: number; rollbacks: string };
    const authorityState = async (): Promise<AuthorityState> => {
     const result = await targetLedgerClient!.query<AuthorityState>(`select
       (select count(*)::int from cvg_event_journal) as journal,
       (select count(*)::int from cvg_state_snapshots) as snapshots,
       (select count(*)::int from audit_records) as "auditRows",
       (select count(*)::int from cvg_audit_ledger) as "auditLedger",
       (select count(*)::int from command_receipts) as "receiptRows",
       (select count(*)::int from cvg_command_receipt_ledger) as "receiptLedger",
       (select count(*)::int from outbox_records) as outbox,
       (select count(*)::int from ai_usage_ledger) as "usageLedger",
       (select count(*)::int from integration_inbox_records) as inbox,
       (select count(*)::int from external_effects) as "externalEffects",
       (select count(*)::int from cvg_worker_jobs) as "workerJobs",
       (select count(*)::int from agent_sessions) as sessions,
       (select count(*)::int from agent_turns) as turns,
       (select count(*)::int from agent_checkpoints) as checkpoints,
       (select count(*)::int from agent_leases) as leases,
       coalesce((select xact_rollback::text from pg_stat_database where datname = current_database()), '0') as rollbacks`);
     const row = result.rows[0];
     if (!row) throw new Error("authority matrix could not read independent destination state");
      return row;
    };
    const restoreCandidate = (bundle: DurableRecoveryBundle, overrides: Partial<DurableRestoreInput> = {}): DurableRestoreInput => ({ ...restoreInput, ...overrides, bundle });
    const preconnectionCorpus: Record<string, unknown> = {};
    const expectPreconnectionRejection = async (label: string, input: DurableRestoreInput, expectedMessage: string): Promise<void> => {
      const before = await authorityState();
      const beforeHash = digest(before);
      const probe: PreconnectionProbe = { connect: 0, begin: 0, dml: 0, statements: [] };
      const candidate = new PostgresPersistence({ connectionString: "postgres://preconnection.invalid", pool: preconnectionPool(probe) });
      let rejection: string | null = null;
      try {
        await candidate.restore(input);
      } catch (error) {
        if ((error instanceof PersistenceCorruptionError || error instanceof PersistenceStateError) && error.message.includes(expectedMessage)) rejection = error.message;
        else throw new Error(`${label} rejected unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await candidate.close();
      }
      if (!rejection) throw new Error(`${label} was accepted by the public restore entrypoint`);
      const after = await authorityState();
      const afterHash = digest(after);
      if (probe.connect !== 0 || probe.begin !== 0 || probe.dml !== 0 || probe.statements.length !== 0) throw new Error(`${label} crossed the pre-connection boundary: ${JSON.stringify(probe)}`);
      if (beforeHash !== afterHash) throw new Error(`${label} changed the destination: before=${beforeHash} after=${afterHash}`);
      preconnectionCorpus[label] = { status: "REJECTED", error: rejection, restorePoolConnects: probe.connect, begin: probe.begin, dml: probe.dml, destinationHashBefore: beforeHash, destinationHashAfter: afterHash };
    };
    const foreignTenantSession = { ...seededSession!, organizationId: randomUUID() };
    foreignTenantSession.recordDigest = runtimeRecordDigest(foreignTenantSession);
    const manifestLedgerDigestMismatch = {
      ...restoredBundle,
      manifest: {
        ...restoredBundle.manifest,
        ledgerDigests: { ...restoredBundle.manifest.ledgerDigests, outbox: digest({ knownBad: "manifest-ledger" }) }
      }
    };
    const manifestMigrationMismatch = {
      ...restoredBundle,
      manifest: { ...restoredBundle.manifest, migrationFingerprint: digest([{ version: "synthetic-manifest-mismatch", checksum: "synthetic-manifest-mismatch" }]) }
    };
    const partialBundle = { ...restoredBundle, inboxRecords: undefined } as unknown as DurableRecoveryBundle;
    const malformedSnapshotBundle = { ...restoredBundle, snapshot: { ...restoredBundle.snapshot, users: undefined } } as unknown as DurableRecoveryBundle;
    const preconnectionCases: Array<{ label: string; expectedMessage: string; input: DurableRestoreInput }> = [
      { label: "shape_missing_snapshot_users", expectedMessage: "snapshot.users", input: restoreCandidate(malformedSnapshotBundle) },
      { label: "shape_missing_inbox_ledger", expectedMessage: "inboxRecords", input: restoreCandidate(partialBundle) },
      { label: "digest_checkpoint_payload", expectedMessage: "does not match schema and payload", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentCheckpoints: sourceAgentCheckpoints.map((record) => record.sessionId === agentSessionId && record.sequence === seededCheckpoints[0]!.sequence ? tamperedCheckpoint : record) })) },
      { label: "digest_session_checkpoint", expectedMessage: "checkpointDigest does not match its latest checkpoint", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === agentSessionId ? staleSessionCheckpointDigest : record) })) },
      { label: "tenant_agent_session", expectedMessage: "different organization scope", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === agentSessionId ? foreignTenantSession : record) })) },
      { label: "scope_incomplete_unit_workspace", expectedMessage: "incomplete unit/workspace scope", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === invalidScopeSession.sessionId ? invalidScopeSession : record) })) },
      { label: "sequence_turn_gap", expectedMessage: "sequence is not contiguous", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentTurns: sourceAgentTurns.map((record) => record.turnId === turnSequenceGap.turnId ? turnSequenceGap : record) })) },
      { label: "sequence_checkpoint_gap", expectedMessage: "sequence is not contiguous", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === sessionWithCheckpointGap.sessionId ? sessionWithCheckpointGap : record), agentCheckpoints: sourceAgentCheckpoints.map((record) => record.sessionId === checkpointSequenceGap.sessionId && record.sequence === seededCheckpoints[0]!.sequence ? checkpointSequenceGap : record) })) },
      { label: "fence_checkpoint_future", expectedMessage: "fence is newer than its authoritative session fence", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentCheckpoints: sourceAgentCheckpoints.map((record) => record.sessionId === agentSessionId && record.sequence === seededCheckpoints[0]!.sequence ? futureFenceCheckpoint : record) })) },
      { label: "lease_zero_fence", expectedMessage: "fence is invalid", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentLeases: sourceAgentLeases.map((record) => record.sessionId === zeroFenceLease.sessionId ? zeroFenceLease : record) })) },
      { label: "lease_session_fence_mismatch", expectedMessage: "not the authoritative session fence", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentLeases: sourceAgentLeases.map((record) => record.sessionId === mismatchedLease.sessionId ? mismatchedLease : record) })) },
      { label: "lease_terminal_session", expectedMessage: "terminal session", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === terminalSession.sessionId ? terminalSession : record) })) },
      { label: "lease_inverted_timestamp", expectedMessage: "expiresAt precedes acquiredAt", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentLeases: sourceAgentLeases.map((record) => record.sessionId === invertedLease.sessionId ? invertedLease : record) })) },
      { label: "foreign_actor_fk", expectedMessage: "is not present in the snapshot", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentSessions: sourceAgentSessions.map((record) => record.sessionId === agentSessionId ? foreignActorSession : record) })) },
      { label: "dangling_usage_fk", expectedMessage: "usageRecordId", input: restoreCandidate(rebindRecoveryRuntime(sourceBefore, { agentTurns: sourceAgentTurns.map((record) => record.turnId === danglingUsageTurn.turnId ? danglingUsageTurn : record) })) },
      { label: "manifest_ledger_digest", expectedMessage: "ledger digest mismatch", input: restoreCandidate(manifestLedgerDigestMismatch) },
      { label: "manifest_migration_fingerprint", expectedMessage: "recovery bundle migration fingerprint", input: restoreCandidate(manifestMigrationMismatch) },
      { label: "input_migration_fingerprint", expectedMessage: "recovery bundle migration fingerprint", input: restoreCandidate(restoredBundle, { migrationFingerprint: digest([{ version: "synthetic-input-mismatch", checksum: "synthetic-input-mismatch" }]) }) }
    ];
    for (const preconnectionCase of preconnectionCases) await expectPreconnectionRejection(preconnectionCase.label, preconnectionCase.input, preconnectionCase.expectedMessage);
    console.log(JSON.stringify({ preconnectionCorpus }));
   const authorityMatrix: Record<string, unknown> = {};
   let lateRestoreRejected = false;
   let lateRestoreErrorMessage = "";
   const expectAuthorityRejection = async (label: string, connectionString: string, expectedMessage: string, setup: () => Promise<void>, cleanup: () => Promise<void>, input: DurableRestoreInput = restoreInput): Promise<void> => {
     await setup();
     const before = await authorityState();
     let rejection: string | null = null;
     const candidate = new PostgresPersistence({ connectionString });
     try {
       await candidate.restore(input);
     } catch (error) {
       if (error instanceof PersistenceStateError && error.message.includes(expectedMessage)) rejection = error.message;
       else throw new Error(`${label} rejected unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
     } finally {
       await candidate.close();
       await cleanup();
     }
     if (!rejection) throw new Error(`${label} was accepted`);
     const after = await authorityState();
     const rollbackDelta = BigInt(after.rollbacks) - BigInt(before.rollbacks);
     if (JSON.stringify(after) !== JSON.stringify(before) || rollbackDelta !== 0n) throw new Error(`${label} changed destination state: before=${JSON.stringify(before)} after=${JSON.stringify(after)} rollbackDelta=${rollbackDelta}`);
     authorityMatrix[label] = { status: "REJECTED", error: rejection, durableStateUnchanged: true, rollbackDelta: rollbackDelta.toString() };
    };
    await expectAuthorityRejection("restore_role_login", targetMigrationUrl, "authority role contract", async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} login`);
    }, async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} nologin`);
    });
    await expectAuthorityRejection("restore_role_superuser", targetMigrationUrl, "authority role contract", async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} superuser`);
    }, async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} nosuperuser`);
    });
    await expectAuthorityRejection("restore_role_bypassrls", targetMigrationUrl, "authority role contract", async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} bypassrls`);
    }, async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} nobypassrls`);
    });
    await expectAuthorityRejection("restore_role_inherit", targetMigrationUrl, "authority role contract", async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} inherit`);
    }, async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} noinherit`);
    });
    await expectAuthorityRejection("restore_role_createdb", targetMigrationUrl, "authority role contract", async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} createdb`);
    }, async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} nocreatedb`);
    });
    await expectAuthorityRejection("restore_role_createrole", targetMigrationUrl, "authority role contract", async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} createrole`);
    }, async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} nocreaterole`);
    });
    await expectAuthorityRejection("restore_role_replication", targetMigrationUrl, "authority role contract", async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} replication`);
    }, async () => {
      await admin.query(`alter role ${restoreRoleIdentifier} noreplication`);
    });
    await expectAuthorityRejection("schema_owner_membership_missing", targetMigrationUrl, "not a member of the dedicated restore authority", async () => {
      await admin.query(`revoke ${restoreRoleIdentifier} from ${quoteIdentifier(authorityOwner)}`);
    }, async () => {
      await admin.query(`grant ${restoreRoleIdentifier} to ${quoteIdentifier(authorityOwner)}`);
    });
    await expectAuthorityRejection("runtime_membership_forbidden", targetMigrationUrl, "runtime role must not be a member", async () => {
      await admin.query(`grant ${restoreRoleIdentifier} to ${runtimeRoleIdentifier}`);
    }, async () => {
      await admin.query(`revoke ${restoreRoleIdentifier} from ${runtimeRoleIdentifier}`);
    });
   await expectAuthorityRejection("runtime_executor_not_schema_owner", targetUrl, "schema-owner executor connection", async () => undefined, async () => undefined);
   await expectAuthorityRejection("migration_fingerprint_mismatch_preconnection", targetMigrationUrl, "migration fingerprint", async () => undefined, async () => undefined, { ...restoreInput, migrationFingerprint: digest([{ version: "synthetic-mismatch", checksum: "synthetic-mismatch" }]) });
   authorityMatrix.knownGoodPrecondition = "PASS: all rejected variants left durable destination rows and rollback counter unchanged";

   // CVG-AUD20-002: restoring durable agent state is a maintenance operation
  // with higher authority than the runtime role.  The restore commit runs as
  // the schema owner; the runtime role is used only for the post-restore
  // readiness/login probes.
  targetPersistence = new PostgresPersistence({ connectionString: targetMigrationUrl });
   const targetCommit = await targetPersistence.restore({
     expectedRevision: null,
     bundle: restoredBundle,
     migrationFingerprint: targetMigrationFingerprint,
     authority: { role: CVG_RESTORE_AUTHORITY_ROLE, reference: "verify-postgres-restore" },
     operation: "verify.postgres.restore",
     actorId: null,
     correlationId: "verify-postgres-restore",
     aggregateType: "Restore",
     aggregateId: null,
     payload: { synthetic: true, sourceRevision: restoredBundle.revision.toString(), sourceEventId: restoredBundle.eventId, quarantine: true, recoveredAuditRecords: restoredSnapshot.auditRecords.length, recoveredCommandReceipts: restoredSnapshot.commandReceipts.length, recoveredOutbox: restoredBundle.outboxRecords.length, recoveredUsage: restoredBundle.usageRecords.length, recoveredInbox: restoredBundle.inboxRecords.length, recoveredExternalEffects: restoredBundle.externalEffects.length, recoveredWorkerJobs: restoredBundle.workerJobs?.length ?? 0 }
   });
   if (targetCommit.revision !== 1n) throw new Error(`restore target revision is ${targetCommit.revision}, expected 1`);
   authorityMatrix.knownGoodRestore = { status: "PASS", revision: targetCommit.revision.toString(), destinationStateAdvanced: true };
   console.log(JSON.stringify({ authorityMatrix }));

   // Re-run the public restore against the committed destination with the
   // same event id. The duplicate journal key is discovered after identity,
   // domain and recovery-ledger projection, proving the transaction rolls
   // every projection back without deleting append-only evidence.
   const lateBundle = rebindRecoveryRuntime(restoredBundle, { agentSessions: [], agentTurns: [], agentCheckpoints: [], agentLeases: [] });
   const lateBeforeAuthorityState = await authorityState();
   const lateBeforeBundle = await targetPersistence.exportRecoveryBundle(sourceOrganizationId);
   if (!lateBeforeBundle) throw new Error("known-good restore has no bundle for the late-failure rollback probe");
   try {
     await targetPersistence.restore({
       ...restoreInput,
       expectedRevision: targetCommit.revision,
       bundle: lateBundle,
       eventId: targetCommit.eventId,
       operation: "verify.postgres.restore.public-late-known-bad"
     });
   } catch (error) {
     lateRestoreErrorMessage = error instanceof Error ? `${error.name}:${error.message}:${String((error as Error & { cause?: unknown }).cause ?? "")}` : String(error);
     lateRestoreRejected = /event_id|cvg_event_journal.*(?:key|duplicate)|duplicate key/i.test(lateRestoreErrorMessage);
   }
   const lateAfterAuthorityState = await authorityState();
   const { rollbacks: lateBeforeRollbacks, ...lateBeforeDurableState } = lateBeforeAuthorityState;
   const { rollbacks: lateAfterRollbacks, ...lateAfterDurableState } = lateAfterAuthorityState;
   const lateAfterBundle = await targetPersistence.exportRecoveryBundle(sourceOrganizationId);
   const lateBundleUnchanged = lateAfterBundle !== null && durableStateDigest(lateAfterBundle) === durableStateDigest(lateBeforeBundle);
   if (!lateRestoreRejected || !lateBundleUnchanged || JSON.stringify(lateAfterDurableState) !== JSON.stringify(lateBeforeDurableState)) throw new Error(`public late-failure restore did not rollback atomically: ${JSON.stringify({ lateRestoreRejected, lateBundleUnchanged, rollbackDelta: (BigInt(lateAfterRollbacks) - BigInt(lateBeforeRollbacks)).toString(), before: lateBeforeDurableState, after: lateAfterDurableState, error: lateRestoreErrorMessage || "no error" })}`);

  const targetLatest = await targetPersistence.loadLatest(sourceOrganizationId);
  if (!targetLatest || targetLatest.snapshot.healthStatus !== "QUARANTINED") throw new Error("quarantined restore was not durable");
   const targetBundle = await targetPersistence.exportRecoveryBundle(sourceOrganizationId);
   if (!targetBundle) throw new Error("quarantined restore has no recovery bundle");
   validateRecoveryBundle(targetBundle, { expectedMigrationFingerprint: targetMigrationFingerprint });
   if (targetBundle.snapshot.healthStatus !== "QUARANTINED" || targetBundle.snapshot.sessions.some((session) => session.revokedAt === null)) throw new Error("restore target recovery bundle retained active authority");
   if (!sourceDirectSqlOracle) throw new Error("source direct SQL oracle was not captured before restore");
   const targetDirectSqlOracle = await readDirectSqlOracle(targetLedgerClient!, sourceOrganizationId);
   const exactRelationNames = ["audit_records", "cvg_audit_ledger", "command_receipts", "cvg_command_receipt_ledger", "outbox_records", "ai_usage_ledger", "integration_inbox_records", "external_effects", "cvg_worker_jobs", "agent_turns"];
   const exactRelations: Record<string, { sourceDigest: string; targetDigest: string; equal: boolean }> = {};
   for (const relationName of exactRelationNames) {
     const sourceRelation = sourceDirectSqlOracle[relationName];
     const targetRelation = targetDirectSqlOracle[relationName];
     if (!sourceRelation || !targetRelation) throw new Error(`direct SQL oracle relation ${relationName} is missing`);
      const comparison = { sourceDigest: sourceRelation.digest, targetDigest: targetRelation.digest, equal: sourceRelation.digest === targetRelation.digest };
      exactRelations[relationName] = comparison;
      if (!comparison.equal) {
        const sourceRows = comparableDirectSqlRows(relationName, sourceRelation.rows);
        const targetRows = comparableDirectSqlRows(relationName, targetRelation.rows);
        const differingFields = new Set<string>();
        for (let index = 0; index < Math.max(sourceRows.length, targetRows.length); index += 1) {
          const left = sourceRows[index] ?? {};
          const right = targetRows[index] ?? {};
          for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
            if (digest({ value: left[field] }) !== digest({ value: right[field] })) differingFields.add(field);
          }
        }
        // Describe the shape of a mismatch without logging audit payloads,
        // identifiers, tokens or business data from either database.
        throw new Error(`direct SQL oracle relation ${relationName} diverged: ${JSON.stringify({ ...comparison, sourceRows: sourceRows.length, targetRows: targetRows.length, differingFields: [...differingFields].sort() })}`);
      }
   }
   if (digest(immutableAgentSessionRows(sourceDirectSqlOracle)) !== digest(immutableAgentSessionRows(targetDirectSqlOracle))) {
     const differences = immutableAgentSessionDifferenceFields(sourceDirectSqlOracle, targetDirectSqlOracle);
     throw new Error(`direct SQL oracle agent session immutable fields diverged: ${JSON.stringify(differences)}`);
   }
   const targetOrganizations = requiredDirectSqlRelation(targetDirectSqlOracle, "organizations");
   const targetSessions = requiredDirectSqlRelation(targetDirectSqlOracle, "sessions");
   const targetSnapshots = requiredDirectSqlRelation(targetDirectSqlOracle, "cvg_state_snapshots");
   const targetEvents = requiredDirectSqlRelation(targetDirectSqlOracle, "cvg_event_journal");
    const targetAgentSessionRelation = requiredDirectSqlRelation(targetDirectSqlOracle, "agent_sessions");
    const sourceAgentLeaseRelation = requiredDirectSqlRelation(sourceDirectSqlOracle, "agent_leases");
    const targetAgentLeaseRelation = requiredDirectSqlRelation(targetDirectSqlOracle, "agent_leases");
    const sourceOrganization = requiredDirectSqlRelation(sourceDirectSqlOracle, "organizations").rows[0];
    const targetOrganization = targetOrganizations.rows[0];
    if (!sourceOrganization || !targetOrganization || targetOrganization.status !== sourceOrganization.status) throw new Error("direct SQL oracle did not preserve the destination organization identity state");
   const targetSnapshotRow = targetSnapshots.rows.at(-1);
   const targetSnapshot = targetSnapshotRow?.snapshot as { healthStatus?: unknown } | undefined;
   if (!targetSnapshotRow || String(targetSnapshotRow.revision) !== "1" || targetSnapshot?.healthStatus !== "QUARANTINED") throw new Error("direct SQL oracle did not observe revision 1 in quarantine");
   const targetRestoreEvents = targetEvents.rows.filter((row) => row.event_type === "RESTORE_QUARANTINED");
   if (targetRestoreEvents.length !== 1) throw new Error(`direct SQL oracle observed ${targetRestoreEvents.length} RESTORE_QUARANTINED events`);
   if (targetSessions.rows.some((row) => row.revoked_at === null)) throw new Error("direct SQL oracle observed an active destination authentication session");
   if (targetAgentSessionRelation.rows.some((row) => row.status !== "QUARANTINED" || row.run_state !== "QUARANTINED_RESTORE")) throw new Error("direct SQL oracle observed a non-quarantined agent session");
   if (sourceAgentLeaseRelation.count === 0 || targetAgentLeaseRelation.count !== 0) throw new Error(`direct SQL oracle lease transformation was invalid: source=${sourceAgentLeaseRelation.count} target=${targetAgentLeaseRelation.count}`);
   directSqlOracleReport = {
     source: directSqlOracleSummary(sourceDirectSqlOracle),
      target: directSqlOracleSummary(targetDirectSqlOracle),
      exactRelations,
      transformations: {
        organizationPreserved: true,
       snapshotRevision: String(targetSnapshotRow.revision),
       snapshotQuarantined: true,
       restoreEventCount: targetRestoreEvents.length,
       destinationSessionsRevoked: true,
       agentSessionsQuarantined: true,
       sourceAgentLeases: sourceAgentLeaseRelation.count,
       targetAgentLeases: targetAgentLeaseRelation.count
     }
   };
   console.log(JSON.stringify({ directSqlOracle: directSqlOracleReport }));
    const targetRestoreEvent = await targetLedgerClient.query<{ payload: { recoveredAgentRuntime?: { authority?: string }; restoreDestination?: { sessionUser?: string; currentUser?: string; tableOwner?: string; schemaOwnerCanAssumeRestore?: boolean; runtimeCanAssumeRestore?: boolean; migrationFingerprint?: string } } }>("select payload from cvg_event_journal where event_id = $1", [targetBundle.eventId]);
   const restoreDestination = targetRestoreEvent.rows[0]?.payload.restoreDestination;
    if (targetRestoreEvent.rows[0]?.payload.recoveredAgentRuntime?.authority !== "cvg_restore_authority") throw new Error("restore event did not record the dedicated agent restore authority");
   if (!restoreDestination || !restoreDestination.sessionUser || restoreDestination.sessionUser !== restoreDestination.currentUser || restoreDestination.currentUser !== restoreDestination.tableOwner || restoreDestination.schemaOwnerCanAssumeRestore !== true || restoreDestination.runtimeCanAssumeRestore !== false || restoreDestination.migrationFingerprint !== targetMigrationFingerprint) throw new Error("restore event did not record the verified destination authority and migration fingerprint");
  const targetAuditRows = await targetLedgerClient.query<{ id: string }>("select audit.id::text as id from cvg_audit_ledger as ledger join audit_records as audit on audit.id = ledger.audit_id and audit.organization_id = ledger.organization_id where ledger.organization_id = $1 order by ledger.sequence_id", [sourceOrganizationId]);
  const targetReceiptRows = await targetLedgerClient.query<{ id: string }>("select receipt.id::text as id from cvg_command_receipt_ledger as ledger join command_receipts as receipt on receipt.id = ledger.receipt_id and receipt.organization_id = ledger.organization_id where ledger.organization_id = $1 order by ledger.sequence_id", [sourceOrganizationId]);
  const targetAuditLedger = await targetLedgerClient.query<{ record_digest: string }>("select record_digest from cvg_audit_ledger where organization_id = $1 order by sequence_id", [sourceOrganizationId]);
  const targetReceiptLedger = await targetLedgerClient.query<{ record_digest: string }>("select record_digest from cvg_command_receipt_ledger where organization_id = $1 order by sequence_id", [sourceOrganizationId]);
  const sourceAuditDigests = (values: readonly unknown[]): string[] => values.map((value) => digest(value)).sort();
  if (JSON.stringify(targetAuditRows.rows.map((row: { id: string }) => row.id)) !== JSON.stringify(sourceBefore.snapshot.auditRecords.map((record) => record.id)) || JSON.stringify(targetReceiptRows.rows.map((row: { id: string }) => row.id)) !== JSON.stringify(sourceBefore.snapshot.commandReceipts.map((receipt) => receipt.id))) throw new Error("restore did not preserve the canonical audit or command receipt rows in ledger order");
  if (JSON.stringify(targetAuditLedger.rows.map((row: { record_digest: string }) => row.record_digest)) !== JSON.stringify(sourceBefore.snapshot.auditRecords.map((record) => digest(record)))) throw new Error("restore did not preserve the audit ledger records in chain order");
  if (JSON.stringify(targetReceiptLedger.rows.map((row: { record_digest: string }) => row.record_digest)) !== JSON.stringify(sourceBefore.snapshot.commandReceipts.map((receipt) => digest(receipt)))) throw new Error("restore did not preserve the command receipt ledger records in append order");
  const sortedDigests = (values: Array<{ recordDigest: string }>): string[] => values.map((value) => value.recordDigest).sort();
  if (JSON.stringify(targetBundle.snapshot.auditRecords.map((record) => digest(record))) !== JSON.stringify(sourceBefore.snapshot.auditRecords.map((record) => digest(record)))) throw new Error("restore did not preserve the audit snapshot records in order");
  if (JSON.stringify(targetBundle.snapshot.commandReceipts.map((receipt) => digest(receipt))) !== JSON.stringify(sourceBefore.snapshot.commandReceipts.map((receipt) => digest(receipt)))) throw new Error("restore did not preserve the command receipt snapshot records in order");
  if (JSON.stringify(sortedDigests(targetBundle.outboxRecords)) !== JSON.stringify(sortedDigests(sourceBefore.outboxRecords))) throw new Error("restore did not preserve the outbox recovery ledger");
  if (JSON.stringify(sortedDigests(targetBundle.usageRecords)) !== JSON.stringify(sortedDigests(sourceBefore.usageRecords))) throw new Error("restore did not preserve the usage recovery ledger");
   if (JSON.stringify(targetBundle.inboxRecords.map((record) => record.recordDigest).sort()) !== JSON.stringify(sourceBefore.inboxRecords.map((record) => record.recordDigest).sort())) throw new Error("restore did not preserve the inbox recovery ledger");
   if (JSON.stringify(targetBundle.externalEffects.map((record) => record.requestDigest).sort()) !== JSON.stringify(sourceBefore.externalEffects.map((record) => record.requestDigest).sort())) throw new Error("restore did not preserve the external effect recovery ledger");
   if (JSON.stringify((targetBundle.workerJobs ?? []).map((record) => record.recordDigest).sort()) !== JSON.stringify((sourceBefore.workerJobs ?? []).map((record) => record.recordDigest).sort())) throw new Error("restore did not preserve the worker job recovery ledger");
const sortedRecordDigests = (records: readonly { recordDigest: string }[]): string[] => records.map((record) => record.recordDigest).sort();
const firstDigestDifference = (left: string[], right: string[]): string => {
  const l = [...left].sort();
  const r = [...right].sort();
  for (let index = 0; index < Math.max(l.length, r.length); index += 1) {
    if (l[index] !== r[index]) return `left[${index}]=${l[index] ?? "missing"} right[${index}]=${r[index] ?? "missing"}`;
  }
  return "identical";
};
  // CVG-AUD19-011: agent runtime continuity, quarantine and lease policy.
  const targetAgentSessions = targetBundle.agentSessions ?? [];
  const targetAgentTurns = targetBundle.agentTurns ?? [];
  const targetAgentCheckpoints = targetBundle.agentCheckpoints ?? [];
  const targetAgentLeases = targetBundle.agentLeases ?? [];
  const agentSessionImmutable = (record: { sessionId: string; organizationId: string; actorId: string; unitId: string | null; workspaceId: string | null; purpose: string; taskObjective: string; fence: number; checkpointDigest: string | null; createdAt: string; expiresAt: string }) => JSON.stringify([record.sessionId, record.organizationId, record.actorId, record.unitId, record.workspaceId, record.purpose, record.taskObjective, record.fence, record.checkpointDigest, record.createdAt, record.expiresAt]);
  if (JSON.stringify(targetAgentSessions.map(agentSessionImmutable).sort()) !== JSON.stringify((sourceBefore.agentSessions ?? []).map(agentSessionImmutable).sort())) throw new Error("restore did not preserve the immutable agent session records");
  if (JSON.stringify(sortedRecordDigests(targetAgentTurns)) !== JSON.stringify(sortedRecordDigests(sourceBefore.agentTurns ?? []))) throw new Error(`restore did not preserve the agent turn ledger: ${firstDigestDifference(sortedRecordDigests(targetAgentTurns), sortedRecordDigests(sourceBefore.agentTurns ?? []))}`);
  if (JSON.stringify(sortedRecordDigests(targetAgentCheckpoints)) !== JSON.stringify(sortedRecordDigests(sourceBefore.agentCheckpoints ?? []))) throw new Error(`restore did not preserve the agent checkpoint ledger: ${firstDigestDifference(sortedRecordDigests(targetAgentCheckpoints), sortedRecordDigests(sourceBefore.agentCheckpoints ?? []))}`);
  if (targetAgentLeases.length !== 0) throw new Error(`restore must not revive active leases, observed ${targetAgentLeases.length}`);
  if (targetAgentSessions.some((record) => record.status !== "QUARANTINED" || record.runState !== "QUARANTINED_RESTORE")) throw new Error("restored agent sessions must be terminal-quarantined");
  const restoredSession = targetAgentSessions.find((record) => record.sessionId === agentSessionId);
  if (!restoredSession || restoredSession.fence !== 2) throw new Error(`restored agent session fence is ${restoredSession?.fence}, expected 2`);
  const targetAgentPool = new pg.Pool({ connectionString: targetUrl, max: 2, application_name: "cvg-restore-agent-verify" });
  try {
    const targetAgentStore = new PostgresAgentSessionStore(createScopedSqlExecutor({
      connect: async () => {
        const client = await targetAgentPool.connect();
        return { query: async (text: string, params: readonly unknown[]) => ({ rows: (await client.query(text, params as unknown[])).rows as Record<string, unknown>[] }), release: () => client.release() };
      }
    }));
    const scope = { organizationId: sourceOrganizationId, actorId: sourceActorId };
    const loaded = await targetAgentStore.load(agentSessionId, scope);
    if (!loaded || loaded.status !== "QUARANTINED" || loaded.runState !== "QUARANTINED_RESTORE" || loaded.fence !== 2) throw new Error("restored agent session did not load with its quarantined terminal state and fence");
    const leaseAttempt = await targetAgentStore.acquireLease({ sessionId: agentSessionId, organizationId: sourceOrganizationId, ownerId: "restore-attempt", ttlMs: 60_000 });
    if (leaseAttempt !== null) throw new Error("restored agent session accepted a lease before explicit reactivation");
    const restoredTurns = await targetAgentStore.listTurns(agentSessionId, scope);
    if (restoredTurns.length !== 2 || restoredTurns[0]?.sequence !== 1 || restoredTurns[1]?.sequence !== 2 || restoredTurns[0]?.fence !== 1 || restoredTurns[1]?.fence !== 2) throw new Error(`restored agent turns lost sequence or fence continuity: ${JSON.stringify(restoredTurns.map(({ sequence, fence }) => ({ sequence, fence })))}`);
    const restoredCheckpoint = await targetAgentStore.latestCheckpoint(agentSessionId, scope);
    if (!restoredCheckpoint || restoredCheckpoint.sequence !== 1 || restoredCheckpoint.fence !== 1) throw new Error("restored agent checkpoint lost sequence or fence continuity");
  } finally {
    await targetAgentPool.end();
  }

  runtimePersistence = new PostgresPersistence({ connectionString: targetUrl });
  runtime = await createRuntime({ config: { storageMode: "postgres", demoMode: true, databaseUrl: targetUrl, bootstrapPassword }, persistence: runtimePersistence });
  const login = await runtime.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "admin@cvg.local", password: bootstrapPassword }) });
  if (login.statusCode !== 401) throw new Error(`quarantined restore accepted login with status ${login.statusCode}`);
  const ready = await runtime.app.inject({ method: "GET", url: "/api/v1/ready" });
  if (ready.statusCode !== 503) throw new Error(`quarantined restore reported ready with status ${ready.statusCode}`);

  const sourceAfter = await sourcePersistence.exportRecoveryBundle(sourceOrganizationId);
  if (!sourceAfter || sourceAfter.revision !== sourceBefore.revision || sourceAfter.eventId !== sourceBefore.eventId || JSON.stringify(sourceAuditDigests(sourceAfter.snapshot.auditRecords)) !== JSON.stringify(sourceAuditDigests(sourceBefore.snapshot.auditRecords)) || JSON.stringify(sourceAuditDigests(sourceAfter.snapshot.commandReceipts)) !== JSON.stringify(sourceAuditDigests(sourceBefore.snapshot.commandReceipts))) throw new Error("restore drill changed the source database");
  if (JSON.stringify(sortedDigests(sourceAfter.outboxRecords)) !== JSON.stringify(sortedDigests(sourceBefore.outboxRecords)) || JSON.stringify(sortedDigests(sourceAfter.usageRecords)) !== JSON.stringify(sortedDigests(sourceBefore.usageRecords)) || JSON.stringify(sourceAfter.inboxRecords.map((record) => record.recordDigest).sort()) !== JSON.stringify(sourceBefore.inboxRecords.map((record) => record.recordDigest).sort()) || JSON.stringify(sourceAfter.externalEffects.map((record) => record.requestDigest).sort()) !== JSON.stringify(sourceBefore.externalEffects.map((record) => record.requestDigest).sort()) || JSON.stringify((sourceAfter.workerJobs ?? []).map((record) => record.recordDigest).sort()) !== JSON.stringify((sourceBefore.workerJobs ?? []).map((record) => record.recordDigest).sort()) || JSON.stringify((sourceAfter.agentSessions ?? []).map((record) => record.recordDigest).sort()) !== JSON.stringify((sourceBefore.agentSessions ?? []).map((record) => record.recordDigest).sort()) || JSON.stringify((sourceAfter.agentTurns ?? []).map((record) => record.recordDigest).sort()) !== JSON.stringify((sourceBefore.agentTurns ?? []).map((record) => record.recordDigest).sort()) || JSON.stringify((sourceAfter.agentCheckpoints ?? []).map((record) => record.recordDigest).sort()) !== JSON.stringify((sourceBefore.agentCheckpoints ?? []).map((record) => record.recordDigest).sort()) || JSON.stringify((sourceAfter.agentLeases ?? []).map((record) => record.recordDigest).sort()) !== JSON.stringify((sourceBefore.agentLeases ?? []).map((record) => record.recordDigest).sort())) throw new Error("restore drill changed the source recovery ledgers");
     console.log(JSON.stringify({ restore: "PASS", encryptedBackup: true, backupAlgorithm: encryptedBackup.algorithm, tamperRejected, rehashedEnvelopeRejected, partialRejected, staleRejected, migrationMismatchRejected, semanticKnownBad: { checkpointDigest: true, sessionCheckpointDigest: true, actorForeignKey: true, danglingUsageReference: true, zeroFenceLease: true, leaseSessionMismatch: true, terminalLease: true, invertedLeaseTimestamp: true, invalidUnitWorkspace: true, turnSequenceGap: true, checkpointSequenceGap: true, futureFence: true }, knownGoodRestore: targetCommit.revision === 1n, lateRestoreRejected, destinationAuthorityVerified: true, destinationSessionUser: restoreDestination.sessionUser, destinationCurrentUser: restoreDestination.currentUser, destinationTableOwner: restoreDestination.tableOwner, destinationSchemaOwnerCanAssumeRestore: restoreDestination.schemaOwnerCanAssumeRestore, destinationRuntimeCanAssumeRestore: restoreDestination.runtimeCanAssumeRestore, destinationMigrationFingerprint: restoreDestination.migrationFingerprint, destinationUnchangedAfterRollback: true, sourceRevision: sourceBefore.revision.toString(), targetDatabase: restoreDatabase, targetRevision: targetLatest.revision.toString(), targetStatus: targetLatest.snapshot.healthStatus, recoveredAuditRecords: targetBundle.snapshot.auditRecords.length, recoveredCommandReceipts: targetBundle.snapshot.commandReceipts.length, recoveredOutbox: targetBundle.outboxRecords.length, recoveredUsage: targetBundle.usageRecords.length, recoveredInbox: targetBundle.inboxRecords.length, recoveredExternalEffects: targetBundle.externalEffects.length, recoveredWorkerJobs: targetBundle.workerJobs?.length ?? 0, recoveredAgentSessions: targetAgentSessions.length, recoveredAgentTurns: targetAgentTurns.length, recoveredAgentCheckpoints: targetAgentCheckpoints.length, droppedAgentLeases: (sourceBefore.agentLeases ?? []).length, restoreAuthority: "cvg_restore_authority", restoredAgentFence: restoredSession.fence, agentLeaseBlocked: true, loginBlocked: true, readinessBlocked: true, sourceUnchanged: true }, null, 2));
} finally {
  if (runtime) await runtime.app.close().catch(() => undefined);
  await runtimePersistence?.close().catch(() => undefined);
   await targetPersistence?.close().catch(() => undefined);
   await targetLedgerClient?.end().catch(() => undefined);
   await sourceOracleClient?.end().catch(() => undefined);
   await sourcePersistence.close().catch(() => undefined);
  if (adminConnected) await admin.end().catch(() => undefined);
  if (created) {
    const cleanup = new Client({ connectionString: maintenanceConnectionString, connectionTimeoutMillis: 2_500 });
    try {
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${quoteIdentifier(restoreDatabase)}`);
    } finally {
      await cleanup.end().catch(() => undefined);
    }
  }
}
