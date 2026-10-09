import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client, Pool } from "pg";
import type { Product } from "@cvg/contracts";
import { makeId } from "@cvg/domain";
import {
  Aud27MigrationError,
  Aud27MigrationExecutor,
  PostgresAud27MigrationCheckpointStore,
  PostgresAud27MigrationRunScope,
  PostgresAud27ProductsBackfillAdapter,
  productsBackfillRecords,
  type Aud27MigrationAdapter,
  type Aud27MigrationBatchContext,
  type Aud27MigrationBatchEffect
} from "@cvg/persistence";

const DATABASE_PREFIX = "cvg_aud27_products_backfill_";
const PROBE_TABLE = "cvg_aud27_products_backfill_dml_probe";
const PROBE_FUNCTION = "cvg_aud27_products_backfill_capture_dml";
const PROBE_TRIGGER = "cvg_aud27_products_backfill_capture";
const CRASH_MARKER = "AUD27_PRODUCTS_BACKFILL_CRASH_WINDOW_TARGET_COMMITTED";
const CRASH_CHILD_FLAG = "--products-crash-window-child";

type DedicatedConnection = { connectionString: string; database: string };
type ChildExit = { code: number | null; signal: NodeJS.Signals | null };

export function parseDedicatedProductsBackfillUrl(value: string | undefined): DedicatedConnection {
  const connectionString = value?.trim() ?? "";
  if (!connectionString) {
    throw new Error("provide CVG_AUD27_PRODUCTS_BACKFILL_URL explicitly; no database was contacted");
  }
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("CVG_AUD27_PRODUCTS_BACKFILL_URL is not a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("CVG_AUD27_PRODUCTS_BACKFILL_URL must use the PostgreSQL protocol");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("CVG_AUD27_PRODUCTS_BACKFILL_URL must not contain query or fragment overrides");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("products backfill verifier accepts loopback PostgreSQL only");
  }
  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("CVG_AUD27_PRODUCTS_BACKFILL_URL has an invalid database name encoding");
  }
  if (!new RegExp(`^${DATABASE_PREFIX}[a-f0-9]{12,}$`, "i").test(database)) {
    throw new Error(`products backfill verifier requires a dedicated database named ${DATABASE_PREFIX}<random-hex>`);
  }
  return { connectionString, database };
}

function syntheticProduct(organizationId: string, suffix: string, sku = `AUD27-${suffix}`): Product {
  return {
    id: makeId(),
    organizationId: organizationId as Product["organizationId"],
    sku,
    name: `Synthetic product ${suffix}`,
    category: "SUPPLY",
    unit: "unit",
    reorderPoint: 1,
    status: "ACTIVE"
  };
}

function createAuthorizer(allowedTenants: ReadonlySet<string>, failRunId?: string, failSecondBatch?: { count: number }): (context: Aud27MigrationBatchContext) => void {
  return (context) => {
    if (context.slice !== "products" || !allowedTenants.has(context.tenantId)) {
      throw new Aud27MigrationError("AUTHORIZATION_SCOPE", "products verifier rejected an unowned tenant or slice");
    }
    if (context.commandIds.some((commandId) => !commandId.startsWith(`aud27:products:${context.tenantId}:`))) {
      throw new Aud27MigrationError("AUTHORIZATION_SCOPE", "products verifier rejected an unscoped command ID");
    }
    if (context.runId === failRunId && failSecondBatch && context.commandIds.length > 0) {
      failSecondBatch.count += 1;
      if (failSecondBatch.count === 2) throw new Error("synthetic second-batch authorization failure");
    }
  };
}

function makeRunId(label: string): string {
  return `products-${label}-${randomUUID()}`;
}

async function preflight(client: Client, expectedDatabase: string): Promise<void> {
  const current = await client.query<{ database: string; current_user: string; bypass_rls: boolean; superuser: boolean; can_create: boolean }>(
    `select current_database() as database, current_user,
            role.rolbypassrls as bypass_rls, role.rolsuper as superuser,
            has_schema_privilege(current_user, 'public', 'CREATE') as can_create
     from pg_roles role where role.rolname = current_user`
  );
  const identity = current.rows[0];
  if (!identity || identity.database !== expectedDatabase) throw new Error("connected PostgreSQL database does not match the dedicated URL database name");
  if (!identity.bypass_rls && !identity.superuser) throw new Error("dedicated verifier URL must use a local operator role able to prove the database is empty across RLS scopes");
  if (!identity.can_create) throw new Error("dedicated verifier role cannot create its temporary DML probe");

  const required = await client.query<{ version: string }>(
    "select version from schema_migrations where version = any($1::text[])",
    [["047_aud27_migration_protocol", "048_aud27_migration_rls"]]
  );
  if (new Set(required.rows.map((row) => row.version)).size !== 2) {
    throw new Error("products backfill verifier requires migrations 047_aud27_migration_protocol and 048_aud27_migration_rls");
  }

  const scopedTables = await client.query<{ table_name: string; rls: boolean; force_rls: boolean }>(
    `select cls.relname as table_name, cls.relrowsecurity as rls, cls.relforcerowsecurity as force_rls
     from pg_class cls join pg_namespace ns on ns.oid = cls.relnamespace
     where ns.nspname = 'public' and cls.relname = any($1::text[])`,
    [["organizations", "products", "cvg_aud27_migration_checkpoints", "cvg_aud27_migration_records"]]
  );
  if (scopedTables.rows.length !== 4 || scopedTables.rows.some((row) => !row.rls || !row.force_rls)) {
    throw new Error("products backfill verifier requires forced RLS on organization, product, and AUD27 protocol tables");
  }
  const skuConstraint = await client.query<{ unique_sku: boolean }>(
    `select exists (
       select 1 from pg_constraint
       where conrelid = 'public.products'::regclass
         and conname = 'products_organization_id_sku_key'
         and contype = 'u' and convalidated
     ) as unique_sku`
  );
  if (!skuConstraint.rows[0]?.unique_sku) throw new Error("products backfill verifier requires the organization/SKU unique constraint");

  const privileges = await client.query<{ products: boolean; organizations: boolean; checkpoints: boolean }>(
    `select has_table_privilege(current_user, 'public.products', 'SELECT,INSERT,DELETE') as products,
            has_table_privilege(current_user, 'public.organizations', 'SELECT,INSERT,DELETE') as organizations,
            has_table_privilege(current_user, 'public.cvg_aud27_migration_checkpoints', 'SELECT,INSERT,UPDATE,DELETE') as checkpoints`
  );
  const granted = privileges.rows[0];
  if (!granted?.products || !granted.organizations || !granted.checkpoints) {
    throw new Error("dedicated verifier role lacks products, organization, or migration-checkpoint privileges");
  }

  const inventory = await client.query<{ organizations: string; products: string; checkpoints: string; records: string }>(
    `select (select count(*)::text from organizations) as organizations,
            (select count(*)::text from products) as products,
            (select count(*)::text from cvg_aud27_migration_checkpoints) as checkpoints,
            (select count(*)::text from cvg_aud27_migration_records) as records`
  );
  const counts = inventory.rows[0];
  if (!counts || Object.values(counts).some((count) => count !== "0")) {
    throw new Error("products backfill verifier requires an empty dedicated database; no data was mutated");
  }
  const probeNames = await client.query<{ table_free: boolean; function_free: boolean; trigger_free: boolean }>(
    `select to_regclass('public.${PROBE_TABLE}') is null as table_free,
            not exists (select 1 from pg_proc where proname = $1 and pg_function_is_visible(oid)) as function_free,
            not exists (select 1 from pg_trigger where tgname = $2 and not tgisinternal) as trigger_free`,
    [PROBE_FUNCTION, PROBE_TRIGGER]
  );
  if (!probeNames.rows[0]?.table_free || !probeNames.rows[0]?.function_free || !probeNames.rows[0]?.trigger_free) {
    throw new Error("dedicated database already contains the verifier DML probe; refusing to reuse it");
  }
}

async function installDmlProbe(client: Client): Promise<void> {
  await client.query("begin");
  try {
    await client.query(`create table public.${PROBE_TABLE} (id boolean primary key default true check (id), inserts bigint not null default 0, updates bigint not null default 0, deletes bigint not null default 0)`);
    await client.query(`insert into public.${PROBE_TABLE}(id) values (true)`);
    await client.query(`create function public.${PROBE_FUNCTION}() returns trigger
      language plpgsql security definer set search_path = pg_catalog, public
      as $$ begin
        if tg_op = 'INSERT' then update public.${PROBE_TABLE} set inserts = inserts + 1 where id = true; return new; end if;
        if tg_op = 'UPDATE' then update public.${PROBE_TABLE} set updates = updates + 1 where id = true; return new; end if;
        update public.${PROBE_TABLE} set deletes = deletes + 1 where id = true; return old;
      end $$`);
    await client.query(`create trigger ${PROBE_TRIGGER} after insert or update or delete on public.products for each row execute function public.${PROBE_FUNCTION}()`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function dmlCounts(client: Client): Promise<{ inserts: number; updates: number; deletes: number }> {
  const result = await client.query<{ inserts: string; updates: string; deletes: string }>(
    `select inserts::text, updates::text, deletes::text from public.${PROBE_TABLE} where id = true`
  );
  const row = result.rows[0];
  if (!row) throw new Error("products DML probe row is missing");
  return { inserts: Number(row.inserts), updates: Number(row.updates), deletes: Number(row.deletes) };
}

async function createOrganizations(client: Client, organizations: readonly { id: string; slug: string }[]): Promise<void> {
  await client.query("begin");
  try {
    for (const organization of organizations) {
      await client.query("select set_config('cvg.organization_id', $1, true)", [organization.id]);
      await client.query(
        "insert into organizations(id, name, slug, status) values ($1, $2, $3, 'ACTIVE')",
        [organization.id, "Synthetic AUD27 products backfill verifier", organization.slug]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function insertCount(client: Client, organizationId: string): Promise<number> {
  await client.query("begin");
  try {
    await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
    const result = await client.query<{ count: string }>(
      "select count(*)::text as count from products where organization_id = cvg_request_organization()"
    );
    await client.query("commit");
    return Number(result.rows[0]?.count ?? 0);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function assertUnchangedCounts(before: { inserts: number; updates: number; deletes: number }, after: { inserts: number; updates: number; deletes: number }, label: string): Promise<void> {
  if (before.inserts !== after.inserts || before.updates !== after.updates || before.deletes !== after.deletes) {
    throw new Error(`${label} issued product DML: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }
}

async function runProducts(
  executor: Aud27MigrationExecutor<Product>,
  adapter: Aud27MigrationAdapter<Product>,
  runId: string,
  organizationId: string,
  products: readonly Product[],
  options: { dryRun?: boolean; batchSize?: number } = {}
) {
  return executor.run({
    runId,
    slice: "products",
    tenantId: organizationId,
    sourceRecords: productsBackfillRecords(organizationId, products),
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun })
  }, adapter);
}

function waitForCrashMarker(child: ChildProcessWithoutNullStreams): Promise<{ stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectPromise(new Error(`products crash-window child did not commit a batch; stdout=${stdout} stderr=${stderr}`));
    }, 20_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) rejectPromise(error);
      else resolvePromise({ stdout, stderr });
    };
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes(CRASH_MARKER)) finish();
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (!settled) finish(new Error(`products crash-window child exited before its commit marker code=${code} signal=${signal}; stderr=${stderr}`));
    });
  });
}

async function childExit(child: ChildProcessWithoutNullStreams): Promise<ChildExit> {
  if (child.exitCode !== null || child.signalCode !== null) return { code: child.exitCode, signal: child.signalCode };
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
}

async function runCrashWindowProof(
  connectionString: string,
  organizationId: string,
  products: readonly Product[],
  runId: string,
  adapter: PostgresAud27ProductsBackfillAdapter,
  checkpoints: PostgresAud27MigrationCheckpointStore
): Promise<void> {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), CRASH_CHILD_FLAG], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      CVG_AUD27_PRODUCTS_BACKFILL_URL: connectionString,
      CVG_AUD27_PRODUCTS_BACKFILL_ORGANIZATION_ID: organizationId,
      CVG_AUD27_PRODUCTS_BACKFILL_RUN_ID: runId,
      CVG_AUD27_PRODUCTS_BACKFILL_SOURCE: JSON.stringify(products)
    }
  });
  let marker: { stdout: string; stderr: string };
  try {
    marker = await waitForCrashMarker(child);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await childExit(child).catch(() => undefined);
    throw error;
  }
  const killed = child.kill("SIGKILL");
  const exit = await childExit(child);
  if (!killed || exit.signal !== "SIGKILL") {
    throw new Error(`products crash-window child was not killed after its target commit; stdout=${marker.stdout} stderr=${marker.stderr} signal=${exit.signal}`);
  }
  const checkpointAfterDeath = await checkpoints.load(runId, "products", organizationId);
  if (checkpointAfterDeath !== null) throw new Error("products crash-window child unexpectedly saved a checkpoint before termination");
  const partialTarget = await adapter.readTarget({ runId, slice: "products", tenantId: organizationId });
  const first = [...productsBackfillRecords(organizationId, products)].sort((left, right) => left.key.localeCompare(right.key))[0];
  if (partialTarget.length !== 1 || !first || partialTarget[0]?.key !== first.key) {
    throw new Error(`products crash window did not leave exactly the first committed row; target=${partialTarget.length}`);
  }

  const recoveryExecutor = new Aud27MigrationExecutor<Product>(checkpoints);
  const recovered = await runProducts(recoveryExecutor, adapter, runId, organizationId, products, { batchSize: 1 });
  if (recovered.outcome !== "APPLIED" || recovered.sourceDigest !== recovered.targetDigest || recovered.targetCount !== products.length) {
    throw new Error("products crash-window recovery failed exact count/digest parity");
  }
  const replay = await runProducts(recoveryExecutor, adapter, runId, organizationId, products, { batchSize: 1 });
  if (replay.outcome !== "REPLAY") throw new Error("products recovered run did not replay as a reconciled run");
}

async function runCrashWindowChild(): Promise<void> {
  const dedicated = parseDedicatedProductsBackfillUrl(process.env.CVG_AUD27_PRODUCTS_BACKFILL_URL);
  const organizationId = process.env.CVG_AUD27_PRODUCTS_BACKFILL_ORGANIZATION_ID ?? "";
  const runId = process.env.CVG_AUD27_PRODUCTS_BACKFILL_RUN_ID ?? "";
  const rawSource = process.env.CVG_AUD27_PRODUCTS_BACKFILL_SOURCE ?? "";
  if (!organizationId || !runId || !rawSource) throw new Error("products crash-window child is missing synthetic run input");
  const sourceProducts = JSON.parse(rawSource) as Product[];
  const pool = new Pool({ connectionString: dedicated.connectionString, max: 2, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-products-backfill-crash-child" });
  const runScope = new PostgresAud27MigrationRunScope(pool);
  const adapter = new PostgresAud27ProductsBackfillAdapter({
    pool,
    runScope,
    authorize: createAuthorizer(new Set([organizationId]))
  });
  const checkpoints = new PostgresAud27MigrationCheckpointStore({ pool, runScope, authorize: createAuthorizer(new Set([organizationId])) });
  const executor = new Aud27MigrationExecutor<Product>(checkpoints);
  const crashAdapter: Aud27MigrationAdapter<Product> = {
    runScope: adapter.runScope,
    authorize: (context) => adapter.authorize(context),
    applyBatch: async (context, records): Promise<Aud27MigrationBatchEffect> => {
      const effect = await adapter.applyBatch(context, records);
      writeSync(1, `${CRASH_MARKER}\n`);
      await new Promise<never>(() => undefined);
      return effect;
    },
    readTarget: (context) => adapter.readTarget(context)
  };
  await executor.run({ runId, slice: "products", tenantId: organizationId, sourceRecords: productsBackfillRecords(organizationId, sourceProducts), batchSize: 1 }, crashAdapter);
  throw new Error("products crash-window child returned before parent termination");
}

async function main(): Promise<void> {
  const dedicated = parseDedicatedProductsBackfillUrl(process.env.CVG_AUD27_PRODUCTS_BACKFILL_URL);
  const client = new Client({ connectionString: dedicated.connectionString, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-products-backfill-preflight" });
  await client.connect();
  let safeToCleanup = false;
  let probeTableCreated = false;
  let probeFunctionCreated = false;
  let probeTriggerCreated = false;
  const organizations = Array.from({ length: 4 }, () => ({ id: makeId(), slug: `aud27-products-${randomUUID().replaceAll("-", "")}` }));
  const [mainOrg, batchOrg, crashOrg, crossOrg] = organizations;
  if (!mainOrg || !batchOrg || !crashOrg || !crossOrg) throw new Error("products verifier failed to create synthetic organizations");
  const mainProducts = [syntheticProduct(mainOrg.id, "MAIN-A"), syntheticProduct(mainOrg.id, "MAIN-B")];
  const batchProducts = [syntheticProduct(batchOrg.id, "BATCH-A"), syntheticProduct(batchOrg.id, "BATCH-B")];
  const crashProducts = [syntheticProduct(crashOrg.id, "CRASH-A"), syntheticProduct(crashOrg.id, "CRASH-B")];
  const crossOrganizationProduct = syntheticProduct(crossOrg.id, "CROSS-ORG", mainProducts[0]!.sku);
  const concurrentSku = `AUD27-CONCURRENT-${randomUUID().replaceAll("-", "")}`;
  const sameOrgConcurrentProducts = [
    syntheticProduct(mainOrg.id, "CONCURRENT-A", concurrentSku),
    syntheticProduct(mainOrg.id, "CONCURRENT-B", concurrentSku)
  ];
  const crossOrgConcurrentProduct = syntheticProduct(crossOrg.id, "CONCURRENT-CROSS-ORG", concurrentSku);
  const allProducts = [...mainProducts, ...batchProducts, ...crashProducts, crossOrganizationProduct, ...sameOrgConcurrentProducts, crossOrgConcurrentProduct];
  const runIds = new Map<string, string[]>();
  const rememberRun = (organizationId: string, runId: string): string => {
    const ids = runIds.get(organizationId) ?? [];
    ids.push(runId);
    runIds.set(organizationId, ids);
    return runId;
  };
  let pool: Pool | undefined;
  let runScope: PostgresAud27MigrationRunScope | undefined;
  let checkpoints: PostgresAud27MigrationCheckpointStore | undefined;
  let executor: Aud27MigrationExecutor<Product> | undefined;
  let adapter: PostgresAud27ProductsBackfillAdapter | undefined;
  let verdict = "products shadow backfill verifier failed";
  try {
    await preflight(client, dedicated.database);
    safeToCleanup = true;
    await installDmlProbe(client);
    probeTableCreated = true;
    probeFunctionCreated = true;
    probeTriggerCreated = true;
    await createOrganizations(client, organizations);

    pool = new Pool({ connectionString: dedicated.connectionString, max: 3, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-products-backfill-verifier" });
    runScope = new PostgresAud27MigrationRunScope(pool);
    const allowed = new Set(organizations.map((organization) => organization.id));
    const failSecondBatch = { count: 0 };
    adapter = new PostgresAud27ProductsBackfillAdapter({ pool, runScope, authorize: createAuthorizer(allowed) });
    checkpoints = new PostgresAud27MigrationCheckpointStore({ pool, runScope, authorize: createAuthorizer(allowed) });
    executor = new Aud27MigrationExecutor<Product>(checkpoints);

    const mainRun = rememberRun(mainOrg.id, makeRunId("main"));
    const dmlBeforeDryRun = await dmlCounts(client);
    const dryRun = await runProducts(executor, adapter, mainRun, mainOrg.id, mainProducts, { dryRun: true, batchSize: 1 });
    const dmlAfterDryRun = await dmlCounts(client);
    if (dryRun.outcome !== "DRY_RUN" || dryRun.targetCount !== 0) throw new Error("products dry-run did not report the empty target");
    await assertUnchangedCounts(dmlBeforeDryRun, dmlAfterDryRun, "products dry-run");

    const applied = await runProducts(executor, adapter, mainRun, mainOrg.id, mainProducts, { batchSize: 1 });
    if (applied.outcome !== "APPLIED" || applied.sourceCount !== 2 || applied.targetCount !== 2 || applied.sourceDigest !== applied.targetDigest) {
      throw new Error("products backfill did not achieve full-row count/digest parity");
    }
    const otherTenantTarget = await adapter.readTarget({ runId: mainRun, slice: "products", tenantId: batchOrg.id });
    let unownedTenantRejected = false;
    try {
      await adapter.readTarget({ runId: mainRun, slice: "products", tenantId: makeId() });
    } catch (error) {
      unownedTenantRejected = error instanceof Aud27MigrationError && error.code === "AUTHORIZATION_SCOPE";
    }
    if (otherTenantTarget.length !== 0 || !unownedTenantRejected) throw new Error("products target read crossed an organization authorization boundary");
    const dmlBeforeReplay = await dmlCounts(client);
    const replay = await runProducts(executor, adapter, mainRun, mainOrg.id, mainProducts, { batchSize: 1 });
    const dmlAfterReplay = await dmlCounts(client);
    if (replay.outcome !== "REPLAY") throw new Error("reconciled products backfill did not return REPLAY");
    await assertUnchangedCounts(dmlBeforeReplay, dmlAfterReplay, "products reconciled replay");

    await client.query("begin");
    await client.query("select set_config('cvg.organization_id', $1, true)", [mainOrg.id]);
    await client.query("update products set name = name || ' drift' where id = $1 and organization_id = cvg_request_organization()", [mainProducts[0]!.id]);
    await client.query("commit");
    let driftRejected = false;
    try {
      await runProducts(executor, adapter, mainRun, mainOrg.id, mainProducts, { batchSize: 1 });
    } catch (error) {
      driftRejected = error instanceof Aud27MigrationError && error.code === "REPLAY_PARITY";
    }
    const quarantined = await checkpoints.load(mainRun, "products", mainOrg.id);
    if (!driftRejected || quarantined?.status !== "QUARANTINED") throw new Error("products target drift was not rejected and quarantined");

    const duplicateSkuProduct = syntheticProduct(mainOrg.id, "DUPLICATE-SKU", mainProducts[0]!.sku);
    const duplicateRun = rememberRun(mainOrg.id, makeRunId("sku-conflict"));
    const duplicateRecords = productsBackfillRecords(mainOrg.id, [duplicateSkuProduct]);
    const duplicateContext: Aud27MigrationBatchContext = {
      runId: duplicateRun,
      slice: "products",
      tenantId: mainOrg.id,
      commandIds: [`aud27:products:${mainOrg.id}:${duplicateSkuProduct.id}`]
    };
    await adapter.authorize(duplicateContext);
    let sameOrganizationSkuRejected = false;
    try {
      await adapter.applyBatch(duplicateContext, duplicateRecords);
    } catch (error) {
      sameOrganizationSkuRejected = error instanceof Aud27MigrationError && error.code === "SKU_CONFLICT";
    }
    if (!sameOrganizationSkuRejected || (await adapter.readTarget({ runId: duplicateRun, slice: "products", tenantId: mainOrg.id })).some((record) => record.key === duplicateSkuProduct.id)) {
      throw new Error("products database uniqueness did not reject a duplicate SKU within one organization");
    }

    const crossRun = rememberRun(crossOrg.id, makeRunId("cross-organization-sku"));
    const cross = await runProducts(executor, adapter, crossRun, crossOrg.id, [crossOrganizationProduct], { batchSize: 1 });
    if (cross.outcome !== "APPLIED" || cross.sourceDigest !== cross.targetDigest) {
      throw new Error("same SKU in a different organization was not accepted with exact parity");
    }

    const sameOrgContexts = sameOrgConcurrentProducts.map((product) => ({
      runId: makeRunId("same-org-sku-race"),
      slice: "products",
      tenantId: product.organizationId,
      commandIds: [`aud27:products:${product.organizationId}:${product.id}`]
    } satisfies Aud27MigrationBatchContext));
    const skuRaceAdapter = adapter;
    if (!skuRaceAdapter) throw new Error("products SKU race verifier has no PostgreSQL adapter");
    const crossOrgContext: Aud27MigrationBatchContext = {
      runId: makeRunId("cross-org-sku-race"),
      slice: "products",
      tenantId: crossOrg.id,
      commandIds: [`aud27:products:${crossOrg.id}:${crossOrgConcurrentProduct.id}`]
    };
    const concurrentOutcomes = await Promise.all([
      ...sameOrgConcurrentProducts.map(async (product, index) => {
        const context = sameOrgContexts[index]!;
        try {
          await skuRaceAdapter.authorize(context);
          await skuRaceAdapter.applyBatch(context, productsBackfillRecords(product.organizationId, [product]));
          return { product, status: "APPLIED" as const };
        } catch (error) {
          return { product, status: "REJECTED" as const, error };
        }
      }),
      (async () => {
        await skuRaceAdapter.authorize(crossOrgContext);
        try {
          await skuRaceAdapter.applyBatch(crossOrgContext, productsBackfillRecords(crossOrg.id, [crossOrgConcurrentProduct]));
          return { product: crossOrgConcurrentProduct, status: "APPLIED" as const };
        } catch (error) {
          return { product: crossOrgConcurrentProduct, status: "REJECTED" as const, error };
        }
      })()
    ]);
    const sameOrgOutcomes = concurrentOutcomes.slice(0, sameOrgConcurrentProducts.length);
    const sameOrgApplied = sameOrgOutcomes.filter((outcome) => outcome.status === "APPLIED");
    const sameOrgRejected = sameOrgOutcomes.filter((outcome) => outcome.status === "REJECTED");
    const crossOrgOutcome = concurrentOutcomes.at(-1);
    if (sameOrgApplied.length !== 1 || sameOrgRejected.length !== 1
      || !(sameOrgRejected[0]?.status === "REJECTED" && sameOrgRejected[0].error instanceof Aud27MigrationError && sameOrgRejected[0].error.code === "SKU_CONFLICT")
      || crossOrgOutcome?.status !== "APPLIED") {
      throw new Error("concurrent products writes did not reject exactly one same-organization SKU and allow the cross-organization SKU");
    }
    const sameOrgConcurrentTarget = await skuRaceAdapter.readTarget({ runId: sameOrgContexts[0]!.runId, slice: "products", tenantId: mainOrg.id });
    const crossOrgConcurrentTarget = await skuRaceAdapter.readTarget({ runId: crossOrgContext.runId, slice: "products", tenantId: crossOrg.id });
    if (sameOrgConcurrentTarget.filter((record) => record.value.sku === concurrentSku).length !== 1
      || !crossOrgConcurrentTarget.some((record) => record.key === crossOrgConcurrentProduct.id)) {
      throw new Error("concurrent products writes left an unexpected same-organization or cross-organization target state");
    }

    const failingRunId = rememberRun(batchOrg.id, makeRunId("batch-rollback-resume"));
    failSecondBatch.count = 0;
    const flakyAdapter = new PostgresAud27ProductsBackfillAdapter({
      pool,
      runScope,
      authorize: createAuthorizer(allowed, failingRunId, failSecondBatch)
    });
    const flakyExecutor = new Aud27MigrationExecutor<Product>(checkpoints);
    let batchFailureObserved = false;
    try {
      await flakyExecutor.run({ runId: failingRunId, slice: "products", tenantId: batchOrg.id, sourceRecords: productsBackfillRecords(batchOrg.id, batchProducts), batchSize: 1 }, flakyAdapter);
    } catch (error) {
      batchFailureObserved = error instanceof Error && error.message.includes("synthetic second-batch authorization failure");
    }
    if (!batchFailureObserved || (await insertCount(client, batchOrg.id)) !== 0) {
      throw new Error("failed second products batch did not roll back its already committed first batch");
    }
    const rolledBack = await checkpoints.load(failingRunId, "products", batchOrg.id);
    if (rolledBack?.status !== "ROLLED_BACK" || rolledBack.processedKeys.length !== 0) {
      throw new Error("products batch rollback did not persist an empty rollback checkpoint");
    }
    const resumed = await runProducts(executor, adapter, failingRunId, batchOrg.id, batchProducts, { batchSize: 1 });
    if (resumed.outcome !== "APPLIED" || resumed.sourceDigest !== resumed.targetDigest || resumed.targetCount !== batchProducts.length) {
      throw new Error("products run did not resume to exact parity after batch rollback");
    }

    const crashRun = rememberRun(crashOrg.id, makeRunId("crash-window"));
    await runCrashWindowProof(dedicated.connectionString, crashOrg.id, crashProducts, crashRun, adapter, checkpoints);

    verdict = "AUD27_PRODUCTS_BACKFILL_VERIFIED dry_run=PASS full_row_digest_parity=PASS reconciled_replay_no_dml=PASS drift_quarantine=PASS batch_rollback_resume=PASS crash_window_recovery=PASS tenant_scope=PASS same_org_sku=REJECTED same_org_sku_concurrency=ONE_APPLIED_ONE_REJECTED cross_org_same_sku=PASS cross_org_same_sku_concurrency=PASS authority=SNAPSHOT_PRIMARY cutover=NOT_CLAIMED source=synthetic";
    process.stdout.write(`${verdict}\n`);
  } finally {
    if (safeToCleanup) {
      try {
        await client.query("begin");
        for (const organization of organizations) {
          await client.query("select set_config('cvg.organization_id', $1, true)", [organization.id]);
          await client.query("delete from products where organization_id = cvg_request_organization() and id = any($1::uuid[])", [allProducts.filter((product) => product.organizationId === organization.id).map((product) => product.id)]);
          await client.query("select set_config('cvg.aud27.tenant_id', $1, true)", [organization.id]);
          await client.query(
            "delete from cvg_aud27_migration_checkpoints where tenant_id = $1 and slice = 'products' and run_id = any($2::text[])",
            [organization.id, runIds.get(organization.id) ?? []]
          );
          await client.query("select set_config('cvg.organization_id', $1, true)", [organization.id]);
          await client.query("delete from organizations where id = $1 and id = cvg_request_organization()", [organization.id]);
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        process.stderr.write(`AUD27_PRODUCTS_BACKFILL_CLEANUP_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    }
    await checkpoints?.close().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    if (probeTriggerCreated) await client.query(`drop trigger if exists ${PROBE_TRIGGER} on public.products`).catch(() => undefined);
    if (probeFunctionCreated) await client.query(`drop function if exists public.${PROBE_FUNCTION}()`).catch(() => undefined);
    if (probeTableCreated) await client.query(`drop table if exists public.${PROBE_TABLE}`).catch(() => undefined);
    await client.end().catch(() => undefined);
    if (process.exitCode !== 1 && verdict.startsWith("AUD27_")) process.stdout.write("AUD27_PRODUCTS_BACKFILL_CLEANUP=SCOPED_SYNTHETIC_ROWS_ONLY\n");
  }
}

const directScript = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (directScript) {
  const run = process.argv.includes(CRASH_CHILD_FLAG) ? runCrashWindowChild : main;
  void run().catch((error: unknown) => {
    process.stderr.write(`AUD27_PRODUCTS_BACKFILL_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
