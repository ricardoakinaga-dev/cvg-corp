import { AUTHORITATIVE_DOMAIN_REGISTRY } from "@cvg/contracts";
import { digest } from "@cvg/domain";

/**
 * CVG-AUD26-016: the migration contract is deliberately independent from a
 * particular table implementation.  A slice can therefore dual-write while
 * it proves equivalence, then switch its read owner without making the
 * snapshot itself a hidden second command bus.
 */
export type SnapshotMigrationAuthority = "COMMAND_AUTHORITATIVE" | "SNAPSHOT_PRIMARY";
export type SnapshotMigrationLifecycle = "FRAMEWORK_READY" | "BACKFILL" | "DUAL_WRITE" | "CUTOVER" | "RECONCILED" | "RETIRED";

export type SnapshotMigrationDefinition = {
  snapshotKey: string;
  table: string;
  scope: string;
  owner: string;
  authority: SnapshotMigrationAuthority;
  lifecycle: SnapshotMigrationLifecycle;
  command: string;
  aggregate: string;
  aggregateVersion: number;
  idempotencyKey: string;
  authorization: string;
  transaction: "organization-transaction";
  eventType: "DOMAIN_COMMAND_APPLIED";
  reconciliation: "count-digest-invariants";
};

const existingCommandOwners = new Set([
  "guardians",
  "patients",
  "appointments",
  "encounters",
  "clinicalDocuments",
  "diagnosticRequests",
  "specimens",
  "diagnosticResults"
]);

const commandName = (snapshotKey: string): string => snapshotKey.replace(/[A-Z]/g, (character) => `.${character.toLowerCase()}`);
const aggregateName = (snapshotKey: string): string => `${snapshotKey.slice(0, 1).toUpperCase()}${snapshotKey.slice(1)}`;

/**
 * The complete 32-collection inventory.  The eight existing normalized
 * command paths are explicitly marked as authoritative; the remaining 24
 * stay visible as debt until their slice has passed backfill, concurrency,
 * replay, authorization and reconciliation evidence.
 */
export const SNAPSHOT_MIGRATION_PLAN: readonly SnapshotMigrationDefinition[] = AUTHORITATIVE_DOMAIN_REGISTRY.map((entry) => {
  const authority: SnapshotMigrationAuthority = existingCommandOwners.has(entry.snapshotKey) ? "COMMAND_AUTHORITATIVE" : "SNAPSHOT_PRIMARY";
  const lifecycle: SnapshotMigrationLifecycle = authority === "COMMAND_AUTHORITATIVE" ? "RECONCILED" : "FRAMEWORK_READY";
  return {
    snapshotKey: entry.snapshotKey,
    table: entry.table,
    scope: entry.scope,
    owner: entry.scope === "contextual" ? `application/${entry.snapshotKey}` : `domain/${entry.snapshotKey}`,
    authority,
    lifecycle,
    command: `${commandName(entry.snapshotKey)}.upsert`,
    aggregate: aggregateName(entry.snapshotKey),
    aggregateVersion: 1,
    idempotencyKey: `cvg:${entry.snapshotKey}:organization:record`,
    authorization: `pdp:${entry.snapshotKey}:write`,
    transaction: "organization-transaction",
    eventType: "DOMAIN_COMMAND_APPLIED",
    reconciliation: "count-digest-invariants"
  };
});

export function snapshotMigrationCoverage(plan: readonly SnapshotMigrationDefinition[] = SNAPSHOT_MIGRATION_PLAN): {
  total: number;
  commandAuthoritative: number;
  snapshotPrimary: number;
  frameworkReady: number;
} {
  return {
    total: plan.length,
    commandAuthoritative: plan.filter((entry) => entry.authority === "COMMAND_AUTHORITATIVE").length,
    snapshotPrimary: plan.filter((entry) => entry.authority === "SNAPSHOT_PRIMARY").length,
    frameworkReady: plan.filter((entry) => entry.lifecycle === "FRAMEWORK_READY").length
  };
}

export function validateSnapshotMigrationPlan(plan: readonly SnapshotMigrationDefinition[] = SNAPSHOT_MIGRATION_PLAN): string[] {
  const findings: string[] = [];
  const expectedKeys = new Set<string>(AUTHORITATIVE_DOMAIN_REGISTRY.map((entry) => entry.snapshotKey));
  const seenKeys = new Set<string>();
  const seenTables = new Set<string>();
  for (const entry of plan) {
    if (seenKeys.has(entry.snapshotKey)) findings.push(`duplicate snapshot collection ${entry.snapshotKey}`);
    seenKeys.add(entry.snapshotKey);
    if (seenTables.has(entry.table)) findings.push(`duplicate normalized table ${entry.table}`);
    seenTables.add(entry.table);
    if (!entry.command.trim() || !entry.aggregate.trim() || entry.aggregateVersion < 1) findings.push(`${entry.snapshotKey} has no versioned command contract`);
    if (!entry.idempotencyKey.includes(entry.snapshotKey)) findings.push(`${entry.snapshotKey} idempotency key is not collection-scoped`);
    if (!entry.authorization.startsWith("pdp:")) findings.push(`${entry.snapshotKey} has no PDP authorization contract`);
    if (entry.transaction !== "organization-transaction") findings.push(`${entry.snapshotKey} is not bound to an organization transaction`);
    if (entry.eventType !== "DOMAIN_COMMAND_APPLIED") findings.push(`${entry.snapshotKey} has no durable domain event contract`);
    if (entry.reconciliation !== "count-digest-invariants") findings.push(`${entry.snapshotKey} has no reconciliation contract`);
  }
  for (const key of expectedKeys) if (!seenKeys.has(key)) findings.push(`missing snapshot collection ${key}`);
  for (const key of seenKeys) if (!expectedKeys.has(key)) findings.push(`unknown snapshot collection ${key}`);
  const coverage = snapshotMigrationCoverage(plan);
  if (coverage.total !== 32) findings.push(`expected 32 collections, found ${coverage.total}`);
  if (coverage.commandAuthoritative !== 8) findings.push(`expected 8 command-authoritative collections, found ${coverage.commandAuthoritative}`);
  if (coverage.snapshotPrimary !== 24) findings.push(`expected 24 snapshot-primary collections, found ${coverage.snapshotPrimary}`);
  return findings;
}

export type IdempotentMigrationOutcome = "APPLIED" | "REPLAY";

export type IdempotentMigrationInput<T> = {
  key: string;
  value: T;
  valueDigest?: string;
  authorize: () => void | Promise<void>;
  persist: (value: T, commandId: string) => void | Promise<void>;
  rollback?: () => void | Promise<void>;
};

/**
 * Small executable model of the database backfill contract.  Production
 * adapters wrap the same sequence in a SQL transaction and durable unique
 * idempotency key; the model makes replay, concurrency and rollback tests
 * deterministic without introducing a second persistence implementation.
 */
export class IdempotentMigrationCoordinator<T> {
  private readonly applied = new Map<string, { valueDigest: string; commandId: string }>();
  private readonly tails = new Map<string, Promise<void>>();

  async apply(input: IdempotentMigrationInput<T>): Promise<IdempotentMigrationOutcome> {
    if (!input.key.trim()) throw new Error("migration idempotency key is required");
    const valueDigest = input.valueDigest ?? digest(input.value);
    const previous = this.tails.get(input.key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(input.key, tail);
    await previous;
    try {
      const existing = this.applied.get(input.key);
      if (existing) {
        if (existing.valueDigest !== valueDigest) throw new Error(`migration idempotency conflict for ${input.key}`);
        return "REPLAY";
      }
      await input.authorize();
      const commandId = `migration:${input.key}`;
      try {
        await input.persist(input.value, commandId);
      } catch (error) {
        await input.rollback?.();
        throw error;
      }
      this.applied.set(input.key, { valueDigest, commandId });
      return "APPLIED";
    } finally {
      release();
      if (this.tails.get(input.key) === tail) this.tails.delete(input.key);
    }
  }

  get(key: string): { valueDigest: string; commandId: string } | null {
    return this.applied.get(key) ?? null;
  }
}

export function reconcileMigrationRecords<T>(snapshotRecords: readonly T[], commandRecords: readonly T[], canonicalize: (record: T) => unknown = (record) => record): {
  equal: boolean;
  snapshotCount: number;
  commandCount: number;
  snapshotDigest: string;
  commandDigest: string;
} {
  const snapshotDigest = digest(snapshotRecords.map(canonicalize));
  const commandDigest = digest(commandRecords.map(canonicalize));
  return { equal: snapshotRecords.length === commandRecords.length && snapshotDigest === commandDigest, snapshotCount: snapshotRecords.length, commandCount: commandRecords.length, snapshotDigest, commandDigest };
}
