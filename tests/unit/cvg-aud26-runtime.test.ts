import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRateLimiter, PostgresRateLimiter, type RateLimitDatabaseClient } from "../../apps/api/src/app.ts";

class FakeRateLimitDatabase implements RateLimitDatabaseClient {
  readonly queries: string[] = [];
  cleanupCalls = 0;
  ended = false;
  constructor(private readonly cleanupDelayMs = 0, private readonly failCleanup = false) {}

  async query<T extends Record<string, unknown>>(text: string): Promise<{ rows: T[] }> {
    this.queries.push(text);
    if (text.includes("with candidates")) {
      this.cleanupCalls += 1;
      if (this.cleanupDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, this.cleanupDelayMs));
      if (this.failCleanup) throw new Error("synthetic cleanup failure");
      return { rows: [{ age_ms: 7_200_001 }] as unknown as T[] };
    }
    if (text.includes("select count(*)")) return { rows: [{ bucket_rows: 2, oldest_age_ms: 5_000 }] as unknown as T[] };
    if (text.includes("insert into cvg_rate_limit_buckets")) return { rows: [{ request_count: 1, retry_after_ms: 0 }] as unknown as T[] };
    return { rows: [] as T[] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

class FailingRateLimitDatabase implements RateLimitDatabaseClient {
  async query<T extends Record<string, unknown>>(): Promise<{ rows: T[] }> {
    throw new Error("synthetic database outage");
  }

  async end(): Promise<void> {}
}

test("local rate buckets remove expired entries while preserving an active bucket", async () => {
  let now = 0;
  const limiter = new MemoryRateLimiter(2, () => now);
  assert.deepEqual(await limiter.consume({ key: "active", limit: 1, windowMs: 100 }), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(await limiter.consume({ key: "active", limit: 1, windowMs: 100 }), { allowed: false, retryAfterSeconds: 1 });
  now = 50;
  assert.deepEqual(await limiter.peek({ key: "active", limit: 1, windowMs: 100 }), { allowed: false, retryAfterSeconds: 1 });
  now = 101;
  assert.deepEqual(await limiter.peek({ key: "active", limit: 1, windowMs: 100 }), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(await limiter.consume({ key: "new", limit: 1, windowMs: 100 }), { allowed: true, retryAfterSeconds: 0 });
  await limiter.close();
});

test("distributed rate bucket cleanup is incremental, concurrent-safe and observable", async () => {
  const database = new FakeRateLimitDatabase(15);
  const observed: Array<{ deletedRows: number; bucketRows: number | null }> = [];
  const limiter = new PostgresRateLimiter("postgres://fixture", {
    pool: database,
    cleanupIntervalMs: 60_000,
    onCleanupMetrics: (metrics) => observed.push({ deletedRows: metrics.deletedRows, bucketRows: metrics.bucketRows })
  });
  try {
    const [first, second] = await Promise.all([limiter.cleanupExpiredBuckets(), limiter.cleanupExpiredBuckets()]);
    assert.equal(database.cleanupCalls, 1, "concurrent cleanup calls must share one in-flight batch");
    assert.equal(first.deletedRows, 1);
    assert.deepEqual(second, first);
    assert.deepEqual(observed, [{ deletedRows: 1, bucketRows: 2 }]);
    assert.match(database.queries.find((query) => query.includes("with candidates")) ?? "", /updated_at <=/i);
    assert.match(database.queries.find((query) => query.includes("with candidates")) ?? "", /for update skip locked/i);
    assert.equal(limiter.lifecycleMetrics().oldestBucketAgeMs, 5_000);
  } finally {
    await limiter.close();
  }
  assert.equal(database.ended, true);
});

test("distributed rate bucket cleanup records failures without taking down the hot path", async () => {
  const database = new FakeRateLimitDatabase(0, true);
  const limiter = new PostgresRateLimiter("postgres://fixture", { pool: database, cleanupIntervalMs: 60_000 });
  try {
    const metrics = await limiter.cleanupExpiredBuckets();
    assert.equal(metrics.deletedRows, 0);
    assert.equal(metrics.cleanupFailures, 1);
    assert.equal(metrics.lastError, "Error");
  } finally {
    await limiter.close();
  }
});

test("distributed rate-limit peeks fail closed when the database is unavailable", async () => {
  const limiter = new PostgresRateLimiter("postgres://fixture", { pool: new FailingRateLimitDatabase(), cleanupIntervalMs: 60_000 });
  try {
    await assert.rejects(
      limiter.peek({ key: "login", limit: 5, windowMs: 60_000 }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    await limiter.close();
  }
});
