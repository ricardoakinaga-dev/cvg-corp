import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import pg from "pg";
import { PostgresAgentSessionStore, createScopedSqlExecutor } from "@cvg/agent-session";
import { PostgresPersistence } from "@cvg/persistence";

/**
 * CVG-AUD21-002: prove that readiness rejects databases stopped before the
 * terminal lease/restore-authority migrations (042 and 043), and accepts a
 * complete 048 database that also executes a durable agent-session smoke.
 * Uses five disposable databases and drops them at the end. Requires
 * DATABASE_URL (runtime role), MIGRATION_DATABASE_URL (schema owner) and
 * ADMIN_DATABASE_URL (maintenance connection).
 */

const runtimeUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.MIGRATION_DATABASE_URL;
const adminUrl = process.env.ADMIN_DATABASE_URL ?? migrationUrl;
if (!runtimeUrl || !migrationUrl || !adminUrl) {
  process.stderr.write("POSTGRES_SCHEMA_GATES_BLOCKED_EXTERNAL DATABASE_URL, MIGRATION_DATABASE_URL and ADMIN_DATABASE_URL are required\n");
  process.exit(2);
}
const runtimePassword = process.env.CVG_RUNTIME_DB_PASSWORD;
if (!runtimePassword) {
  process.stderr.write("POSTGRES_SCHEMA_GATES_BLOCKED_EXTERNAL CVG_RUNTIME_DB_PASSWORD is required\n");
  process.exit(2);
}

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

const runtimeUser = new URL(runtimeUrl).username;
// CVG-AUD21-002: the gate exercises 042, 043, 044 and current 045, so a
// database stopped before terminal lease invalidation and the dedicated
// restore authority can never be accepted.
const targets = [
  { name: "042", target: "042_restore_authority_and_terminal_guards", mode: "CLEAN" },
  { name: "043", target: "043_runtime_default_privileges_minimal", mode: "CLEAN" },
  { name: "044", target: "044_agent_restore_authority_and_lease_terminality", mode: "CLEAN" },
  { name: "045", target: "045_restore_role_contract_no_replication", mode: "CLEAN" },
  { name: "046", target: "046_runtime_sequence_least_privilege", mode: "CLEAN" },
  { name: "047", target: "047_aud27_migration_protocol", mode: "CLEAN" },
  { name: "048", target: "048_aud27_migration_rls", mode: "CLEAN" },
  { name: "upgrade_048", target: "048_aud27_migration_rls", mode: "UPGRADE" }
] as const;

const files = (await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).sort();
const admin = new pg.Client({ connectionString: adminUrl });

async function applyThrough(client: pg.Client, target: string): Promise<void> {
  await client.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now(), checksum text not null)");
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (version > target) break;
    const sql = await readFile(join("db/migrations", file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await client.query<{ checksum: string }>("select checksum from schema_migrations where version = $1", [version]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`migration checksum changed: ${file}`);
      continue;
    }
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

const results: Record<string, unknown> = {};
try {
  await admin.connect();
  for (const target of targets) {
    const name = `cvg_schema_gate_${target.name}`;
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    const schemaOwner = new pg.Client({ connectionString: withDatabase(migrationUrl, name) });
    await schemaOwner.connect();
    try {
      if (target.mode === "UPGRADE") await applyThrough(schemaOwner, "046_runtime_sequence_least_privilege");
      await applyThrough(schemaOwner, target.target);
      await schemaOwner.query(`grant connect on database ${name} to ${runtimeUser}`);
      await schemaOwner.query(`grant usage on schema public to ${runtimeUser}`);
      await schemaOwner.query(`revoke insert, update, delete on table public.schema_migrations from ${runtimeUser}`);
      await schemaOwner.query(`grant select on table public.schema_migrations to ${runtimeUser}`);
      await schemaOwner.query(`revoke create on schema public from ${runtimeUser}`);
    } finally {
      await schemaOwner.end();
    }

    const runtimePool = new pg.Pool({ connectionString: withDatabase(runtimeUrl, name), max: 3, application_name: "cvg-schema-gate-runtime" });
    // The admin connection drops the N-2/N-1 database after the verdict. A
    // pool left idle during that deliberate teardown reports 57P01; handle it
    // as connection teardown and close the pool before DROP DATABASE.
    runtimePool.on("error", () => undefined);
    const persistence = new PostgresPersistence({ connectionString: withDatabase(runtimeUrl, name), pool: runtimePool });
    let schemaAccepted = false;
    let reason = "";
    try {
      await persistence.assertSchema();
      schemaAccepted = true;
    } catch (error) {
      reason = error instanceof Error ? error.name : typeof error;
    } finally {
      await persistence.close();
      await runtimePool.end();
    }

    const expected = target.target === "048_aud27_migration_rls";
    if (schemaAccepted !== expected) throw new Error(`schema gate ${target.name}: expected accepted=${expected}, observed accepted=${schemaAccepted} (${reason})`);

    if (expected) {
      // Minimal synthetic identity so the durable session smoke satisfies its
      // foreign keys inside the disposable database.
      const seed = new pg.Client({ connectionString: withDatabase(migrationUrl, name) });
      await seed.connect();
      try {
        await seed.query("insert into organizations(id, name, slug, status, authorization_revision) values ($1, 'Schema Gate', 'schema-gate', 'ACTIVE', 1)", ["00000000-0000-4000-8000-000000000010"]);
        await seed.query("insert into users(id, organization_id, login, display_name, email, status, password_digest, password_changed_at) values ($1, $2, 'schema-gate@example.test', 'Schema Gate', 'schema-gate@example.test', 'ACTIVE', 'scrypt$synthetic$synthetic', now())", ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000010"]);
      } finally {
        await seed.end();
      }
      const pool = new pg.Pool({ connectionString: withDatabase(runtimeUrl, name), max: 3, application_name: "cvg-schema-gate-smoke" });
      try {
        const store = new PostgresAgentSessionStore(createScopedSqlExecutor({
          connect: async () => {
            const client = await pool.connect();
            return { query: async (text: string, params: readonly unknown[]) => ({ rows: (await client.query(text, params as unknown[])).rows as Record<string, unknown>[] }), release: () => client.release() };
          }
        }));
        const organizationId = "00000000-0000-4000-8000-000000000010";
        const actorId = "00000000-0000-4000-8000-000000000001";
        const sessionId = randomUUID();
        await store.create({ sessionId, organizationId, actorId, unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "schema-gate-smoke", ttlMs: 120_000 });
        const lease = await store.acquireLease({ sessionId, organizationId, ownerId: "schema-gate", ttlMs: 120_000 });
        if (!lease) throw new Error("durable agent session smoke could not acquire a lease");
        await store.checkpoint({ sessionId, organizationId, fence: lease.fence, payload: { smoke: true } });
        await store.appendTurn({ turnId: randomUUID(), sessionId, organizationId, sequence: 0, status: "COMPLETED", inputDigest: "a".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: { provider: "schema-gate" }, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), fence: lease.fence });
        const latest = await store.latestCheckpoint(sessionId, { organizationId, actorId });
        const turns = await store.listTurns(sessionId, { organizationId, actorId });
        if (!latest || turns.length !== 1) throw new Error("durable agent session smoke did not round-trip");
        await store.complete({ sessionId, organizationId, fence: lease.fence, runState: "COMPLETED" });
        await store.releaseLease({ sessionId, organizationId, ownerId: lease.ownerId, fence: lease.fence });
        results[target.name] = { accepted: true, mode: target.mode, durableSmoke: "PASS" };
      } finally {
        await pool.end();
      }
    } else {
      results[target.name] = { accepted: false, mode: target.mode, rejectedWith: reason };
    }
    await admin.query(`drop database if exists ${name} with (force)`);
  }
  process.stdout.write(`POSTGRES_SCHEMA_GATES_VERIFIED ${JSON.stringify(results)}\n`);
} catch (error) {
  process.stderr.write(`POSTGRES_SCHEMA_GATES_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await admin.end().catch(() => undefined);
}
