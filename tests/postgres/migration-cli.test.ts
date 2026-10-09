import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import pg from "pg";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const syntheticGate = 74109101;
type Result = { code: number | null; signal: string | null; output: string };

// Explicit Docker gate, separate from npm test: real CLI processes, real
// PostgreSQL, synthetic credentials and disposable resources owned by this test.
test("migration CLI serializes writers and preserves recovery on real PostgreSQL", { timeout: 120_000 }, async (t) => {
  const owner = randomBytes(12).toString("hex");
  const name = `cvg-migration-cli-${owner}`;
  const directory = await mkdtemp(join(tmpdir(), "cvg-migration-cli-"));
  const migrations = join(directory, "db/migrations");
  const children = new Set<ChildProcess>();
  const completions: Promise<Result>[] = [];
  const owned: { containerId?: string } = {};
  let control: pg.Client | undefined;
  const docker = async (...args: string[]): Promise<string> => (await execute("docker", args, { timeout: 30_000, maxBuffer: 2_000_000 })).stdout.trim();
  t.after(async () => {
    await control?.end();
    for (const child of children) child.kill("SIGKILL");
    await Promise.allSettled(completions);
    if (owned.containerId) {
      const identity = JSON.parse(await docker("inspect", "--format", "{{json .Config.Labels}}", owned.containerId)) as Record<string, string>;
      assert.equal(identity["cvg.migration-cli.owner"], owner);
      await docker("rm", "--force", "--volumes", owned.containerId);
    }
    await rm(directory, { recursive: true, force: true });
    process.stdout.write("MIGRATION_CLI_CLEANUP owned_container_removed=true synthetic_directory_removed=true\n");
  });

  await mkdir(join(directory, "db"));
  await cp(join(root, "db/migrations"), migrations, { recursive: true });
  const migrationFiles = (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort();
  const password = randomBytes(24).toString("hex");
  owned.containerId = await docker("run", "--detach", "--pull=never", "--name", name,
    "--label", `cvg.migration-cli.owner=${owner}`, "--publish", "127.0.0.1::5432",
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=384m", "--env", "POSTGRES_USER=cvg_migration_test",
    "--env", `POSTGRES_PASSWORD=${password}`, "--env", "POSTGRES_DB=cvg_migration_test", "postgres:16-alpine");
  const ports = JSON.parse(await docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", owned.containerId)) as Record<string, Array<{ HostIp: string; HostPort: string }>>;
  const binding = ports["5432/tcp"]?.[0];
  assert.equal(binding?.HostIp, "127.0.0.1");
  const databaseUrl = `postgresql://cvg_migration_test:${password}@127.0.0.1:${binding!.HostPort}/cvg_migration_test`;
  const readyBy = Date.now() + 20_000;
  while (true) {
    const candidate = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 500 });
    try { await candidate.connect(); control = candidate; break; }
    catch (error) { await candidate.end().catch(() => undefined); if (Date.now() >= readyBy) throw error; await delay(100); }
  }
  const database = control;
  const runtimePassword = randomBytes(24).toString("hex");
  let sequence = 0;
  const launch = () => {
    const application = `cvg_cli_${owner}_${++sequence}`;
    // Do not inherit destination credentials, PGOPTIONS or provider settings.
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), join(root, "scripts/db.ts"), "migrate"], {
      cwd: directory, env: { PATH: process.env.PATH, NODE_ENV: "test", DATABASE_URL: databaseUrl,
        PGAPPNAME: application, CVG_RUNTIME_DB_USER: "cvg_runtime", CVG_RUNTIME_DB_PASSWORD: runtimePassword },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.add(child);
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    const result = new Promise<Result>((resolveResult, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => { children.delete(child); resolveResult({ code, signal, output }); });
    });
    completions.push(result);
    return { child, application, result };
  };
  const waitForAdvisory = async (application: string): Promise<void> => {
    const deadline = Date.now() + 8_000;
    while (true) {
      const observed = await database.query("select 1 from pg_stat_activity where application_name = $1 and wait_event = 'advisory'", [application]);
      if (observed.rowCount === 1) return;
      assert.ok(Date.now() < deadline, "CLI did not reach the controlled advisory-lock boundary");
      await delay(25);
    }
  };
  const success = (result: Result): void => { assert.equal(result.code, 0, result.output); };
  let nextVersion = Math.max(...migrationFiles.map((file) => Number(file.slice(0, 3)))) + 1;
  const addMigration = async (label: string, sql: string): Promise<string> => {
    const version = `${String(nextVersion++).padStart(3, "0")}_cli_${label}`;
    await writeFile(join(migrations, `${version}.sql`), sql);
    return version;
  };

  await t.test("fresh database applies all repository migrations and replay applies none", async () => {
    success(await launch().result);
    assert.equal((await database.query("select count(*)::int as count from schema_migrations")).rows[0].count, migrationFiles.length);
    const replay = await launch().result;
    success(replay);
    assert.doesNotMatch(replay.output, /^applied /m);
  });

  await t.test("concurrent CLI processes apply a pending migration exactly once", async () => {
    const version = await addMigration("concurrency", `select pg_advisory_xact_lock(${syntheticGate}); create table cvg_cli_probe (id integer primary key); insert into cvg_cli_probe values (1);`);
    await database.query("select pg_advisory_lock($1)", [syntheticGate]);
    const first = launch();
    await waitForAdvisory(first.application);
    const second = launch();
    await waitForAdvisory(second.application);
    await database.query("select pg_advisory_unlock($1)", [syntheticGate]);
    const results = await Promise.all([first.result, second.result]);
    for (const result of results) success(result);
    assert.equal((await database.query("select count(*)::int as count from schema_migrations where version = $1", [version])).rows[0].count, 1);
    assert.deepEqual((await database.query("select id from cvg_cli_probe")).rows, [{ id: 1 }]);
  });

  await t.test("failed SQL rolls back schema and receipt, then retry succeeds", async () => {
    const version = await addMigration("rollback", "create table cvg_cli_rollback (id integer); select 1 / 0;");
    const failed = await launch().result;
    assert.equal(failed.code, 1);
    assert.match(failed.output, /division by zero/);
    assert.equal((await database.query("select to_regclass('public.cvg_cli_rollback') as relation")).rows[0].relation, null);
    assert.equal((await database.query("select count(*)::int as count from schema_migrations where version = $1", [version])).rows[0].count, 0);
    await writeFile(join(migrations, `${version}.sql`), "create table cvg_cli_rollback (id integer); insert into cvg_cli_rollback values (1);");
    success(await launch().result);
    assert.equal((await database.query("select count(*)::int as count from cvg_cli_rollback")).rows[0].count, 1);
  });

  await t.test("checksum drift is rejected without changing migration receipts", async () => {
    const file = join(migrations, migrationFiles[0]!);
    const original = await readFile(file);
    const receipts = async () => createHash("sha256").update(JSON.stringify((await database.query("select * from schema_migrations order by version")).rows)).digest("hex");
    const before = await receipts();
    await writeFile(file, Buffer.concat([original, Buffer.from("\n-- synthetic checksum drift\n")]));
    const failed = await launch().result;
    assert.equal(failed.code, 1);
    assert.match(failed.output, /migration checksum changed/);
    assert.equal(await receipts(), before);
    await writeFile(file, original);
    success(await launch().result);
  });

  await t.test("terminated lock owner releases authority and the waiting CLI recovers", async () => {
    await addMigration("crash", `select pg_advisory_xact_lock(${syntheticGate}); insert into cvg_cli_probe values (2);`);
    await database.query("select pg_advisory_lock($1)", [syntheticGate]);
    const first = launch();
    await waitForAdvisory(first.application);
    const second = launch();
    await waitForAdvisory(second.application);
    first.child.kill("SIGKILL");
    assert.notEqual((await first.result).code, 0);
    await database.query("select pg_advisory_unlock($1)", [syntheticGate]);
    success(await second.result);
    assert.deepEqual((await database.query("select id from cvg_cli_probe order by id")).rows, [{ id: 1 }, { id: 2 }]);
  });

  await t.test("lock contention times out before mutation and a later retry succeeds", async () => {
    const version = await addMigration("timeout", "insert into cvg_cli_probe values (3);");
    await database.query("select pg_advisory_lock(hashtext('cvg-corp.schema-migrations'))");
    const waiting = launch();
    const started = Date.now();
    await waitForAdvisory(waiting.application);
    const failed = await waiting.result;
    assert.equal(failed.code, 1);
    assert.match(failed.output, /lock timeout/);
    assert.ok(Date.now() - started < 45_000, "migration lock wait was not bounded");
    assert.equal((await database.query("select count(*)::int as count from schema_migrations where version = $1", [version])).rows[0].count, 0);
    await database.query("select pg_advisory_unlock(hashtext('cvg-corp.schema-migrations'))");
    success(await launch().result);
    assert.deepEqual((await database.query("select id from cvg_cli_probe order by id")).rows, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  });
});
