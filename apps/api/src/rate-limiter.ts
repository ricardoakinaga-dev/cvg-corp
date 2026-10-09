import { Pool } from "pg";
import { DomainError } from "@cvg/domain";
import { tokenDigest } from "./sensitive-identifiers.ts";

export interface RateLimiter {
  readonly distributed: boolean;
  consume(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  peek?(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  close?(): Promise<void>;
}

/** Bounded fallback for local/test use; production must inject a shared implementation. */
export class MemoryRateLimiter implements RateLimiter {
  readonly distributed = false;
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxKeys = 10_000, private readonly clock: () => number = Date.now) {
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new RangeError("maxKeys must be positive");
  }

  async consume(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const nowMs = this.clock();
    this.removeExpired(nowMs);
    const current = this.buckets.get(input.key);
    if (!current || current.resetAt <= nowMs) {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = [...this.buckets.entries()].sort((left, right) => left[1].resetAt - right[1].resetAt)[0]?.[0];
        if (oldest) this.buckets.delete(oldest);
      }
      this.buckets.set(input.key, { count: 1, resetAt: nowMs + input.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= input.limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1_000)) };
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async peek(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const nowMs = this.clock();
    this.removeExpired(nowMs);
    const current = this.buckets.get(input.key);
    if (!current || current.resetAt <= nowMs) return { allowed: true, retryAfterSeconds: 0 };
    if (current.count >= input.limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1_000)) };
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async close(): Promise<void> {
    this.buckets.clear();
  }

  private removeExpired(nowMs: number): void {
    for (const [key, bucket] of this.buckets) if (bucket.resetAt <= nowMs) this.buckets.delete(key);
  }
}

export const RATE_LIMIT_BUCKET_MAX_WINDOW_MS = 60 * 60 * 1_000;
export const RATE_LIMIT_BUCKET_RETENTION_MS = 2 * 60 * 60 * 1_000;
export const RATE_LIMIT_BUCKET_CLEANUP_INTERVAL_MS = 30 * 1_000;
export const RATE_LIMIT_BUCKET_CLEANUP_BATCH_SIZE = 500;

export interface RateLimitCleanupMetrics {
  readonly bucketRows: number | null;
  readonly deletedRows: number;
  readonly oldestBucketAgeMs: number | null;
  readonly cleanupFailures: number;
  readonly lastCleanupAt: string | null;
  readonly lastError: string | null;
}

export interface RateLimitDatabaseClient {
  query<T extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

export interface PostgresRateLimiterOptions {
  /** Test/harness seam; production constructs the Pool internally. */
  pool?: RateLimitDatabaseClient;
  retentionMs?: number;
  maxWindowMs?: number;
  cleanupIntervalMs?: number;
  cleanupBatchSize?: number;
  now?: () => number;
  onCleanupMetrics?: (metrics: RateLimitCleanupMetrics) => void;
}

/**
 * Atomic PostgreSQL fixed-window limiter. The bucket key is hashed before it
 * reaches the database so addresses and session identifiers never become
 * durable rate-limit metadata. The table is provisioned by migrations 023+.
 */
export class PostgresRateLimiter implements RateLimiter {
  readonly distributed = true;
  private readonly pool: RateLimitDatabaseClient;
  private readonly retentionMs: number;
  private readonly maxWindowMs: number;
  private readonly cleanupBatchSize: number;
  private readonly clock: () => number;
  private readonly onCleanupMetrics: ((metrics: RateLimitCleanupMetrics) => void) | undefined;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;
  private cleanupInFlight: Promise<RateLimitCleanupMetrics> | null = null;
  private cleanupState: RateLimitCleanupMetrics = { bucketRows: null, deletedRows: 0, oldestBucketAgeMs: null, cleanupFailures: 0, lastCleanupAt: null, lastError: null };

  constructor(databaseUrl: string, options: PostgresRateLimiterOptions = {}) {
    const pool = options.pool ?? new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 2_500, idleTimeoutMillis: 30_000, application_name: "cvg-corp-rate-limit" });
    this.pool = pool as RateLimitDatabaseClient;
    this.retentionMs = boundedRateLimitLifecycleValue(options.retentionMs ?? RATE_LIMIT_BUCKET_RETENTION_MS, "retentionMs", 1, 7 * 24 * 60 * 60 * 1_000);
    this.maxWindowMs = boundedRateLimitLifecycleValue(options.maxWindowMs ?? RATE_LIMIT_BUCKET_MAX_WINDOW_MS, "maxWindowMs", 1, this.retentionMs);
    this.cleanupBatchSize = boundedRateLimitLifecycleValue(options.cleanupBatchSize ?? RATE_LIMIT_BUCKET_CLEANUP_BATCH_SIZE, "cleanupBatchSize", 1, 10_000);
    const cleanupIntervalMs = boundedRateLimitLifecycleValue(options.cleanupIntervalMs ?? RATE_LIMIT_BUCKET_CLEANUP_INTERVAL_MS, "cleanupIntervalMs", 1_000, 24 * 60 * 60 * 1_000);
    this.clock = options.now ?? Date.now;
    this.onCleanupMetrics = options.onCleanupMetrics;
    this.cleanupTimer = setInterval(() => { void this.cleanupExpiredBuckets(); }, cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  async consume(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || !Number.isSafeInteger(input.windowMs) || input.windowMs < 1 || input.windowMs > this.maxWindowMs) throw new DomainError("INVALID_INPUT", "Os parâmetros de rate limit são inválidos.", 400);
    try {
      const result = await this.pool.query<{ request_count: number; retry_after_ms: number }>(
        `insert into cvg_rate_limit_buckets(bucket_key, window_started_at, request_count, updated_at)
         values ($1, now(), 1, now())
         on conflict (bucket_key) do update set
           request_count = case
             when cvg_rate_limit_buckets.window_started_at <= now() - ($3::double precision * interval '1 millisecond') then 1
             else cvg_rate_limit_buckets.request_count + 1
           end,
           window_started_at = case
             when cvg_rate_limit_buckets.window_started_at <= now() - ($3::double precision * interval '1 millisecond') then now()
             else cvg_rate_limit_buckets.window_started_at
           end,
           updated_at = now()
         returning request_count, greatest(0, extract(epoch from ((window_started_at + ($3::double precision * interval '1 millisecond')) - now())) * 1000)::double precision as retry_after_ms`,
        [tokenDigest(input.key), input.limit, input.windowMs]
      );
      const row = result.rows[0];
      if (!row) throw new Error("rate-limit bucket write returned no row");
      const retryAfterSeconds = Math.max(1, Math.ceil(Number(row.retry_after_ms ?? input.windowMs) / 1_000));
      return { allowed: Number(row.request_count) <= input.limit, retryAfterSeconds: Number(row.request_count) <= input.limit ? 0 : retryAfterSeconds };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("DEPENDENCY_UNAVAILABLE", "O rate limit distribuído está indisponível; a solicitação foi bloqueada.", 503, { cause: error instanceof Error ? error.name : "unknown" });
    }
  }

  async peek(input: { key: string; limit: number; windowMs: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    try {
      const result = await this.pool.query<{ request_count: number; retry_after_ms: number }>(
        `select request_count, greatest(0, extract(epoch from ((window_started_at + ($2::double precision * interval '1 millisecond')) - now())) * 1000)::double precision as retry_after_ms
         from cvg_rate_limit_buckets
         where bucket_key = $1 and window_started_at > now() - ($2::double precision * interval '1 millisecond')`,
        [tokenDigest(input.key), input.windowMs]
      );
      const row = result.rows[0];
      if (!row) return { allowed: true, retryAfterSeconds: 0 };
      const retryAfterSeconds = Math.max(1, Math.ceil(Number(row.retry_after_ms ?? input.windowMs) / 1_000));
      return { allowed: Number(row.request_count) <= input.limit, retryAfterSeconds: Number(row.request_count) <= input.limit ? 0 : retryAfterSeconds };
    } catch (error) {
      throw new DomainError("DEPENDENCY_UNAVAILABLE", "O rate limit distribuído está indisponível; a solicitação foi bloqueada.", 503, { cause: error instanceof Error ? error.name : "unknown" });
    }
  }

  async close(): Promise<void> {
    clearInterval(this.cleanupTimer);
    await this.cleanupInFlight;
    await this.pool.end();
  }

  lifecycleMetrics(): RateLimitCleanupMetrics {
    return { ...this.cleanupState };
  }

  /** Incremental, idempotent cleanup; SKIP LOCKED avoids waiting on hot writes. */
  async cleanupExpiredBuckets(): Promise<RateLimitCleanupMetrics> {
    if (this.cleanupInFlight) return this.cleanupInFlight;
    this.cleanupInFlight = this.runCleanup();
    try {
      return await this.cleanupInFlight;
    } finally {
      this.cleanupInFlight = null;
    }
  }

  private async runCleanup(): Promise<RateLimitCleanupMetrics> {
    try {
      const deleted = await this.pool.query<{ age_ms: number }>(
        `with candidates as (
           select ctid
           from cvg_rate_limit_buckets
           where updated_at <= now() - ($1::double precision * interval '1 millisecond')
           order by updated_at asc
           for update skip locked
           limit $2
         )
         delete from cvg_rate_limit_buckets as bucket
         using candidates
         where bucket.ctid = candidates.ctid
         returning greatest(0, extract(epoch from (clock_timestamp() - bucket.updated_at)) * 1000)::double precision as age_ms`,
        [this.retentionMs, this.cleanupBatchSize]
      );
      const current = await this.pool.query<{ bucket_rows: number; oldest_age_ms: number | null }>(
        `select count(*)::int as bucket_rows,
                case when min(updated_at) is null then null
                     else greatest(0, extract(epoch from (clock_timestamp() - min(updated_at))) * 1000)::double precision
                end as oldest_age_ms
         from cvg_rate_limit_buckets`,
        []
      );
      const row = current.rows[0];
      this.cleanupState = {
        bucketRows: row ? Number(row.bucket_rows) : 0,
        deletedRows: deleted.rows.length,
        oldestBucketAgeMs: row?.oldest_age_ms === null || row?.oldest_age_ms === undefined ? null : Number(row.oldest_age_ms),
        cleanupFailures: this.cleanupState.cleanupFailures,
        lastCleanupAt: new Date(this.clock()).toISOString(),
        lastError: null
      };
    } catch (error) {
      this.cleanupState = { ...this.cleanupState, deletedRows: 0, cleanupFailures: this.cleanupState.cleanupFailures + 1, lastCleanupAt: new Date(this.clock()).toISOString(), lastError: error instanceof Error ? error.name : "UnknownError" };
    }
    this.onCleanupMetrics?.(this.cleanupState);
    return this.lifecycleMetrics();
  }
}

function boundedRateLimitLifecycleValue(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}
