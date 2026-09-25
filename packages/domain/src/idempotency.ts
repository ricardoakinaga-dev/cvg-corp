import type { CommandReceipt, OpaqueId } from "@cvg/contracts";
import { DomainError } from "./errors.js";
import { digest, makeId, now } from "./primitives.js";

export interface IdempotencyInput {
  organizationId: OpaqueId;
  actorId: OpaqueId;
  /** Binds a command receipt to the authenticated session that created it. */
  sessionId?: OpaqueId | null;
  operation: string;
  key: string;
  resourceId: OpaqueId | null;
  unitId: OpaqueId | null;
  workspaceId: OpaqueId | null;
  body: unknown;
}

export type CommandReceiptPatch = Pick<Partial<CommandReceipt>, "status" | "result" | "completedAt" | "auditRecordId">;

/** Minimal receipt owner used by the command lifecycle; the domain store implements this seam. */
export interface CommandReceiptStore {
  readonly commandReceipts: ReadonlyMap<string, CommandReceipt>;
  setCommandReceipt(receipt: CommandReceipt): CommandReceipt;
  updateCommandReceipt(lookup: string, patch: CommandReceiptPatch): CommandReceipt;
}

export const COMMAND_CLAIM_LEASE_MS = 60_000;

export function newCommandReceipt(input: IdempotencyInput): CommandReceipt {
  return {
    id: makeId(),
    organizationId: input.organizationId,
    actorId: input.actorId,
    unitId: input.unitId,
    workspaceId: input.workspaceId,
    auditRecordId: null,
    operation: input.operation,
    idempotencyLookup: idempotencyLookup(input),
    bodyDigest: digest({ v: 1, body: input.body }),
    status: "IN_FLIGHT",
    result: null,
    createdAt: now(),
    completedAt: null,
    claimEpoch: 1,
    claimExpiresAt: new Date(Date.now() + COMMAND_CLAIM_LEASE_MS).toISOString(),
    dispatchState: "NOT_STARTED",
    failurePhase: null
  };
}

/**
 * Stable server-scoped identity per docs04 §7: organization, actor, operation,
 * key, resource and scope. The session is deliberately excluded so a re-login
 * still replays the original receipt instead of creating a second effect.
 * Absent optional scopes use an explicit marker so absence never degrades to a
 * null/empty mismatch.
 */
export function idempotencyLookup(input: IdempotencyInput): string {
  return digest({
    v: 3,
    organizationId: input.organizationId,
    actorId: input.actorId,
    operation: input.operation,
    key: input.key,
    resourceId: input.resourceId ?? "ABSENT",
    unitId: input.unitId ?? "ABSENT",
    workspaceId: input.workspaceId ?? "ABSENT"
  });
}

/** Legacy v2 lookup that included the session; read-only compatibility path. */
export function legacyIdempotencyLookup(input: IdempotencyInput): string {
  return digest({ v: 2, organizationId: input.organizationId, actorId: input.actorId, sessionId: input.sessionId ?? null, operation: input.operation, key: input.key, resourceId: input.resourceId, unitId: input.unitId, workspaceId: input.workspaceId });
}

export function commandReceiptLookups(input: IdempotencyInput): string[] {
  const stable = idempotencyLookup(input);
  const legacy = legacyIdempotencyLookup(input);
  return stable === legacy ? [stable] : [stable, legacy];
}

function findReceiptByLookups(store: CommandReceiptStore, input: IdempotencyInput): CommandReceipt | undefined {
  for (const lookup of commandReceiptLookups(input)) {
    const receipt = store.commandReceipts.get(lookup);
    if (receipt) return receipt;
  }
  return undefined;
}

/**
 * Resolves an existing receipt for a repeated command. An expired claim is
 * reconciled with its fence: an attempt that never crossed dispatch is
 * finalized as FAILED/PRE_DISPATCH, while a dispatched attempt stays unknown.
 */
export function resolveExistingReceipt(store: CommandReceiptStore, input: IdempotencyInput, existing: CommandReceipt): { receipt: CommandReceipt; replayed: boolean } {
  const bodyDigest = digest({ v: 1, body: input.body });
  if (existing.bodyDigest !== bodyDigest) throw new DomainError("IDEMPOTENCY_CONFLICT", "A chave já foi usada com outro corpo.", 409);
  if (existing.status === "SUCCEEDED") return { receipt: existing, replayed: true };
  if (existing.status === "FAILED") {
    const phase = existing.failurePhase === "PRE_DISPATCH" ? " (finalizada antes do dispatch)" : "";
    throw new DomainError("CONFLICT", `A execução anterior falhou${phase}; use uma nova intenção.`, 409, { receiptId: existing.id, failurePhase: existing.failurePhase ?? null });
  }
  if (existing.status === "OUTCOME_UNKNOWN") throw new DomainError("OUTCOME_UNKNOWN", "A execução anterior permanece em reconciliação; nenhum retry cego é permitido.", 409, { receiptId: existing.id });
  const expiresAt = existing.claimExpiresAt ? Date.parse(existing.claimExpiresAt) : Number.NaN;
  // Legacy claims without a deadline cannot prove that an owner is still alive.
  const expired = !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  if (!expired) throw new DomainError("ADMISSION_IN_PROGRESS", "A mesma chave já possui uma admissão em andamento.", 409, { receiptId: existing.id, claimExpiresAt: existing.claimExpiresAt ?? null });
  const notStarted = (existing.dispatchState ?? "NOT_STARTED") === "NOT_STARTED";
  const finalized = store.updateCommandReceipt(existing.idempotencyLookup, {
    status: notStarted ? "FAILED" : "OUTCOME_UNKNOWN",
    result: null,
    completedAt: now()
  });
  const settled: CommandReceipt = { ...finalized, claimExpiresAt: null, failurePhase: notStarted ? "PRE_DISPATCH" : "POST_DISPATCH" };
  store.setCommandReceipt(settled);
  if (notStarted) throw new DomainError("CLAIM_ABANDONED", "O claim expirou antes de qualquer dispatch e foi finalizado como falha segura.", 409, { receiptId: settled.id, failurePhase: "PRE_DISPATCH" });
  throw new DomainError("OUTCOME_UNKNOWN", "O claim expirou após possível dispatch; a execução permanece em reconciliação.", 409, { receiptId: settled.id, failurePhase: "POST_DISPATCH" });
}

function commandFailureState(receipt: CommandReceipt, error: unknown): { status: CommandReceipt["status"]; failurePhase: "PRE_DISPATCH" | "POST_DISPATCH" } {
  const dispatched = (receipt.dispatchState ?? "NOT_STARTED") === "DISPATCHED";
  const outcomeUnknown = dispatched || (error instanceof DomainError && error.code === "OUTCOME_UNKNOWN");
  return {
    status: outcomeUnknown ? "OUTCOME_UNKNOWN" : "FAILED",
    failurePhase: outcomeUnknown ? (dispatched ? "POST_DISPATCH" : receipt.failurePhase ?? "PRE_DISPATCH") : "PRE_DISPATCH"
  };
}

export function idempotent<T>(store: CommandReceiptStore, input: IdempotencyInput, execute: () => T): { receipt: CommandReceipt; value: T; replayed: boolean } {
  const existing = findReceiptByLookups(store, input);
  if (existing) {
    const resolved = resolveExistingReceipt(store, input, existing);
    if (resolved.replayed) return { receipt: resolved.receipt, value: resolved.receipt.result as T, replayed: true };
  }
  const receipt = newCommandReceipt(input);
  store.setCommandReceipt(receipt);
  try {
    const value = execute();
    const settled = store.updateCommandReceipt(receipt.idempotencyLookup, { status: "SUCCEEDED", result: value, completedAt: now() });
    const completed: CommandReceipt = { ...settled, claimExpiresAt: null, failurePhase: null };
    store.setCommandReceipt(completed);
    return { receipt: completed, value, replayed: false };
  } catch (error) {
    const failure = commandFailureState(receipt, error);
    const failed = store.updateCommandReceipt(receipt.idempotencyLookup, { status: failure.status, result: null, completedAt: now() });
    store.setCommandReceipt({ ...failed, claimExpiresAt: null, failurePhase: failure.failurePhase });
    throw error;
  }
}

export interface IdempotentAsyncOptions {
  /** A database-backed IN_FLIGHT receipt reserved before the command starts. */
  reservedReceipt?: CommandReceipt;
}

/** Runs one idempotent command whose implementation crosses an asynchronous adapter. */
export async function idempotentAsync<T>(store: CommandReceiptStore, input: IdempotencyInput, execute: () => Promise<T>, options: IdempotentAsyncOptions = {}): Promise<{ receipt: CommandReceipt; value: T; replayed: boolean }> {
  const bodyDigest = digest({ v: 1, body: input.body });
  const reservedReceipt = options.reservedReceipt;
  if (reservedReceipt && (!commandReceiptLookups(input).includes(reservedReceipt.idempotencyLookup) || reservedReceipt.bodyDigest !== bodyDigest || reservedReceipt.status !== "IN_FLIGHT")) throw new DomainError("INVALID_INPUT", "A reserva de idempotência não corresponde ao comando.", 400);
  const existing = findReceiptByLookups(store, input);
  if (existing && (!reservedReceipt || existing.id !== reservedReceipt.id)) {
    const resolved = resolveExistingReceipt(store, input, existing);
    if (resolved.replayed) return { receipt: resolved.receipt, value: resolved.receipt.result as T, replayed: true };
  }
  const claimed = reservedReceipt ?? newCommandReceipt(input);
  store.setCommandReceipt(claimed);
  try {
    const value = await execute();
    const settled = store.updateCommandReceipt(claimed.idempotencyLookup, { status: "SUCCEEDED", result: value, completedAt: now() });
    const completed: CommandReceipt = { ...settled, claimExpiresAt: null, failurePhase: null };
    store.setCommandReceipt(completed);
    return { receipt: completed, value, replayed: false };
  } catch (error) {
    const failure = commandFailureState(claimed, error);
    const failed = store.updateCommandReceipt(claimed.idempotencyLookup, { status: failure.status, result: null, completedAt: now() });
    store.setCommandReceipt({ ...failed, claimExpiresAt: null, failurePhase: failure.failurePhase });
    throw error;
  }
}
