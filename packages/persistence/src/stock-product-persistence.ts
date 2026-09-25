import type { PoolClient } from "pg";
import type { Product } from "@cvg/contracts";
import { PersistenceProductSkuConflictError } from "./persistence-errors.js";

export interface StockProductWriteDependencies {
  corruption(message: string): Error;
}

/**
 * Writes a newly created product through the stock-owned relational path.
 * Product scope is organization-wide; unit and workspace scope do not apply.
 * The caller keeps the snapshot and this row in the same durable transaction.
 */
export async function writeAuthoritativeProduct(
  client: PoolClient,
  product: Product,
  dependencies: StockProductWriteDependencies
): Promise<void> {
  const result = await client.query<{ id: string }>(
      "insert into products(id, organization_id, sku, name, category, unit, reorder_point, status) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do update set organization_id = excluded.organization_id, sku = excluded.sku, name = excluded.name, category = excluded.category, unit = excluded.unit, reorder_point = excluded.reorder_point, status = excluded.status where products.organization_id = excluded.organization_id and products.sku = excluded.sku and products.name = excluded.name and products.category = excluded.category and products.unit = excluded.unit and products.reorder_point = excluded.reorder_point and products.status = excluded.status returning id::text",
      [product.id, product.organizationId, product.sku, product.name, product.category, product.unit, product.reorderPoint, product.status]
    ).catch((error: unknown) => {
      if (isProductSkuUniqueViolation(error)) throw new PersistenceProductSkuConflictError();
      throw error;
    });
  if (!result.rows[0]) throw dependencies.corruption(`authoritative product ${product.id} conflicts with an existing normalized row`);
}

function isProductSkuUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && candidate.constraint === "products_organization_id_sku_key";
}

/**
 * A replay must resolve to the exact normalized row already committed by the
 * original command. It deliberately performs no DML, but it still fails
 * closed if the snapshot and relational record have drifted apart.
 */
export async function assertAuthoritativeProductReplay(
  client: PoolClient,
  product: Product,
  dependencies: StockProductWriteDependencies
): Promise<void> {
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
    "select id::text as id, organization_id::text as organization_id, sku, name, category, unit, reorder_point, status from products where id = $1 and organization_id = $2",
    [product.id, product.organizationId]
  );
  const row = result.rows[0];
  if (!row
    || row.id !== product.id
    || row.organization_id !== product.organizationId
    || row.sku !== product.sku
    || row.name !== product.name
    || row.category !== product.category
    || row.unit !== product.unit
    || row.reorder_point !== product.reorderPoint
    || row.status !== product.status) {
    throw dependencies.corruption(`product replay ${product.id} does not match its normalized row`);
  }
}
