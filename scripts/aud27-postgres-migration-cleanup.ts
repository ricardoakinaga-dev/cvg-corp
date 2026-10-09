export type Aud27MigrationCleanupQueryResult = { rowCount: number | null };

export type Aud27MigrationCleanupQuery = (
  sql: string,
  params: unknown[]
) => Promise<Aud27MigrationCleanupQueryResult>;

export type Aud27MigrationCleanupClient = {
  query: Aud27MigrationCleanupQuery;
  release(): void;
};

export type Aud27MigrationCleanupPool = {
  connect(): Promise<Aud27MigrationCleanupClient>;
};

export type Aud27MigrationCleanupScope = {
  tenantId: string;
  slice: string;
  runIds: readonly string[];
};

export type Aud27MigrationCleanupResult = {
  recordsDeleted: number;
  checkpointsDeleted: number;
};

export async function cleanupAud27MigrationRuns(
  pool: Aud27MigrationCleanupPool,
  scope: Aud27MigrationCleanupScope
): Promise<Aud27MigrationCleanupResult> {
  const tenantId = scope.tenantId.trim();
  const slice = scope.slice.trim();
  const runIds = [...new Set(scope.runIds.map((runId) => runId.trim()).filter(Boolean))].sort();
  if (!tenantId) throw new Error("AUD27 migration cleanup requires an explicit tenant");
  if (!slice) throw new Error("AUD27 migration cleanup requires an explicit slice");
  if (runIds.length === 0) return { recordsDeleted: 0, checkpointsDeleted: 0 };

  const client = await pool.connect();
  try {
    await client.query("begin", []);
    await client.query("select set_config('cvg.aud27.tenant_id', $1, true)", [tenantId]);
    const records = await client.query(
      "delete from cvg_aud27_migration_records where tenant_id = $1 and slice = $2 and run_id = any($3::text[])",
      [tenantId, slice, runIds]
    );
    const checkpoints = await client.query(
      "delete from cvg_aud27_migration_checkpoints where tenant_id = $1 and slice = $2 and run_id = any($3::text[])",
      [tenantId, slice, runIds]
    );
    await client.query("commit", []);
    return {
      recordsDeleted: records.rowCount ?? 0,
      checkpointsDeleted: checkpoints.rowCount ?? 0
    };
  } catch (error) {
    await client.query("rollback", []).catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
