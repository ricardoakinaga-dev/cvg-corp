export class PersistenceUnavailableError extends Error {
  public override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceUnavailableError";
    this.cause = cause;
  }
}

export class PersistenceConflictError extends Error {
  public readonly expectedRevision: bigint | null;
  public readonly actualRevision: bigint;

  constructor(expectedRevision: bigint | null, actualRevision: bigint) {
    super(`persistent state revision conflict: expected ${expectedRevision?.toString() ?? "empty"}, actual ${actualRevision.toString()}`);
    this.name = "PersistenceConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** A deterministic product SKU collision rejected by the normalized owner table. */
export class PersistenceProductSkuConflictError extends Error {
  constructor() {
    super("product SKU is already registered for this organization");
    this.name = "PersistenceProductSkuConflictError";
  }
}

export class PersistenceCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceCorruptionError";
  }
}

export class OutboxLeaseLostError extends Error {
  constructor(message = "outbox lease is no longer owned by this worker") {
    super(message);
    this.name = "OutboxLeaseLostError";
  }
}

export class PersistenceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceStateError";
  }
}

export class PersistenceSignatureError extends PersistenceStateError {
  constructor(message = "inbox event signature is invalid") {
    super(message);
    this.name = "PersistenceSignatureError";
  }
}
