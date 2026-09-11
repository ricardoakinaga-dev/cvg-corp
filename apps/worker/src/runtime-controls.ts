import { DomainError } from "@cvg/domain";

export type WorkerResource = "database" | "provider" | "ai";

export interface WorkerResourceLimits {
  workerCycles: number;
  database: number;
  provider: number;
  ai: number;
}

export interface WorkerBulkheadSnapshot {
  readonly active: number;
  readonly limit: number;
  readonly rejected: number;
}

class RejectingBulkhead {
  private active = 0;
  private rejected = 0;

  constructor(private readonly label: string, private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      this.rejected += 1;
      throw new DomainError("BUDGET_EXCEEDED", `${this.label} concurrency limit reached; work was not queued.`, 503);
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }

  snapshot(): WorkerBulkheadSnapshot {
    return Object.freeze({ active: this.active, limit: this.limit, rejected: this.rejected });
  }
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new DomainError("INVALID_INPUT", "Worker concurrency limits must be finite numbers.", 400);
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

/**
 * Process-local bulkheads reject immediately and never keep an in-memory wait
 * queue. Durable jobs remain in PostgreSQL and can be claimed by a later cycle.
 */
export class WorkerResourceController {
  private readonly cycles: RejectingBulkhead;
  private readonly resources: Record<WorkerResource, RejectingBulkhead>;

  constructor(limits: Partial<WorkerResourceLimits> = {}) {
    this.cycles = new RejectingBulkhead("worker cycle", boundedLimit(limits.workerCycles, 1, 64));
    this.resources = {
      database: new RejectingBulkhead("database", boundedLimit(limits.database, 4, 128)),
      provider: new RejectingBulkhead("provider", boundedLimit(limits.provider, 2, 64)),
      ai: new RejectingBulkhead("AI", boundedLimit(limits.ai, 1, 32))
    };
  }

  runCycle<T>(operation: () => Promise<T>): Promise<T> {
    return this.cycles.run(operation);
  }

  run<T>(resource: WorkerResource, operation: () => Promise<T>): Promise<T> {
    return this.resources[resource].run(operation);
  }

  snapshot(): { cycles: WorkerBulkheadSnapshot; resources: Record<WorkerResource, WorkerBulkheadSnapshot> } {
    return Object.freeze({
      cycles: this.cycles.snapshot(),
      resources: Object.freeze({
        database: this.resources.database.snapshot(),
        provider: this.resources.provider.snapshot(),
        ai: this.resources.ai.snapshot()
      })
    });
  }
}

export interface DatabasePoolCapacity {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
  readonly max: number;
}

export function databasePoolSaturated(capacity: DatabasePoolCapacity): boolean {
  if (![capacity.total, capacity.idle, capacity.waiting, capacity.max].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new DomainError("INVALID_INPUT", "Database pool capacity sample is invalid.", 500);
  }
  if (capacity.max < 1 || capacity.total > capacity.max || capacity.idle > capacity.total) {
    throw new DomainError("INVALID_INPUT", "Database pool capacity sample is inconsistent.", 500);
  }
  return capacity.waiting > 0 || (capacity.total >= capacity.max && capacity.idle === 0);
}

export async function withAbortableTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal: AbortSignal
): Promise<T> {
  const boundedTimeoutMs = Math.min(120_000, Math.max(1, Math.trunc(timeoutMs)));
  const controller = new AbortController();
  const onParentAbort = (): void => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", onParentAbort, { once: true });
  if (parentSignal.aborted) controller.abort(parentSignal.reason);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const execution = Promise.resolve().then(() => operation(controller.signal));
  execution.catch(() => undefined);
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(new DomainError("BUDGET_EXCEEDED", "Worker handler deadline exceeded.", 503));
          reject(new DomainError("BUDGET_EXCEEDED", "Worker handler deadline exceeded.", 503));
        }, boundedTimeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal.removeEventListener("abort", onParentAbort);
  }
}
