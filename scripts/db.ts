import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://127.0.0.1:5440/cvg_m1_synthetic";
const command = process.argv[2] ?? "check";
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2_500 });

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runtimeRole(): { user: string; password: string } | null {
  const user = (process.env.CVG_RUNTIME_DB_USER ?? "cvg_runtime").trim();
  const password = process.env.CVG_RUNTIME_DB_PASSWORD;
  if (!password) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(user) || password.length < 16 || password.length > 256) throw new Error("CVG_RUNTIME_DB_USER/PASSWORD must define a bounded runtime credential");
  return { user, password };
}

async function provisionRuntimeRole(): Promise<void> {
  const configured = runtimeRole();
  if (!configured) return;
  const identifier = quoteIdentifier(configured.user);
  const password = quoteLiteral(configured.password);
  const exists = await client.query<{ exists: boolean }>("select exists (select 1 from pg_roles where rolname = $1) as exists", [configured.user]);
  if (!exists.rows[0]?.exists) await client.query(`create role ${identifier} login password ${password} noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
  else await client.query(`alter role ${identifier} login password ${password} noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
  const database = (await client.query<{ database: string }>("select current_database() as database")).rows[0]?.database;
  if (!database) throw new Error("database name is unavailable while provisioning the runtime role");
  await client.query(`grant connect on database ${quoteIdentifier(database)} to ${identifier}`);
  await client.query(`grant usage on schema public to ${identifier}`);
  // Table/sequence grants are owned by the migrations themselves (022 grants
  // the runtime DML; 040 revokes the excess).  Re-granting here would silently
  // widen least privilege on every migrate run (CVG-AUD19-012).
  await client.query(`revoke insert, update, delete on table public.schema_migrations from ${identifier}`);
  await client.query(`grant select on table public.schema_migrations to ${identifier}`);
  await client.query(`revoke create on schema public from ${identifier}`);
  process.stdout.write(`provisioned non-superuser runtime role ${configured.user}\n`);
}

try {
  await client.connect();
  if (command === "check") {
    const result = await client.query<{ version: string; database: string }>("select version(), current_database() as database");
    process.stdout.write(JSON.stringify({ connected: true, database: result.rows[0]?.database, version: result.rows[0]?.version }, null, 2) + "\n");
  } else if (command === "migrate") {
    // One session owns schema creation, role provisioning and the complete
    // migration sequence. The lock survives each migration's COMMIT and is
    // released by client.end() even after SQL failure or process termination.
    // Bound competing startup attempts without changing their DDL timeouts.
    await client.query("set lock_timeout = '30s'");
    await client.query("select pg_advisory_lock(hashtext('cvg-corp.schema-migrations'))");
    await client.query("reset lock_timeout");
    await client.query("create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now(), checksum text not null)");
    await provisionRuntimeRole();
    const files = (await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const existing = await client.query<{ checksum: string }>("select checksum from schema_migrations where version = $1", [version]);
      const sql = await readFile(join("db/migrations", file), "utf8");
      const checksum = (await import("node:crypto")).createHash("sha256").update(sql).digest("hex");
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`migration checksum changed: ${file}`);
        continue;
      }
      await client.query("begin");
      try { await client.query(sql); await client.query("insert into schema_migrations(version, checksum) values ($1, $2)", [version, checksum]); await client.query("commit"); }
      catch (error) { await client.query("rollback"); throw error; }
      process.stdout.write(`applied ${file}\n`);
    }
    await provisionRuntimeRole();
  } else throw new Error(`unknown db command: ${command}`);
} catch (error) {
  process.stderr.write(`database ${command} unavailable or failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally { await client.end().catch(() => undefined); }
