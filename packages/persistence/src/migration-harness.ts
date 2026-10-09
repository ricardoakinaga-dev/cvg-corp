import { digest } from "@cvg/domain";

/**
 * AUD27-011: durable migration protocol.
 *
 * The executor owns ordering, checkpoints and parity; the adapter owns the
 * real SQL transaction. The default test store below is deliberately marked as
 * synthetic: it exercises the protocol without pretending to be PostgreSQL.
 */
export type Aud27MigrationRecord<T> = {
  tenantId: string;
  key: string;
  version: number;
  value: T;
};

export type Aud27MigrationCheckpointStatus = "RUNNING" | "CHECKPOINTED" | "DRY_RUN" | "RECONCILED" | "ROLLED_BACK" | "QUARANTINED";

export type Aud27MigrationCheckpoint = {
  runId: string;
  slice: string;
  tenantId: string;
  sourceDigest: string;
  processedKeys: string[];
  cursor: string | null;
  status: Aud27MigrationCheckpointStatus;
  updatedAt: string;
};

export type Aud27MigrationRunKey = Pick<Aud27MigrationCheckpoint, "runId" | "slice" | "tenantId">;

export interface Aud27MigrationCheckpointStore {
  /** Identity of the durable session scope used for every checkpoint and target operation. */
  readonly runScope?: object;
  load(runId: string, slice: string, tenantId: string): Promise<Aud27MigrationCheckpoint | null>;
  save(checkpoint: Aud27MigrationCheckpoint): Promise<void>;
  /** Serializes one run key and rejects concurrent owners. */
  runExclusive<T>(key: Aud27MigrationRunKey, operation: () => Promise<T>): Promise<T>;
}

export type Aud27MigrationBatchContext = {
  runId: string;
  slice: string;
  tenantId: string;
  commandIds: readonly string[];
  signal?: AbortSignal | undefined;
};

export type Aud27MigrationBatchEffect = {
  writtenKeys: readonly string[];
  rollback: () => Promise<void>;
};

export interface Aud27MigrationAdapter<T> {
  /** Must match the checkpoint store's session scope when either side is durable. */
  readonly runScope?: object;
  /** Must enforce tenant/slice authorization at the durable owner boundary. */
  authorize(context: Aud27MigrationBatchContext): Promise<void>;
  /** Must execute one bounded transaction and provide a real rollback hook. */
  applyBatch(context: Aud27MigrationBatchContext, records: readonly Aud27MigrationRecord<T>[]): Promise<Aud27MigrationBatchEffect>;
  /** Must read committed target state from the authoritative target, not memory owned by the executor. */
  readTarget(context: Omit<Aud27MigrationBatchContext, "commandIds">): Promise<readonly Aud27MigrationRecord<T>[]>;
}

export type Aud27MigrationRunInput<T> = {
  runId: string;
  slice: string;
  tenantId: string;
  sourceRecords: readonly Aud27MigrationRecord<T>[];
  batchSize?: number;
  dryRun?: boolean;
  signal?: AbortSignal;
  validateRecord?: (record: Aud27MigrationRecord<T>) => void | Promise<void>;
};

export type Aud27MigrationRunOutcome = "DRY_RUN" | "APPLIED" | "REPLAY" | "ROLLED_BACK" | "QUARANTINED";

export type Aud27MigrationReceipt = {
  runId: string;
  slice: string;
  tenantId: string;
  outcome: Aud27MigrationRunOutcome;
  sourceCount: number;
  targetCount: number;
  sourceDigest: string;
  targetDigest: string;
  processedKeys: string[];
  checkpoint: Aud27MigrationCheckpoint;
};

export class Aud27MigrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Aud27MigrationError";
  }
}

const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,255}$/;
const slicePattern = /^[a-z][a-z0-9-]{1,63}$/;

function ordered<T>(records: readonly Aud27MigrationRecord<T>[]): Aud27MigrationRecord<T>[] {
  return [...records].sort((left, right) => left.key.localeCompare(right.key));
}

function recordsDigest<T>(records: readonly Aud27MigrationRecord<T>[]): string {
  return digest(ordered(records).map((record) => ({ key: record.key, tenantId: record.tenantId, version: record.version, value: record.value })));
}

function assertContext<T>(input: Aud27MigrationRunInput<T>): void {
  if (!input.runId.trim() || input.runId.length > 160) throw new Aud27MigrationError("INVALID_RUN", "migration runId is required and bounded");
  if (!slicePattern.test(input.slice)) throw new Aud27MigrationError("INVALID_SLICE", "migration slice is invalid");
  if (!keyPattern.test(input.tenantId)) throw new Aud27MigrationError("INVALID_TENANT", "migration tenantId is invalid");
  const batchSize = input.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Aud27MigrationError("INVALID_BATCH_SIZE", "migration batchSize must be between 1 and 500");
  const seen = new Set<string>();
  for (const record of input.sourceRecords) {
    if (record.tenantId !== input.tenantId) throw new Aud27MigrationError("TENANT_SCOPE", `record ${record.key} crosses the migration tenant boundary`);
    if (!keyPattern.test(record.key) || seen.has(record.key)) throw new Aud27MigrationError("DUPLICATE_SOURCE_KEY", `source key ${record.key} is invalid or duplicated`);
    if (!Number.isSafeInteger(record.version) || record.version < 1) throw new Aud27MigrationError("INVALID_VERSION", `source key ${record.key} has an invalid version`);
    seen.add(record.key);
  }
}

function checkpointFor<T>(input: Aud27MigrationRunInput<T>, sourceDigest: string, status: Aud27MigrationCheckpointStatus, processedKeys: readonly string[], cursor: string | null, now: string): Aud27MigrationCheckpoint {
  return { runId: input.runId, slice: input.slice, tenantId: input.tenantId, sourceDigest, processedKeys: [...processedKeys].sort(), cursor, status, updatedAt: now };
}

export class Aud27MigrationExecutor<T> {
  constructor(private readonly checkpoints: Aud27MigrationCheckpointStore, private readonly now: () => string = () => new Date().toISOString()) {}

  async run(input: Aud27MigrationRunInput<T>, adapter: Aud27MigrationAdapter<T>): Promise<Aud27MigrationReceipt> {
    assertContext(input);
    if (input.signal?.aborted) throw new Aud27MigrationError("ABORTED", "migration was aborted before start");
    if (this.checkpoints.runScope !== adapter.runScope) {
      if (this.checkpoints.runScope !== undefined || adapter.runScope !== undefined) {
        throw new Aud27MigrationError("RUN_SCOPE_MISMATCH", "durable migration checkpoint and target adapters must share one run session scope");
      }
    }
    return this.checkpoints.runExclusive(
      { runId: input.runId, slice: input.slice, tenantId: input.tenantId },
      () => this.runExclusive(input, adapter)
    );
  }

  private async runExclusive(input: Aud27MigrationRunInput<T>, adapter: Aud27MigrationAdapter<T>): Promise<Aud27MigrationReceipt> {
    const source = ordered(input.sourceRecords);
    const sourceDigest = recordsDigest(source);
    const current = await this.checkpoints.load(input.runId, input.slice, input.tenantId);
    if (current && current.sourceDigest !== sourceDigest) throw new Aud27MigrationError("SOURCE_DRIFT", "source digest changed for an existing migration run");
    const targetContext = { runId: input.runId, slice: input.slice, tenantId: input.tenantId, signal: input.signal };
    const targetBefore = await adapter.readTarget(targetContext);
    if (current?.status === "RECONCILED") {
      const targetDigest = recordsDigest(targetBefore);
      if (targetBefore.length !== source.length || targetDigest !== sourceDigest) {
        const checkpoint = checkpointFor(input, sourceDigest, "QUARANTINED", current.processedKeys, current.cursor, this.now());
        await this.checkpoints.save(checkpoint);
        throw new Aud27MigrationError("REPLAY_PARITY", `reconciled target drifted for ${input.slice}: source=${source.length}/${sourceDigest} target=${targetBefore.length}/${targetDigest}`);
      }
      return { runId: input.runId, slice: input.slice, tenantId: input.tenantId, outcome: "REPLAY", sourceCount: source.length, targetCount: targetBefore.length, sourceDigest, targetDigest, processedKeys: current.processedKeys, checkpoint: current };
    }
    for (const record of source) await input.validateRecord?.(record);
    const processed = new Set(current?.processedKeys ?? []);
    const pending = source.filter((record) => !processed.has(record.key));
    if (input.dryRun) {
      const checkpoint = checkpointFor(input, sourceDigest, "DRY_RUN", [...processed], pending.at(-1)?.key ?? current?.cursor ?? null, this.now());
      await this.checkpoints.save(checkpoint);
      return { runId: input.runId, slice: input.slice, tenantId: input.tenantId, outcome: "DRY_RUN", sourceCount: source.length, targetCount: targetBefore.length, sourceDigest, targetDigest: recordsDigest(targetBefore), processedKeys: [...processed].sort(), checkpoint };
    }

    const effects: Aud27MigrationBatchEffect[] = [];
    try {
      const batchSize = input.batchSize ?? 100;
      for (let offset = 0; offset < pending.length; offset += batchSize) {
        if (input.signal?.aborted) throw new Aud27MigrationError("ABORTED", "migration was aborted between batches");
        const batch = pending.slice(offset, offset + batchSize);
        const commandIds = batch.map((record) => `aud27:${input.slice}:${input.tenantId}:${record.key}`);
        const context = { ...targetContext, commandIds };
        await adapter.authorize(context);
        const effect = await adapter.applyBatch(context, batch);
        const expected = new Set(batch.map((record) => record.key));
        if (effect.writtenKeys.some((key) => !expected.has(key))) throw new Aud27MigrationError("WRITE_SCOPE", "adapter wrote a key outside the requested batch");
        effects.push(effect);
        batch.forEach((record) => processed.add(record.key));
        const checkpoint = checkpointFor(input, sourceDigest, "CHECKPOINTED", [...processed], batch.at(-1)?.key ?? null, this.now());
        await this.checkpoints.save(checkpoint);
      }
      const target = await adapter.readTarget(targetContext);
      const targetDigest = recordsDigest(target);
      if (target.length !== source.length || targetDigest !== sourceDigest) throw new Aud27MigrationError("PARITY", `target parity failed for ${input.slice}: source=${source.length}/${sourceDigest} target=${target.length}/${targetDigest}`);
      const checkpoint = checkpointFor(input, sourceDigest, "RECONCILED", [...processed], source.at(-1)?.key ?? null, this.now());
      await this.checkpoints.save(checkpoint);
      return { runId: input.runId, slice: input.slice, tenantId: input.tenantId, outcome: current ? "APPLIED" : "APPLIED", sourceCount: source.length, targetCount: target.length, sourceDigest, targetDigest, processedKeys: [...processed].sort(), checkpoint };
    } catch (error) {
      for (const effect of effects.reverse()) await effect.rollback();
      const status: Aud27MigrationCheckpointStatus = error instanceof Aud27MigrationError && error.code === "PARITY" ? "QUARANTINED" : "ROLLED_BACK";
      const checkpoint = checkpointFor(input, sourceDigest, status, [], null, this.now());
      await this.checkpoints.save(checkpoint);
      throw error;
    }
  }
}

/** Synthetic checkpoint store for protocol tests; not a production durability claim. */
export class InMemoryAud27MigrationCheckpointStore implements Aud27MigrationCheckpointStore {
  private readonly records = new Map<string, Aud27MigrationCheckpoint>();
  private readonly activeRuns = new Set<string>();

  async runExclusive<T>(key: Aud27MigrationRunKey, operation: () => Promise<T>): Promise<T> {
    const serialized = JSON.stringify([key.tenantId, key.slice, key.runId]);
    if (this.activeRuns.has(serialized)) throw new Aud27MigrationError("RUN_IN_PROGRESS", `migration run is already active: ${key.runId}:${key.slice}:${key.tenantId}`);
    this.activeRuns.add(serialized);
    try {
      return await operation();
    } finally {
      this.activeRuns.delete(serialized);
    }
  }

  async load(runId: string, slice: string, tenantId: string): Promise<Aud27MigrationCheckpoint | null> {
    return this.records.get(`${runId}:${slice}:${tenantId}`) ?? null;
  }
  async save(checkpoint: Aud27MigrationCheckpoint): Promise<void> {
    this.records.set(`${checkpoint.runId}:${checkpoint.slice}:${checkpoint.tenantId}`, structuredClone(checkpoint));
  }
}
