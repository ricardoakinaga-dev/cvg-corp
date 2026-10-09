import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const { Client } = pg;
const execFileAsync = promisify(execFile);
const image = "postgres:16-alpine";
const root = process.cwd();

type CommandResult = {
  ok: boolean;
  code: number | string | null;
  stdout: string;
  stderr: string;
};

type FailureCode =
  | "DOCKER_UNAVAILABLE"
  | "PORT_OCCUPIED"
  | "INIT_INCOMPLETE"
  | "MIGRATION_FAILED"
  | "POSTGRES_BEHAVIOR_FAILED"
  | "ROLE_CONTRACT_FAILED"
  | "CLEANUP_FAILED"
  | "INVENTORY_CHANGED"
  | "INVENTORY_UNVERIFIED"
  | "CONTRACT_FAILED";

class EphemeralPostgresFailure extends Error {
  constructor(readonly code: FailureCode, message: string) {
    super(message);
    this.name = "EphemeralPostgresFailure";
  }
}

type Options = {
  rounds: number;
  readyTimeoutMs: number;
  port: number | null;
  runPostgres: boolean;
  runRestore: boolean;
  runAud27Migration: boolean;
  runAud27NormalizedWrites: boolean;
  runAud2724Slices: boolean;
};

type ContainerContext = {
  name: string;
  ownershipToken: string;
  containerId?: string;
  database: string;
  owner: string;
  ownerPassword: string;
  runtime: string;
  runtimePassword: string;
  restore: string;
  restorePassword: string;
  bootstrapPassword: string;
  port: number;
};

let activeContainer: ContainerContext | null = null;
let activeCleanup: Promise<void> | null = null;

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseArgs(argv: string[]): Options {
  let rounds = 2;
  let readyTimeoutMs = 30_000;
  let port: number | null = null;
  let runPostgres = false;
  let runRestore = false;
  let runAud27Migration = false;
  let runAud27NormalizedWrites = false;
  let runAud2724Slices = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) throw new Error("argument is missing");
    if (argument === "--run-postgres") {
      runPostgres = true;
      continue;
    }
    if (argument === "--run-restore") {
      runRestore = true;
      continue;
    }
    if (argument === "--run-aud27-migration") {
      runAud27Migration = true;
      continue;
    }
    if (argument === "--run-aud27-normalized-writes") {
      runAud27NormalizedWrites = true;
      continue;
    }
    if (argument === "--run-aud27-24-slices") {
      runAud2724Slices = true;
      continue;
    }
    const [name, inlineValue] = argument.includes("=") ? argument.split(/=(.*)/s, 2) : [argument, undefined];
    const value = inlineValue ?? argv[++index];
    if (name === "--rounds") rounds = parsePositiveInteger(value ?? "", "--rounds");
    else if (name === "--ready-timeout-ms") readyTimeoutMs = parsePositiveInteger(value ?? "", "--ready-timeout-ms");
    else if (name === "--port") port = parsePositiveInteger(value ?? "", "--port");
    else if (name === "--help") {
      process.stdout.write("Usage: npm run verify:ephemeral-postgres -- [--rounds=2] [--ready-timeout-ms=30000] [--port=PORT] [--run-postgres] [--run-restore] [--run-aud27-migration] [--run-aud27-normalized-writes] [--run-aud27-24-slices]\n");
      process.exit(0);
    } else throw new Error(`unknown argument ${argument}`);
  }
  if (rounds > 2) throw new Error("--rounds cannot exceed 2 for the AUD23-002 gate");
  if (port !== null && port > 65_535) throw new Error("--port must be <= 65535");
  if (runPostgres && rounds !== 1) throw new Error("--run-postgres requires --rounds=1");
  if (runRestore && rounds !== 1) throw new Error("--run-restore requires --rounds=1");
  if (runAud27Migration && rounds !== 1) throw new Error("--run-aud27-migration requires --rounds=1");
  if (runAud27NormalizedWrites && rounds !== 1) throw new Error("--run-aud27-normalized-writes requires --rounds=1");
  if (runAud2724Slices && rounds !== 1) throw new Error("--run-aud27-24-slices requires --rounds=1");
  if (runAud27NormalizedWrites && runAud2724Slices) throw new Error("--run-aud27-normalized-writes and --run-aud27-24-slices require separate disposable database runs");
  return { rounds, readyTimeoutMs, port, runPostgres, runRestore, runAud27Migration, runAud27NormalizedWrites, runAud2724Slices };
}

async function command(commandName: string, args: string[], environment: NodeJS.ProcessEnv = process.env): Promise<CommandResult> {
  try {
    const result = await execFileAsync(commandName, args, { cwd: root, env: environment, maxBuffer: 4 * 1024 * 1024 });
    return { ok: true, code: 0, stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string };
    return { ok: false, code: failure.code ?? null, stdout: String(failure.stdout ?? ""), stderr: String(failure.stderr ?? "") };
  }
}

async function docker(args: string[]): Promise<CommandResult> {
  return command("docker", args);
}

function commandDetail(result: CommandResult): string {
  const detail = `${result.stderr}\n${result.stdout}`.replace(/\s+/g, " ").trim();
  if (!detail) return `exit=${String(result.code)}`;
  if (detail.length <= 2_000) return detail;
  return `${detail.slice(0, 1_000)} … ${detail.slice(-1_000)}`;
}

function requireSuccess(result: CommandResult, code: FailureCode, label: string): string {
  if (!result.ok) throw new EphemeralPostgresFailure(code, `${label}: ${commandDetail(result)}`);
  return result.stdout;
}

async function containerInventory(): Promise<string[]> {
  const result = await docker(["ps", "-a", "--no-trunc", "--format", "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}"]);
  requireSuccess(result, "DOCKER_UNAVAILABLE", "container inventory failed");
  const rows = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
  const ids = new Set<string>();
  for (const row of rows) {
    const [id, name, imageName, ports, ...extra] = row.replace(/\r$/, "").split("\t");
    if (!id || !/^[0-9a-f]{64}$/i.test(id) || !name || !imageName || ports === undefined || extra.length > 0 || ids.has(id)) {
      throw new EphemeralPostgresFailure("CONTRACT_FAILED", `container inventory row is invalid or duplicated: ${row}`);
    }
    ids.add(id);
  }
  return rows.sort();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function connectionString(context: ContainerContext, role: "owner" | "runtime" | "restore"): string {
  const user = context[role];
  const password = context[`${role}Password`];
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${context.port}/${context.database}`;
}

function randomContext(): Omit<ContainerContext, "port"> {
  const suffix = randomBytes(8).toString("hex");
  return {
    name: `cvg-aud23-002-${suffix}`,
    ownershipToken: randomBytes(32).toString("hex"),
    database: `cvg_aud23_${suffix}`,
    owner: `cvg_aud23_owner_${suffix}`,
    ownerPassword: `owner-${randomBytes(24).toString("base64url")}`,
    runtime: "cvg_runtime",
    runtimePassword: `runtime-${randomBytes(24).toString("base64url")}`,
    restore: `cvg_aud23_restore_${suffix}`,
    restorePassword: `restore-${randomBytes(24).toString("base64url")}`,
    bootstrapPassword: `bootstrap-${randomBytes(24).toString("base64url")}`
  };
}

async function preflightDocker(): Promise<void> {
  const result = await docker(["info", "--format", "{{.ServerVersion}}"]);
  requireSuccess(result, "DOCKER_UNAVAILABLE", "Docker daemon unavailable");
  const imageResult = await docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  requireSuccess(imageResult, "DOCKER_UNAVAILABLE", `required image ${image} is unavailable`);
}

async function inspectOwnedContainer(context: ContainerContext): Promise<string | null> {
  const inspected = await docker([
    "inspect", "--format", '{{.Id}}\t{{index .Config.Labels "cvg.audit.run"}}', context.name
  ]);
  if (!inspected.ok) return null;
  const [id, ownershipToken, ...extra] = inspected.stdout.trim().split("\t");
  if (!id || !/^[0-9a-f]{64}$/i.test(id) || ownershipToken !== context.ownershipToken || extra.length > 0) return null;
  if (context.containerId && id !== context.containerId) return null;
  return id;
}

async function startContainer(
  context: Omit<ContainerContext, "port" | "containerId">,
  requestedPort: number | null,
  onStarted: (context: ContainerContext) => void
): Promise<ContainerContext> {
  const publish = requestedPort === null ? "127.0.0.1::5432" : `127.0.0.1:${requestedPort}:5432`;
  const result = await docker([
    "run", "--detach", "--name", context.name,
    "--label", "cvg.audit=CVG-AUD23-002",
    "--label", `cvg.audit.run=${context.ownershipToken}`,
    "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid,nodev",
    "--env", `POSTGRES_DB=${context.database}`,
    "--env", `POSTGRES_USER=${context.owner}`,
    "--env", `POSTGRES_PASSWORD=${context.ownerPassword}`,
    "--publish", publish,
    image
  ]);
  if (!result.ok) {
    const detail = commandDetail(result);
    if (/address already in use|port is already allocated|already allocated|bind/i.test(detail)) {
      throw new EphemeralPostgresFailure("PORT_OCCUPIED", `requested PostgreSQL port is occupied: ${detail}`);
    }
    throw new EphemeralPostgresFailure("CONTRACT_FAILED", `container start failed: ${detail}`);
  }
  const reportedId = result.stdout.trim();
  if (!/^[0-9a-f]{64}$/i.test(reportedId)) throw new EphemeralPostgresFailure("CONTRACT_FAILED", `container start returned an invalid container id: ${reportedId || "empty"}`);
  const started: ContainerContext = { ...context, containerId: reportedId, port: requestedPort ?? 0 };
  onStarted(started);
  const inspectedId = await inspectOwnedContainer(started);
  if (inspectedId !== reportedId) throw new EphemeralPostgresFailure("CONTRACT_FAILED", `container identity/ownership verification failed for ${context.name}`);
  const portResult = await docker(["port", context.name, "5432/tcp"]);
  const portText = requireSuccess(portResult, "CONTRACT_FAILED", "published port lookup failed");
  const portMatch = /:(\d+)\s*$/.exec(portText.trim().split(/\r?\n/)[0] ?? "");
  if (!portMatch) throw new EphemeralPostgresFailure("CONTRACT_FAILED", `published port is not parseable: ${portText.trim()}`);
  return { ...started, port: Number(portMatch[1]) };
}

async function waitForReady(context: ContainerContext, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = "no readiness response";
  while (Date.now() < deadline) {
    const result = await docker(["exec", context.name, "pg_isready", "--username", context.owner, "--dbname", context.database]);
    if (result.ok && /accepting connections/i.test(result.stdout)) return;
    lastDetail = commandDetail(result);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new EphemeralPostgresFailure("INIT_INCOMPLETE", `PostgreSQL initialization did not complete within ${timeoutMs}ms: ${lastDetail}`);
}

async function migrate(context: ContainerContext): Promise<void> {
  const ownerUrl = connectionString(context, "owner");
  const result = await command("npm", ["run", "db:migrate"], {
    ...process.env,
    DATABASE_URL: ownerUrl,
    MIGRATION_DATABASE_URL: ownerUrl,
    CVG_RUNTIME_DB_USER: context.runtime,
    CVG_RUNTIME_DB_PASSWORD: context.runtimePassword,
    CVG_BOOTSTRAP_PASSWORD: context.bootstrapPassword
  });
  if (!result.ok) throw new EphemeralPostgresFailure("MIGRATION_FAILED", `clean migration failed: ${commandDetail(result)}`);
}

async function runPostgresVerifier(context: ContainerContext): Promise<void> {
  const verifierEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: connectionString(context, "runtime"),
    MIGRATION_DATABASE_URL: connectionString(context, "owner"),
    ADMIN_DATABASE_URL: connectionString(context, "owner"),
    CVG_BOOTSTRAP_PASSWORD: context.bootstrapPassword
  };
  delete verifierEnvironment.CVG_RUNTIME_DB_USER;
  delete verifierEnvironment.CVG_RUNTIME_DB_PASSWORD;
  const result = await command("npm", ["run", "verify:postgres"], verifierEnvironment);
  if (!result.ok) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `real PostgreSQL behavior verifier failed: ${commandDetail(result)}`);
  const rollbackProof = "POSTGRES_RLS_FIXTURE_ROLLBACK_VERIFIED tables=3 rows_remaining=0";
  const oracleProof = "POSTGRES_RLS_ZERO_RESIDUE_ORACLE_VERIFIED present_controls_rejected=3 empty_controls_accepted=3";
  if (!result.stdout.split(/\r?\n/).includes(oracleProof)) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", "RLS residue oracle did not reject known-present fixtures under visible scopes");
  if (!result.stdout.split(/\r?\n/).includes(rollbackProof)) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", "RLS verifier did not prove rollback of its synthetic fixtures");
  process.stdout.write(`${oracleProof}\n${rollbackProof}\n`);
}

async function runRestoreVerifier(context: ContainerContext): Promise<void> {
  const verifierEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: connectionString(context, "runtime"),
    MIGRATION_DATABASE_URL: connectionString(context, "owner"),
    ADMIN_DATABASE_URL: connectionString(context, "owner"),
    CVG_RUNTIME_DB_USER: context.runtime,
    CVG_RUNTIME_DB_PASSWORD: context.runtimePassword,
    CVG_BOOTSTRAP_PASSWORD: context.bootstrapPassword
  };
  const result = await command("npm", ["run", "verify:postgres:restore"], verifierEnvironment);
  if (!result.ok) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `real PostgreSQL restore verifier failed: ${commandDetail(result)}`);
  const corpusLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('{"preconnectionCorpus":'));
  if (!corpusLine) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", "real PostgreSQL restore verifier did not emit the pre-connection corpus report");
  let corpus: Record<string, { status: string; restorePoolConnects: number; begin: number; dml: number; destinationHashBefore: string; destinationHashAfter: string }>;
  try {
    const parsed = JSON.parse(corpusLine) as { preconnectionCorpus?: typeof corpus };
    corpus = parsed.preconnectionCorpus ?? {};
  } catch (error) {
    throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `pre-connection corpus report is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const cases = Object.values(corpus);
  if (cases.length === 0 || cases.some((entry) => entry.status !== "REJECTED" || entry.restorePoolConnects !== 0 || entry.begin !== 0 || entry.dml !== 0 || entry.destinationHashBefore !== entry.destinationHashAfter)) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `pre-connection corpus violated its zero-effect contract: ${corpusLine}`);
  process.stdout.write(`RESTORE_PRECONNECTION_CORPUS cases=${cases.length} connect=0 begin=0 dml=0 destination_hash_stable=true\n`);
  const directLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('{"directSqlOracle":'));
  if (!directLine) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", "real PostgreSQL restore verifier did not emit the direct SQL oracle report");
  let direct: { exactRelations?: Record<string, { equal: boolean }>; transformations?: { organizationPreserved?: boolean; snapshotQuarantined?: boolean; destinationSessionsRevoked?: boolean; agentSessionsQuarantined?: boolean; targetAgentLeases?: number } };
  try {
    const parsed = JSON.parse(directLine) as { directSqlOracle?: typeof direct };
    direct = parsed.directSqlOracle ?? {};
  } catch (error) {
    throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `direct SQL oracle report is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const exactRelations = Object.values(direct.exactRelations ?? {});
  const transformations = direct.transformations;
  if (exactRelations.length === 0 || exactRelations.some((relation) => relation.equal !== true) || transformations?.organizationPreserved !== true || transformations.snapshotQuarantined !== true || transformations.destinationSessionsRevoked !== true || transformations.agentSessionsQuarantined !== true || transformations.targetAgentLeases !== 0) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `direct SQL oracle violated its recovery contract: ${directLine}`);
  process.stdout.write(`DIRECT_SQL_ORACLE relations=${exactRelations.length} exact_matches=${exactRelations.length} organization_preserved=true snapshot_quarantined=true sessions_revoked=true agent_sessions_quarantined=true target_leases=0\n`);
}

async function runAud27MigrationVerifier(context: ContainerContext): Promise<void> {
  const result = await command("npm", ["run", "verify:aud27-postgres-migration"], {
    ...process.env,
    CVG_AUD27_POSTGRES_URL: connectionString(context, "owner")
  });
  if (!result.ok) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `AUD27 durable migration verifier failed: ${commandDetail(result)}`);
  const cleanupLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("AUD27_POSTGRES_MIGRATION_CLEANUP "));
  const cleanup = cleanupLine?.match(/\brecords=(\d+)\s+checkpoints=(\d+)\s+owned_runs=(\d+)\b/);
  if (!cleanup || Number(cleanup[1]) === 0 || Number(cleanup[2]) === 0 || Number(cleanup[3]) !== 5) {
    throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `AUD27 migration verifier did not prove scoped cleanup of its five owned runs: ${cleanupLine ?? "cleanup receipt missing"}`);
  }
  process.stdout.write(`AUD27_MIGRATION_CLEANUP_VERIFIED records=${cleanup[1]} checkpoints=${cleanup[2]} owned_runs=${cleanup[3]}\n`);
}

async function runAud27NormalizedWritesVerifier(context: ContainerContext): Promise<void> {
  const result = await command("npm", ["run", "verify:aud27-normalized-writes"], {
    ...process.env,
    CVG_AUD27_NORMALIZED_WRITES_URL: connectionString(context, "owner")
  });
  if (!result.ok) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `AUD27 normalized-write verifier failed: ${commandDetail(result)}`);
}

async function runAud2724SlicesVerifier(context: ContainerContext): Promise<void> {
  const result = await command("npm", ["run", "verify:aud27-24-slices"], {
    ...process.env,
    CVG_AUD27_24_SLICES_URL: connectionString(context, "owner")
  });
  if (!result.ok) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", `AUD27 24-slice verifier failed: ${commandDetail(result)}`);
  const verificationLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("AUD27_24_SLICES_VERIFIED "));
  if (!verificationLine) throw new EphemeralPostgresFailure("POSTGRES_BEHAVIOR_FAILED", "AUD27 24-slice verifier completed without its structured verification line");
  process.stdout.write(`${verificationLine}\n`);
}

async function provisionRestoreRole(context: ContainerContext): Promise<void> {
  const client = new Client({ connectionString: connectionString(context, "owner"), connectionTimeoutMillis: 2_500 });
  try {
    await client.connect();
    await client.query(`create role ${quoteIdentifier(context.restore)} login password ${quoteLiteral(context.restorePassword)} noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
    await client.query(`grant connect on database ${quoteIdentifier(context.database)} to ${quoteIdentifier(context.restore)}`);
    await client.query(`grant usage on schema public to ${quoteIdentifier(context.restore)}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function verifyRoles(context: ContainerContext): Promise<{ migrationCount: number; postgresMajor: string }> {
  const owner = new Client({ connectionString: connectionString(context, "owner"), connectionTimeoutMillis: 2_500 });
  try {
    await owner.connect();
    const server = await owner.query<{ version: string }>("select current_setting('server_version') as version");
    const migration = await owner.query<{ count: number }>("select count(*)::int as count from public.schema_migrations");
    const roles = await owner.query<{ rolname: string; rolsuper: boolean; rolinherit: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolcanlogin: boolean; rolbypassrls: boolean; rolreplication: boolean }>(
      "select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls, rolreplication from pg_roles where rolname = any($1::text[]) order by rolname",
      [[context.owner, context.runtime, context.restore, "cvg_restore_authority"]]
    );
    const byName = new Map(roles.rows.map((role) => [role.rolname, role]));
    const ownerRole = byName.get(context.owner);
    const runtimeRole = byName.get(context.runtime);
    const restoreRole = byName.get(context.restore);
    const restoreAuthorityRole = byName.get("cvg_restore_authority");
    if (!ownerRole || !runtimeRole || !restoreRole || !restoreAuthorityRole) throw new EphemeralPostgresFailure("ROLE_CONTRACT_FAILED", `schema-owner, runtime, restore-login and restore-authority roles were not all provisioned; found=${roles.rows.map((role) => role.rolname).join(",")}`);
    if (!ownerRole.rolsuper || !runtimeRole.rolcanlogin || !restoreRole.rolcanlogin) throw new EphemeralPostgresFailure("ROLE_CONTRACT_FAILED", "owner/runtime/restore login contract is incomplete");
    for (const role of [runtimeRole, restoreRole]) {
      if (role.rolsuper || role.rolinherit || role.rolcreaterole || role.rolcreatedb || role.rolbypassrls || role.rolreplication) throw new EphemeralPostgresFailure("ROLE_CONTRACT_FAILED", `restricted role ${role.rolname} has excessive attributes`);
    }
    if (restoreAuthorityRole.rolsuper || restoreAuthorityRole.rolinherit || restoreAuthorityRole.rolcreaterole || restoreAuthorityRole.rolcreatedb || restoreAuthorityRole.rolcanlogin || restoreAuthorityRole.rolbypassrls || restoreAuthorityRole.rolreplication) throw new EphemeralPostgresFailure("ROLE_CONTRACT_FAILED", "dedicated restore authority role contract is not least privilege");
    const postgresMajor = server.rows[0]?.version.split(".")[0] ?? "";
    if (postgresMajor !== "16") throw new EphemeralPostgresFailure("ROLE_CONTRACT_FAILED", `expected PostgreSQL 16, observed ${server.rows[0]?.version ?? "unknown"}`);

    const runtime = new Client({ connectionString: connectionString(context, "runtime"), connectionTimeoutMillis: 2_500 });
    const restore = new Client({ connectionString: connectionString(context, "restore"), connectionTimeoutMillis: 2_500 });
    try {
      await runtime.connect();
      await restore.connect();
      const runtimeIdentity = await runtime.query<{ current_user: string }>("select current_user");
      const restoreIdentity = await restore.query<{ current_user: string }>("select current_user");
      if (runtimeIdentity.rows[0]?.current_user !== context.runtime || restoreIdentity.rows[0]?.current_user !== context.restore) throw new EphemeralPostgresFailure("ROLE_CONTRACT_FAILED", "runtime/restore credentials did not resolve to their dedicated roles");
    } finally {
      await runtime.end().catch(() => undefined);
      await restore.end().catch(() => undefined);
    }
    return { migrationCount: migration.rows[0]?.count ?? 0, postgresMajor };
  } finally {
    await owner.end().catch(() => undefined);
  }
}

async function removeContainer(context: ContainerContext | null): Promise<void> {
  if (!context) return;
  const containerId = await inspectOwnedContainer(context);
  if (!containerId) return;
  const remove = await docker(["rm", "--force", containerId]);
  if (!remove.ok) throw new EphemeralPostgresFailure("CLEANUP_FAILED", `container removal failed for owned id ${containerId}: ${commandDetail(remove)}`);
  const remains = await inspectOwnedContainer({ ...context, containerId });
  if (remains) throw new EphemeralPostgresFailure("CLEANUP_FAILED", `owned container ${containerId} remained after forced removal`);
}

function cleanupActiveContainer(): Promise<void> {
  if (!activeContainer) return Promise.resolve();
  if (activeCleanup) return activeCleanup;
  const target = activeContainer;
  activeCleanup = removeContainer(target).then(() => {
    if (activeContainer?.ownershipToken === target.ownershipToken) activeContainer = null;
  }).finally(() => { activeCleanup = null; });
  return activeCleanup;
}

async function runRound(round: number, options: Options): Promise<{ round: number; port: number; migrations: number; postgresBehavior: "PASS" | "NOT_RUN"; restoreBehavior: "PASS" | "NOT_RUN"; aud27Migration: "PASS" | "NOT_RUN"; aud27NormalizedWrites: "PASS" | "NOT_RUN"; aud2724Slices: "PASS" | "NOT_RUN"; inventoryUnchanged: true }> {
  const before = await containerInventory();
  const requested = randomContext();
  let active: ContainerContext | null = { ...requested, port: options.port ?? 0 };
  activeContainer = active;
  let primaryError: unknown = null;
  let result: { round: number; port: number; migrations: number; postgresBehavior: "PASS" | "NOT_RUN"; restoreBehavior: "PASS" | "NOT_RUN"; aud27Migration: "PASS" | "NOT_RUN"; aud27NormalizedWrites: "PASS" | "NOT_RUN"; aud2724Slices: "PASS" | "NOT_RUN"; inventoryUnchanged: true } | null = null;
  try {
    active = await startContainer(requested, options.port, (started) => {
      active = started;
      activeContainer = started;
    });
    activeContainer = active;
    await waitForReady(active, options.readyTimeoutMs);
    await migrate(active);
    await provisionRestoreRole(active);
    const verified = await verifyRoles(active);
    if (options.runPostgres) await runPostgresVerifier(active);
    if (options.runRestore) {
      if (!options.runPostgres) await runPostgresVerifier(active);
      await runRestoreVerifier(active);
    }
    if (options.runAud27Migration) await runAud27MigrationVerifier(active);
    if (options.runAud27NormalizedWrites) await runAud27NormalizedWritesVerifier(active);
    if (options.runAud2724Slices) await runAud2724SlicesVerifier(active);
    result = { round, port: active.port, migrations: verified.migrationCount, postgresBehavior: options.runPostgres || options.runRestore ? "PASS" : "NOT_RUN", restoreBehavior: options.runRestore ? "PASS" : "NOT_RUN", aud27Migration: options.runAud27Migration ? "PASS" : "NOT_RUN", aud27NormalizedWrites: options.runAud27NormalizedWrites ? "PASS" : "NOT_RUN", aud2724Slices: options.runAud2724Slices ? "PASS" : "NOT_RUN", inventoryUnchanged: true };
  } catch (error) {
    primaryError = error;
  }
  let cleanupError: unknown = null;
  let inventoryError: unknown = null;
  try {
    await cleanupActiveContainer();
  } catch (error) {
    cleanupError = error;
  }
  try {
    const after = await containerInventory();
    if (before.join("\n") !== after.join("\n")) throw new EphemeralPostgresFailure("INVENTORY_CHANGED", `container inventory changed during round ${round}`);
  } catch (error) {
    inventoryError = error;
  }
  if (cleanupError) {
    const details = [
      primaryError ? `primary: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}` : "",
      `cleanup: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      inventoryError ? `after-inventory: ${inventoryError instanceof Error ? inventoryError.message : String(inventoryError)}` : ""
    ].filter(Boolean).join("; ");
    throw new EphemeralPostgresFailure("CLEANUP_FAILED", details);
  }
  if (inventoryError) {
    const changed = inventoryError instanceof EphemeralPostgresFailure && inventoryError.code === "INVENTORY_CHANGED";
    const code = changed ? "INVENTORY_CHANGED" : "INVENTORY_UNVERIFIED";
    const details = [
      primaryError ? `primary: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}` : "",
      `after-inventory: ${inventoryError instanceof Error ? inventoryError.message : String(inventoryError)}`
    ].filter(Boolean).join("; ");
    throw new EphemeralPostgresFailure(code, details);
  }
  if (primaryError) throw primaryError;
  if (!result) throw new EphemeralPostgresFailure("CONTRACT_FAILED", `round ${round} completed without a result`);
  return result;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await preflightDocker();
  const reports: Array<{ round: number; port: number; migrations: number; postgresBehavior: "PASS" | "NOT_RUN"; restoreBehavior: "PASS" | "NOT_RUN"; aud27Migration: "PASS" | "NOT_RUN"; aud27NormalizedWrites: "PASS" | "NOT_RUN"; aud2724Slices: "PASS" | "NOT_RUN"; inventoryUnchanged: true }> = [];
  for (let round = 1; round <= options.rounds; round += 1) reports.push(await runRound(round, options));
  process.stdout.write(`EPHEMERAL_POSTGRES_VERIFIED image=${image} rounds=${reports.length} ${reports.map((report) => `round${report.round}:port=${report.port},migrations=${report.migrations},postgres_behavior=${report.postgresBehavior},restore_behavior=${report.restoreBehavior},aud27_migration=${report.aud27Migration},aud27_normalized_writes=${report.aud27NormalizedWrites},aud27_24_slices=${report.aud2724Slices},inventory_unchanged=${report.inventoryUnchanged}`).join(" ")} database_removed=true credentials=synthetic\n`);
}

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => {
    void cleanupActiveContainer().then(
      () => process.exit(exitCode),
      (error: unknown) => {
        process.stderr.write(`EPHEMERAL_POSTGRES_FAILED code=CLEANUP_FAILED message=${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
      }
    );
  });
}

void main().catch((error: unknown) => {
  const code = error instanceof EphemeralPostgresFailure ? error.code : "CONTRACT_FAILED";
  process.stderr.write(`EPHEMERAL_POSTGRES_FAILED code=${code} message=${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
