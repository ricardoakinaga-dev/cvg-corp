import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { CvgStore, digest } from "@cvg/domain";
import { buildAud27NormalizedWritePlan, PostgresPersistence } from "@cvg/persistence";

const connectionString = process.env.CVG_AUD27_NORMALIZED_WRITES_URL?.trim() ?? "";
if (!connectionString) {
  process.stderr.write("AUD27_NORMALIZED_WRITES_BLOCKED provide CVG_AUD27_NORMALIZED_WRITES_URL explicitly; no database was contacted\n");
  process.exit(2);
}

const probe = new Client({ connectionString, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-normalized-writes-probe" });

async function main(): Promise<void> {
  await probe.connect();
  const existing = await probe.query<{ count: number }>("select count(*)::int as count from organizations");
  if ((existing.rows[0]?.count ?? 0) !== 0) throw new Error("normalized-write smoke requires an empty disposable database; no data was mutated");
  const migration = await probe.query<{ exists: boolean }>("select exists (select 1 from schema_migrations where version = '048_aud27_migration_rls') as exists");
  if (!migration.rows[0]?.exists) throw new Error("normalized-write smoke requires migration 048_aud27_migration_rls");
  await probe.end();

  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const organizationId = store.bootstrapCredentials.organizationId;
  const persistence = new PostgresPersistence({ connectionString, max: 3, connectionTimeoutMillis: 2_500 });
  try {
    const baseline = store.snapshot();
    await persistence.commit({
    expectedRevision: null,
    snapshot: baseline,
    eventType: "BOOTSTRAP",
    operation: "aud27.normalized-write.bootstrap",
    organizationId,
    actorId: null,
    correlationId: randomUUID(),
    aggregateType: "Organization",
    aggregateId: organizationId,
    payload: { synthetic: true },
    auditRecords: baseline.auditRecords,
    commandReceipts: baseline.commandReceipts
    });

    const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
    if (!option) throw new Error("normalized-write smoke has no bootstrap context");
    const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "aud27.normalized-write", randomUUID());
    const product = store.createProduct(context, { sku: `AUD27-${randomUUID().slice(0, 8)}`, name: "AUD27 normalized write smoke", category: "synthetic", unit: "unit", reorderPoint: 1 });
    const candidate = store.snapshot();
    const plan = buildAud27NormalizedWritePlan(baseline, candidate);
    if (plan.removed.length !== 0 || plan.writes.length !== 1 || plan.writes[0]?.snapshotKey !== "products" || digest(plan.writes[0].record) !== digest(product)) throw new Error(`normalized-write plan did not isolate the product row: ${JSON.stringify({ writes: plan.writes.map((write) => write.snapshotKey), removed: plan.removed.length })}`);

    await persistence.commit({
    expectedRevision: 1n,
    snapshot: candidate,
    eventType: "SYSTEM",
    operation: "aud27.normalized-write.product",
    organizationId,
    actorId: store.bootstrapCredentials.userId,
    correlationId: randomUUID(),
    aggregateType: "Product",
    aggregateId: product.id,
    payload: { synthetic: true, snapshotPrimary: "products" },
    auditRecords: candidate.auditRecords,
    commandReceipts: candidate.commandReceipts,
    normalizedDomainWrites: plan.writes
    });

    const verify = new Client({ connectionString, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-normalized-writes-probe" });
    try {
      await verify.connect();
      const row = await verify.query<{ id: string; name: string }>("select id::text as id, name from products where id = $1", [product.id]);
      if (row.rows[0]?.id !== product.id || row.rows[0]?.name !== product.name) throw new Error("normalized product row was not durably written");
    } finally {
      await verify.end().catch(() => undefined);
    }

    const removedCandidate = structuredClone(candidate) as typeof candidate;
    removedCandidate.products = removedCandidate.products.filter((row) => row.id !== product.id);
    const removalPlan = buildAud27NormalizedWritePlan(candidate, removedCandidate);
    if (removalPlan.writes.length !== 0 || removalPlan.removed.length !== 1 || removalPlan.removed[0]?.snapshotKey !== "products") throw new Error("normalized product removal plan was not explicit");
    await persistence.commit({
      expectedRevision: 2n,
      snapshot: removedCandidate,
      eventType: "SYSTEM",
      operation: "aud27.normalized-removal.product",
      organizationId,
      actorId: store.bootstrapCredentials.userId,
      correlationId: randomUUID(),
      aggregateType: "Product",
      aggregateId: product.id,
      payload: { synthetic: true, snapshotPrimaryRemoval: "products" },
      auditRecords: removedCandidate.auditRecords,
      commandReceipts: removedCandidate.commandReceipts,
      normalizedDomainRemovals: removalPlan.removed
    });
    const removalVerify = new Client({ connectionString, connectionTimeoutMillis: 2_500, application_name: "cvg-aud27-normalized-removal-probe" });
    try {
      await removalVerify.connect();
      const row = await removalVerify.query<{ id: string }>("select id::text as id from products where id = $1", [product.id]);
      if (row.rows.length !== 0) throw new Error("normalized product row survived its explicit relational removal");
    } finally {
      await removalVerify.end().catch(() => undefined);
    }
    process.stdout.write(`AUD27_NORMALIZED_WRITES_VERIFIED empty_database=PASS bootstrap=PASS changed_snapshot_rows=1 normalized_key=products relational_row=PASS explicit_removal=PASS candidate_cleanup=disposable\n`);
  } finally {
    await persistence.close().catch(() => undefined);
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`AUD27_NORMALIZED_WRITES_FAILED ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await probe.end().catch(() => undefined);
}
