import type {
  OperationalBackupDirectoryVerificationOptions,
  OperationalBackupJobOptions,
  OperationalBackupJobRun,
  OperationalBackupJobStatus,
  OperationalBackupWriteOptions,
  OperationalBackupRecord
} from "./index.js";

export interface OperationalBackupJobDependencies {
  write(options: OperationalBackupWriteOptions): Promise<OperationalBackupRecord & { removed: readonly string[] }>;
  verify(options: OperationalBackupDirectoryVerificationOptions): Promise<{ verified: readonly OperationalBackupRecord[]; removed: readonly string[] }>;
  now(): string;
  stateError(message: string): Error;
  unavailableError(message: string): Error;
}

export class OperationalBackupJobCore {
  private readonly options: OperationalBackupJobOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active: Promise<OperationalBackupJobRun> | null = null;
  private lastRun: OperationalBackupJobRun | null = null;
  private lastFailure: string | null = null;

  constructor(options: OperationalBackupJobOptions, private readonly dependencies: OperationalBackupJobDependencies) {
    if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs <= 0) throw dependencies.stateError("operational backup interval must be a positive safe integer");
    this.options = options;
  }

  async runOnce(): Promise<OperationalBackupJobRun> {
    if (this.active) return this.active;
    this.active = this.execute().catch((error: unknown) => {
      this.lastFailure = error instanceof Error ? error.message : String(error);
      throw error;
    }).finally(() => {
      this.active = null;
    });
    return this.active;
  }

  start(options: { runImmediately?: boolean } = {}): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce().catch(async (error: unknown) => {
        this.lastFailure = error instanceof Error ? error.message : String(error);
        await this.options.onFailure?.(error);
      });
    }, this.options.intervalMs);
    const handle = this.timer as unknown as { unref?: () => void };
    handle.unref?.();
    if (options.runImmediately !== false) {
      void this.runOnce().catch(async (error: unknown) => {
        this.lastFailure = error instanceof Error ? error.message : String(error);
        await this.options.onFailure?.(error);
      });
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.active) await this.active.catch(() => undefined);
  }

  status(): OperationalBackupJobStatus {
    return { running: this.timer !== null, activeRun: this.active !== null, lastRun: this.lastRun, lastFailure: this.lastFailure };
  }

  private async execute(): Promise<OperationalBackupJobRun> {
    const key = await this.options.resolveKey(this.options.keyRef);
    if (!key) throw this.dependencies.unavailableError(`operational backup key is unavailable for ${this.options.keyRef}`);
    const bundle = await this.options.createBundle();
    const backup = await this.dependencies.write({ directory: this.options.directory, bundle, key, keyRef: this.options.keyRef, ...(this.options.retention ? { retention: this.options.retention } : {}) });
    const verification = await this.dependencies.verify({ directory: this.options.directory, resolveKey: this.options.resolveKey, ...(this.options.expectedMigrationFingerprint ? { expectedMigrationFingerprint: this.options.expectedMigrationFingerprint } : {}), ...(this.options.retention ? { retention: this.options.retention } : {}) });
    const result = { observedAt: this.dependencies.now(), backup, verification };
    this.lastRun = result;
    this.lastFailure = null;
    return result;
  }
}
