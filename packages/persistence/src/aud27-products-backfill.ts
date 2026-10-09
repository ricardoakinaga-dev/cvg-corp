import type { Pool, PoolClient } from "pg";
import type { Product } from "@cvg/contracts";
import { digest } from "@cvg/domain";
import {
  Aud27MigrationError,
  type Aud27MigrationAdapter,
  type Aud27MigrationBatchContext,
  type Aud27MigrationBatchEffect,
  type Aud27MigrationRecord
} from "./migration-harness.js";
import type { Aud27MigrationAuthorizer } from "./aud27-postgres-migration.js";

export const AUD27_PRODUCTS_BACKFILL_SLICE = "products";
export const AUD27_PRODUCTS_BACKFILL_VERSION = 1;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const commandPrefix = "aud27:products:";

export interface ProductsBackfillRunScope {
  withClient<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T>;
}

export type Aud27ProductsBackfillAdapterOptions = {
  pool: Pool;
  runScope: ProductsBackfillRunScope & object;
  /** Also called before target reads with an empty commandIds list, so it must authorize the tenant and slice. */
  authorize: Aud27MigrationAuthorizer;
};

function canonicalProduct(product: Product): Pick<Product, "id" | "organizationId" | "sku" | "name" | "category" | "unit" | "reorderPoint" | "status"> {
  return {
    id: product.id,
    organizationId: product.organizationId,
    sku: product.sku,
    name: product.name,
    category: product.category,
    unit: product.unit,
    reorderPoint: product.reorderPoint,
    status: product.status
  };
}

function assertProductShape(product: Product, errorCode: string): void {
  if (!product || typeof product !== "object") throw new Aud27MigrationError(errorCode, "products migration row must be an object");
  if (!uuidPattern.test(product.id) || !uuidPattern.test(product.organizationId)) {
    throw new Aud27MigrationError(errorCode, "products migration row requires UUID product and organization IDs");
  }
  if ([product.sku, product.name, product.category, product.unit].some((field) => typeof field !== "string")) {
    throw new Aud27MigrationError(errorCode, `product ${product.id} contains a non-text field`);
  }
  if (!Number.isSafeInteger(product.reorderPoint) || product.reorderPoint < 0) {
    throw new Aud27MigrationError(errorCode, `product ${product.id} has an invalid reorder point`);
  }
  if (product.status !== "ACTIVE" && product.status !== "INACTIVE") {
    throw new Aud27MigrationError(errorCode, `product ${product.id} has an invalid status`);
  }
}

function sameProduct(left: Product, right: Product): boolean {
  return digest(canonicalProduct(left)) === digest(canonicalProduct(right));
}

export function productsBackfillRecords(tenantId: string, products: readonly Product[]): Aud27MigrationRecord<Product>[] {
  if (!uuidPattern.test(tenantId)) throw new Aud27MigrationError("INVALID_TENANT", "products migration tenant must be an organization UUID");
  const seenIds = new Set<string>();
  const seenSkus = new Set<string>();
  return products.map((product) => {
    assertProductShape(product, "INVALID_PRODUCT");
    if (product.organizationId !== tenantId) {
      throw new Aud27MigrationError("TENANT_SCOPE", `product ${product.id} belongs to a different organization`);
    }
    if (!uuidPattern.test(product.id) || seenIds.has(product.id)) {
      throw new Aud27MigrationError("DUPLICATE_SOURCE_KEY", `product source key ${product.id} is invalid or duplicated`);
    }
    seenIds.add(product.id);
    const skuKey = product.sku.trim().toUpperCase();
    if (seenSkus.has(skuKey)) throw new Aud27MigrationError("DUPLICATE_SOURCE_SKU", `product source SKU ${product.sku} is duplicated within the organization`);
    seenSkus.add(skuKey);
    return { tenantId, key: product.id, version: AUD27_PRODUCTS_BACKFILL_VERSION, value: canonicalProduct(product) };
  });
}

function contextKey(context: Aud27MigrationBatchContext): string {
  return digest({ runId: context.runId, slice: context.slice, tenantId: context.tenantId, commandIds: context.commandIds });
}

function assertOrganization(tenantId: string): void {
  if (!uuidPattern.test(tenantId)) throw new Aud27MigrationError("INVALID_TENANT", "products migration tenant must be an organization UUID");
}

function assertRecord(record: Aud27MigrationRecord<Product>, tenantId: string): Product {
  assertProductShape(record.value, "INVALID_PRODUCT");
  if (record.tenantId !== tenantId || record.value.organizationId !== tenantId) {
    throw new Aud27MigrationError("TENANT_SCOPE", `product ${record.key} crosses the organization boundary`);
  }
  if (record.key !== record.value.id || !uuidPattern.test(record.key)) {
    throw new Aud27MigrationError("INVALID_KEY", `product migration key ${record.key} does not match its row identity`);
  }
  if (record.version !== AUD27_PRODUCTS_BACKFILL_VERSION) {
    throw new Aud27MigrationError("INVALID_VERSION", `product ${record.key} has an unsupported migration version`);
  }
  return canonicalProduct(record.value);
}

async function withOrganizationTransaction<T>(
  scope: ProductsBackfillRunScope,
  pool: Pool,
  organizationId: string,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  return scope.withClient(pool, async (client) => {
    try {
      await client.query("begin");
      await client.query("select set_config('cvg.organization_id', $1, true)", [organizationId]);
      await client.query("select set_config('cvg.unit_id', $1, true)", [""]);
      await client.query("select set_config('cvg.workspace_id', $1, true)", [""]);
      const result = await operation(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  });
}

function mapProduct(row: {
  id: string;
  organization_id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  reorder_point: number;
  status: string;
}): Product {
  const product: Product = {
    id: row.id as Product["id"],
    organizationId: row.organization_id as Product["organizationId"],
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    reorderPoint: row.reorder_point,
    status: row.status as Product["status"]
  };
  assertProductShape(product, "TARGET_CORRUPTION");
  return product;
}

function productValues(product: Product): unknown[] {
  return [product.id, product.organizationId, product.sku, product.name, product.category, product.unit, product.reorderPoint, product.status];
}

function isProductSkuConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && candidate.constraint === "products_organization_id_sku_key";
}

export class PostgresAud27ProductsBackfillAdapter implements Aud27MigrationAdapter<Product> {
  readonly runScope: ProductsBackfillRunScope & object;
  private readonly authorizedBatches = new Set<string>();

  constructor(private readonly options: Aud27ProductsBackfillAdapterOptions) {
    this.runScope = options.runScope;
  }

  async authorize(context: Aud27MigrationBatchContext): Promise<void> {
    if (context.slice !== AUD27_PRODUCTS_BACKFILL_SLICE) {
      throw new Aud27MigrationError("INVALID_SLICE", "products backfill accepts only the products slice");
    }
    assertOrganization(context.tenantId);
    if (context.commandIds.length === 0 || context.commandIds.some((id) => !id.startsWith(`${commandPrefix}${context.tenantId}:`))) {
      throw new Aud27MigrationError("AUTHORIZATION_SCOPE", "products backfill command IDs do not match the organization scope");
    }
    await this.options.authorize(context);
    this.authorizedBatches.add(contextKey(context));
  }

  async applyBatch(context: Aud27MigrationBatchContext, records: readonly Aud27MigrationRecord<Product>[]): Promise<Aud27MigrationBatchEffect> {
    if (!this.authorizedBatches.delete(contextKey(context))) {
      throw new Aud27MigrationError("AUTHORIZATION_REQUIRED", "products backfill batch was not authorized");
    }
    if (context.slice !== AUD27_PRODUCTS_BACKFILL_SLICE || records.length === 0 || context.commandIds.length !== records.length) {
      throw new Aud27MigrationError("INVALID_BATCH", "products backfill batch context is invalid");
    }
    const batchKeys = new Set<string>();
    const batchSkus = new Set<string>();
    const products = records.map((record, index) => {
      const product = assertRecord(record, context.tenantId);
      if (batchKeys.has(record.key)) throw new Aud27MigrationError("DUPLICATE_SOURCE_KEY", `product batch repeats key ${record.key}`);
      const skuKey = product.sku.trim().toUpperCase();
      if (batchSkus.has(skuKey)) throw new Aud27MigrationError("DUPLICATE_SOURCE_SKU", `product batch repeats SKU ${product.sku}`);
      if (context.commandIds[index] !== `${commandPrefix}${context.tenantId}:${record.key}`) {
        throw new Aud27MigrationError("AUTHORIZATION_SCOPE", `product ${record.key} does not match its authorized command ID`);
      }
      batchKeys.add(record.key);
      batchSkus.add(skuKey);
      return product;
    });
    const inserted: Product[] = [];

    try {
      await withOrganizationTransaction(this.runScope, this.options.pool, context.tenantId, async (client) => {
        for (const product of products) {
          const skuConflict = await client.query<{ id: string }>(
            `select id::text as id from products
             where organization_id = cvg_request_organization()
               and upper(sku) = upper($1) and id <> $2
             limit 1`,
            [product.sku, product.id]
          );
          if (skuConflict.rows[0]) {
            throw new Aud27MigrationError("SKU_CONFLICT", "products backfill found a duplicate case-insensitive SKU within one organization");
          }
          const result = await client.query<{ id: string }>(
            `insert into products(id, organization_id, sku, name, category, unit, reorder_point, status)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (id) do nothing
             returning id::text as id`,
            productValues(product)
          );
          if ((result.rowCount ?? 0) === 1) {
            inserted.push(product);
            continue;
          }

          const existing = await client.query<{
            id: string;
            organization_id: string;
            sku: string;
            name: string;
            category: string;
            unit: string;
            reorder_point: number;
            status: string;
          }>(
            `select id::text as id, organization_id::text as organization_id, sku, name, category, unit, reorder_point, status
             from products where id = $1 and organization_id = cvg_request_organization()`,
            [product.id]
          );
          const row = existing.rows[0];
          if (!row || !sameProduct(product, mapProduct(row))) {
            throw new Aud27MigrationError("TARGET_CONFLICT", `existing product ${product.id} is not identical to its snapshot row`);
          }
        }
      });
    } catch (error) {
      if (isProductSkuConflict(error)) {
        throw new Aud27MigrationError("SKU_CONFLICT", "products backfill found a duplicate SKU within one organization");
      }
      throw error;
    }

    return {
      writtenKeys: records.map((record) => record.key),
      rollback: async () => {
        if (inserted.length === 0) return;
        await withOrganizationTransaction(this.runScope, this.options.pool, context.tenantId, async (client) => {
          for (const product of inserted) {
            const result = await client.query<{ id: string }>(
              `delete from products
               where id = $1 and organization_id = cvg_request_organization()
                 and sku = $2 and name = $3 and category = $4 and unit = $5 and reorder_point = $6 and status = $7
               returning id::text as id`,
              [product.id, product.sku, product.name, product.category, product.unit, product.reorderPoint, product.status]
            );
            if ((result.rowCount ?? 0) !== 1) {
              throw new Aud27MigrationError("ROLLBACK_DRIFT", `inserted product ${product.id} changed before rollback`);
            }
          }
        });
      }
    };
  }

  async readTarget(context: Omit<Aud27MigrationBatchContext, "commandIds">): Promise<readonly Aud27MigrationRecord<Product>[]> {
    if (context.slice !== AUD27_PRODUCTS_BACKFILL_SLICE) {
      throw new Aud27MigrationError("INVALID_SLICE", "products backfill target accepts only the products slice");
    }
    assertOrganization(context.tenantId);
    await this.options.authorize({ ...context, commandIds: [] });
    return withOrganizationTransaction(this.runScope, this.options.pool, context.tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        organization_id: string;
        sku: string;
        name: string;
        category: string;
        unit: string;
        reorder_point: number;
        status: string;
      }>(
        `select id::text as id, organization_id::text as organization_id, sku, name, category, unit, reorder_point, status
         from products where organization_id = cvg_request_organization() order by id`
      );
      return result.rows.map((row) => ({
        tenantId: context.tenantId,
        key: row.id,
        version: AUD27_PRODUCTS_BACKFILL_VERSION,
        value: mapProduct(row)
      }));
    });
  }
}
