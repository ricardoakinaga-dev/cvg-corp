import test from "node:test";
import assert from "node:assert/strict";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import type { Product } from "@cvg/contracts";
import { digest, makeId } from "@cvg/domain";
import {
  Aud27MigrationError,
  PostgresAud27ProductsBackfillAdapter,
  productsBackfillRecords,
  type Aud27MigrationBatchContext,
  type ProductsBackfillRunScope
} from "@cvg/persistence";
import { parseDedicatedProductsBackfillUrl } from "../../scripts/verify-aud27-products-backfill.js";

type ProductSqlRow = {
  id: string;
  organization_id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorder_point: number;
  status: string;
};

class FakeProductsDatabase {
  readonly rows = new Map<string, Product>();
  readonly statements: string[] = [];
  insertMutations = 0;
  deleteMutations = 0;
  private organizationId = "";
  private transactionRows: Map<string, Product> | null = null;

  readonly pool = {} as Pool;
  readonly runScope: ProductsBackfillRunScope;

  constructor() {
    const client = { query: (sql: string, values?: readonly unknown[]) => this.query(sql, values ?? []) } as unknown as PoolClient;
    this.runScope = { withClient: async (_pool, operation) => operation(client) };
  }

  private result<Row extends QueryResultRow>(rows: Row[] = [], rowCount = rows.length): QueryResult<Row> {
    return { rows, rowCount, command: "", oid: 0, fields: [] };
  }

  private toSqlRow(product: Product): ProductSqlRow {
    return {
      id: product.id,
      organization_id: product.organizationId,
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      reorder_point: product.reorderPoint,
      status: product.status
    };
  }

  private async query(sql: string, values: readonly unknown[]): Promise<QueryResult<never>> {
    this.statements.push(sql);
    if (sql === "begin") {
      this.transactionRows = new Map([...this.rows].map(([key, value]) => [key, structuredClone(value)]));
      return this.result();
    }
    if (sql === "commit") {
      this.transactionRows = null;
      return this.result();
    }
    if (sql === "rollback") {
      if (this.transactionRows) {
        this.rows.clear();
        for (const [key, value] of this.transactionRows) this.rows.set(key, value);
      }
      this.transactionRows = null;
      return this.result();
    }
    if (sql === "select set_config('cvg.organization_id', $1, true)") {
      this.organizationId = String(values[0]);
      return this.result();
    }
    if (sql === "select set_config('cvg.unit_id', $1, true)" || sql === "select set_config('cvg.workspace_id', $1, true)") return this.result();
    if (sql.includes("upper(sku) = upper($1)")) {
      const sku = String(values[0]).trim().toUpperCase();
      const excludedId = String(values[1]);
      const conflict = [...this.rows.values()].find((row) => row.organizationId === this.organizationId && row.id !== excludedId && row.sku.trim().toUpperCase() === sku);
      return this.result(conflict ? [{ id: conflict.id }] as never[] : [], conflict ? 1 : 0);
    }
    if (sql.includes("insert into products")) {
      const product: Product = {
        id: String(values[0]) as Product["id"],
        organizationId: String(values[1]) as Product["organizationId"],
        sku: String(values[2]),
        name: String(values[3]),
        category: String(values[4]),
        unit: String(values[5]),
        reorderPoint: Number(values[6]),
        status: String(values[7]) as Product["status"]
      };
      if (this.rows.has(product.id)) return this.result([], 0);
      if ([...this.rows.values()].some((row) => row.organizationId === product.organizationId && row.sku === product.sku)) {
        throw { code: "23505", constraint: "products_organization_id_sku_key" };
      }
      this.rows.set(product.id, product);
      this.insertMutations += 1;
      return this.result([{ id: product.id }] as never[], 1);
    }
    if (sql.includes("from products where id = $1 and organization_id = cvg_request_organization()")) {
      const row = this.rows.get(String(values[0]));
      const rows = row && row.organizationId === this.organizationId ? [this.toSqlRow(row)] : [];
      return this.result(rows as never[], rows.length);
    }
    if (sql.includes("from products where organization_id = cvg_request_organization() order by id")) {
      const rows = [...this.rows.values()]
        .filter((row) => row.organizationId === this.organizationId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((row) => this.toSqlRow(row));
      return this.result(rows as never[], rows.length);
    }
    if (sql.includes("delete from products")) {
      const [id, sku, name, category, unit, reorderPoint, status] = values.map(String);
      const row = this.rows.get(id ?? "");
      const matches = row && row.organizationId === this.organizationId && row.sku === sku && row.name === name && row.category === category && row.unit === unit && row.reorderPoint === Number(reorderPoint) && row.status === status;
      if (!matches || !row) return this.result([], 0);
      this.rows.delete(id!);
      this.deleteMutations += 1;
      return this.result([{ id }] as never[], 1);
    }
    throw new Error(`unexpected fake products SQL: ${sql}`);
  }
}

function product(organizationId: Product["organizationId"], sku = `SKU-${makeId()}`): Product {
  return {
    id: makeId(),
    organizationId,
    sku,
    name: "Synthetic product",
    category: "SUPPLY",
    unit: "unit",
    reorderPoint: 2,
    status: "ACTIVE"
  };
}

function batchContext(organizationId: Product["organizationId"], products: readonly Product[], runId = "products-backfill-unit"): Aud27MigrationBatchContext {
  return {
    runId,
    slice: "products",
    tenantId: organizationId,
    commandIds: products.map((row) => `aud27:products:${organizationId}:${row.id}`)
  };
}

function adapterFor(database: FakeProductsDatabase, authorize: (context: Aud27MigrationBatchContext) => void = () => undefined): PostgresAud27ProductsBackfillAdapter {
  return new PostgresAud27ProductsBackfillAdapter({ pool: database.pool, runScope: database.runScope, authorize });
}

test("products source records preserve canonical full-row identity and enforce the organization scope", () => {
  const organizationId = makeId();
  const row = product(organizationId);
  const records = productsBackfillRecords(organizationId, [row]);
  assert.deepEqual(records[0]?.value, row);
  assert.equal(records[0]?.tenantId, organizationId);
  assert.equal(records[0]?.key, row.id);
  assert.equal(digest(records), digest([{ tenantId: organizationId, key: row.id, version: 1, value: row }]));

  assert.throws(() => productsBackfillRecords(makeId(), [row]), (error: unknown) => error instanceof Aud27MigrationError && error.code === "TENANT_SCOPE");
  assert.throws(() => productsBackfillRecords(organizationId, [row, row]), (error: unknown) => error instanceof Aud27MigrationError && error.code === "DUPLICATE_SOURCE_KEY");
  assert.throws(
    () => productsBackfillRecords(organizationId, [row, { ...row, id: makeId() }]),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "DUPLICATE_SOURCE_SKU"
  );
  assert.throws(
    () => productsBackfillRecords(organizationId, [{ ...row, sku: "sku-case" }, { ...row, id: makeId(), sku: "SKU-CASE" }]),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "DUPLICATE_SOURCE_SKU"
  );
  assert.throws(
    () => productsBackfillRecords(organizationId, [{ ...row, reorderPoint: -1 }]),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "INVALID_PRODUCT"
  );
  assert.throws(
    () => productsBackfillRecords(organizationId, [null as unknown as Product]),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "INVALID_PRODUCT"
  );
  assert.throws(
    () => productsBackfillRecords(organizationId, [{ ...row, sku: 42 as unknown as string }]),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "INVALID_PRODUCT"
  );
  assert.throws(
    () => productsBackfillRecords(organizationId, [{ ...row, status: "ARCHIVED" as Product["status"] }]),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "INVALID_PRODUCT"
  );
  assert.throws(
    () => productsBackfillRecords("not-an-organization-uuid", [row]),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "INVALID_TENANT"
  );
});

test("products adapter requires an authorized, exact organization command batch", async () => {
  const organizationId = makeId();
  const row = product(organizationId);
  const database = new FakeProductsDatabase();
  const authorizations: string[] = [];
  const adapter = adapterFor(database, ({ tenantId }) => authorizations.push(tenantId));
  const context = batchContext(organizationId, [row]);
  const records = productsBackfillRecords(organizationId, [row]);

  await assert.rejects(adapter.applyBatch(context, records), (error: unknown) => error instanceof Aud27MigrationError && error.code === "AUTHORIZATION_REQUIRED");
  await assert.rejects(adapter.authorize({ ...context, commandIds: ["aud27:products:other-org:wrong"] }), (error: unknown) => error instanceof Aud27MigrationError && error.code === "AUTHORIZATION_SCOPE");
  await adapter.authorize(context);
  const effect = await adapter.applyBatch(context, records);
  assert.deepEqual(authorizations, [organizationId]);
  assert.deepEqual(effect.writtenKeys, [row.id]);
  assert.deepEqual(await adapter.readTarget({ runId: context.runId, slice: "products", tenantId: organizationId }), records);
  assert.equal((await adapter.readTarget({ runId: context.runId, slice: "products", tenantId: makeId() })).length, 0);
});

test("products target reads require an explicit tenant-scoped authorization", async () => {
  const allowedOrganizationId = makeId();
  const deniedOrganizationId = makeId();
  const database = new FakeProductsDatabase();
  const adapter = adapterFor(database, (context) => {
    if (context.tenantId !== allowedOrganizationId || context.slice !== "products") throw new Error("read scope denied");
  });

  await assert.rejects(
    adapter.readTarget({ runId: "products-read-scope", slice: "products", tenantId: deniedOrganizationId }),
    /read scope denied/
  );
  assert.equal(database.statements.length, 0);
});

test("ID conflict is accepted only when every product column matches and does not make an existing row rollback-owned", async () => {
  const organizationId = makeId();
  const row = product(organizationId);
  const database = new FakeProductsDatabase();
  database.rows.set(row.id, structuredClone(row));
  const adapter = adapterFor(database);
  const context = batchContext(organizationId, [row]);
  await adapter.authorize(context);
  const effect = await adapter.applyBatch(context, productsBackfillRecords(organizationId, [row]));
  assert.equal(database.insertMutations, 0);
  const deletedBeforeRollback = database.deleteMutations;
  await effect.rollback();
  assert.equal(database.deleteMutations, deletedBeforeRollback);
  assert.deepEqual(database.rows.get(row.id), row);

  const variants: Product[] = [
    { ...row, sku: `${row.sku}-different` },
    { ...row, name: "Divergent same ID" },
    { ...row, category: "DIVERGENT" },
    { ...row, unit: "divergent" },
    { ...row, reorderPoint: row.reorderPoint + 1 },
    { ...row, status: "INACTIVE" }
  ];
  for (const divergent of variants) {
    const divergentDatabase = new FakeProductsDatabase();
    divergentDatabase.rows.set(row.id, divergent);
    const divergentAdapter = adapterFor(divergentDatabase);
    await divergentAdapter.authorize(context);
    await assert.rejects(
      divergentAdapter.applyBatch(context, productsBackfillRecords(organizationId, [row])),
      (error: unknown) => error instanceof Aud27MigrationError && error.code === "TARGET_CONFLICT"
    );
    assert.deepEqual(divergentDatabase.rows.get(row.id), divergent);
  }

  const otherOrganizationDatabase = new FakeProductsDatabase();
  otherOrganizationDatabase.rows.set(row.id, { ...row, organizationId: makeId() });
  const otherOrganizationAdapter = adapterFor(otherOrganizationDatabase);
  await otherOrganizationAdapter.authorize(context);
  await assert.rejects(
    otherOrganizationAdapter.applyBatch(context, productsBackfillRecords(organizationId, [row])),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "TARGET_CONFLICT"
  );
});

test("products rollback removes only this batch's exact inserted rows and quarantines rollback drift", async () => {
  const organizationId = makeId();
  const row = product(organizationId);
  const database = new FakeProductsDatabase();
  const adapter = adapterFor(database);
  const context = batchContext(organizationId, [row]);
  await adapter.authorize(context);
  const effect = await adapter.applyBatch(context, productsBackfillRecords(organizationId, [row]));
  database.rows.set(row.id, { ...row, status: "INACTIVE" });
  await assert.rejects(effect.rollback(), (error: unknown) => error instanceof Aud27MigrationError && error.code === "ROLLBACK_DRIFT");
  const deleteSql = database.statements.find((sql) => sql.includes("delete from products")) ?? "";
  for (const field of ["id = $1", "organization_id = cvg_request_organization()", "sku = $2", "name = $3", "category = $4", "unit = $5", "reorder_point = $6", "status = $7"]) {
    assert.ok(deleteSql.includes(field), `rollback SQL is missing identity predicate ${field}`);
  }
  assert.equal(database.rows.get(row.id)?.status, "INACTIVE");

  database.rows.set(row.id, structuredClone(row));
  await effect.rollback();
  assert.equal(database.rows.has(row.id), false);
});

test("products adapter rejects same-organization SKU collisions and accepts the same SKU in another organization", async () => {
  const organizationId = makeId();
  const otherOrganizationId = makeId();
  const first = product(organizationId, "SHARED-SKU");
  const duplicate = product(organizationId, first.sku);
  const crossOrganization = product(otherOrganizationId, first.sku);
  const database = new FakeProductsDatabase();
  const adapter = adapterFor(database);

  const firstContext = batchContext(organizationId, [first]);
  await adapter.authorize(firstContext);
  await adapter.applyBatch(firstContext, productsBackfillRecords(organizationId, [first]));

  const duplicateContext = batchContext(organizationId, [duplicate], "products-sku-conflict");
  await adapter.authorize(duplicateContext);
  await assert.rejects(
    adapter.applyBatch(duplicateContext, productsBackfillRecords(organizationId, [duplicate])),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "SKU_CONFLICT"
  );

  const crossContext = batchContext(otherOrganizationId, [crossOrganization], "products-cross-org-sku");
  await adapter.authorize(crossContext);
  await adapter.applyBatch(crossContext, productsBackfillRecords(otherOrganizationId, [crossOrganization]));
  assert.equal(database.rows.size, 2);
});

test("existing case-variant SKUs in one organization fail closed before an insert", async () => {
  const organizationId = makeId();
  const existing = product(organizationId, "sku-case-variant");
  const incoming = product(organizationId, "SKU-CASE-VARIANT");
  const database = new FakeProductsDatabase();
  database.rows.set(existing.id, existing);
  const adapter = adapterFor(database);
  const context = batchContext(organizationId, [incoming]);
  await adapter.authorize(context);
  await assert.rejects(
    adapter.applyBatch(context, productsBackfillRecords(organizationId, [incoming])),
    (error: unknown) => error instanceof Aud27MigrationError && error.code === "SKU_CONFLICT"
  );
  assert.equal(database.insertMutations, 0);
  assert.equal(database.rows.size, 1);
});

test("dedicated PostgreSQL verifier URL parser fails closed without contacting non-loopback or shared databases", () => {
  const connectionString = "postgres://synthetic:synthetic@127.0.0.1/cvg_aud27_products_backfill_abcdef123456";
  assert.deepEqual(parseDedicatedProductsBackfillUrl(connectionString), {
    connectionString,
    database: "cvg_aud27_products_backfill_abcdef123456"
  });
  assert.throws(() => parseDedicatedProductsBackfillUrl(undefined), /provide CVG_AUD27_PRODUCTS_BACKFILL_URL explicitly/);
  assert.throws(() => parseDedicatedProductsBackfillUrl("not-a-postgres-url"), /not a valid PostgreSQL URL/);
  assert.throws(() => parseDedicatedProductsBackfillUrl("https://synthetic:synthetic@127.0.0.1/cvg_aud27_products_backfill_abcdef123456"), /must use the PostgreSQL protocol/);
  assert.throws(() => parseDedicatedProductsBackfillUrl("postgres://synthetic:synthetic@db.internal/cvg_aud27_products_backfill_abcdef123456"), /loopback/);
  assert.throws(() => parseDedicatedProductsBackfillUrl("postgres://synthetic:synthetic@127.0.0.1/cvg_shared"), /dedicated database/);
  assert.throws(() => parseDedicatedProductsBackfillUrl("postgres://synthetic:synthetic@127.0.0.1/cvg_aud27_products_backfill_abcdef123456%ZZ"), /invalid database name encoding/);
  assert.throws(() => parseDedicatedProductsBackfillUrl(`${connectionString}?host=db.internal`), /query or fragment overrides/);
});
