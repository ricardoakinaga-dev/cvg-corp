import type { CommandReceipt, CvgContext } from "@cvg/contracts";
import { DomainError, digest, idempotentAsync, idempotencyLookup, newCommandReceipt, now, type CvgStore, type IdempotencyInput } from "@cvg/domain";
import type { PostgresPersistence } from "@cvg/persistence";
import { KeyedAsyncCoordinator } from "./keyed-coordinator.ts";

export type IdempotentCommandResult<T> = {
  receipt: CommandReceipt;
  value: T;
  replayed: boolean;
};

export type DurableIdempotencyFailureObserver = (input: {
  receiptId: string;
  error: unknown;
}) => void;

export interface DurableIdempotencyExecutionOptions {
  /**
   * The callback crosses a provider/remote runtime boundary.  It must run
   * outside the local organization coordinator; only its durable result is
   * admitted under the short local critical section afterwards.
   */
  external?: boolean;
}

/**
 * Owns the command idempotency boundary for API mutations.
 *
 * In memory mode this delegates to the domain receipt map. When PostgreSQL is
 * configured, the unique durable claim is made before the command callback is
 * allowed to run. A second process therefore observes IN_FLIGHT/terminal state
 * instead of entering the mutation or remote adapter a second time.
 */
export class DurableIdempotencyService {
  constructor(
    private readonly store: CvgStore,
    private readonly persistence: PostgresPersistence | null,
    private readonly observeSettlementFailure?: DurableIdempotencyFailureObserver,
    private readonly coordinator = new KeyedAsyncCoordinator()
  ) {}

  async execute<T>(
    input: IdempotencyInput,
    work: () => T | Promise<T>,
    options: DurableIdempotencyExecutionOptions = {}
  ): Promise<IdempotentCommandResult<T>> {
    const claim = this.persistence ? await this.persistence.claimCommandReceipt(input) : null;
    if (claim?.status === "CONFLICT") {
      throw new DomainError("IDEMPOTENCY_CONFLICT", "A chave já foi usada com outro corpo.", 409);
    }
    if (claim?.status === "IN_FLIGHT" || claim?.status === "OUTCOME_UNKNOWN") {
      throw new DomainError("OUTCOME_UNKNOWN", "A execução anterior permanece em reconciliação.", 409, { receiptId: claim.receipt.id });
    }
    if (claim?.status === "FAILED") {
      throw new DomainError("CONFLICT", "A execução anterior falhou; use uma nova intenção.", 409);
    }

    // Hydrate a durable replay into the process-local index so the domain
    // helper returns the recorded value without invoking the callback.
    if (claim?.status === "REPLAY") this.store.setCommandReceipt(claim.receipt);

    if (options.external && (claim?.status === "REPLAY" || (!claim && this.store.commandReceipts.has(idempotencyLookup(input))))) {
      // Resolve a replay before the remote callback is even considered.  A
      // stable idempotency key must never spend a second provider call.
      return this.replayWithoutDispatch(input);
    }
    if (options.external) return this.executeExternal(input, work, claim);
    return this.executeLocal(input, work, claim);
  }

  /**
   * Final commit failures happen after the command callback has already
   * returned `SUCCEEDED`.  Convert that local success into a durable unknown
   * outcome so a later retry can reconcile it instead of observing a
   * permanently stuck `IN_FLIGHT` claim.
   */
  async markOutcomeUnknown(receipt: CommandReceipt): Promise<CommandReceipt> {
    const unknown: CommandReceipt = { ...receipt, status: "OUTCOME_UNKNOWN", result: null, completedAt: receipt.completedAt ?? now(), auditRecordId: null };
    await this.coordinator.run(this.scopeKey(receipt.organizationId), () => {
      this.store.setCommandReceipt(unknown);
    });
    if (this.persistence) {
      try {
        await this.persistence.settleCommandReceipt(unknown);
      } catch (settlementError) {
        this.observeSettlementFailure?.({ receiptId: receipt.id, error: settlementError });
        throw new DomainError("DEPENDENCY_UNAVAILABLE", "A falha da operação não pôde ser registrada duravelmente; nenhum sucesso deve ser inferido.", 503);
      }
    }
    return unknown;
  }

  private scopeKey(organizationId: string): string {
    return `organization:${organizationId}`;
  }

  private async executeLocal<T>(
    input: IdempotencyInput,
    work: () => T | Promise<T>,
    claim: Awaited<ReturnType<PostgresPersistence["claimCommandReceipt"]>> | null
  ): Promise<IdempotentCommandResult<T>> {
    try {
      const result = await this.coordinator.run(this.scopeKey(input.organizationId), () => idempotentAsync(
        this.store,
        input,
        async () => await work(),
        claim?.status === "CLAIMED" ? { reservedReceipt: claim.receipt } : undefined
      ));
      if (claim?.status === "CLAIMED") syncReceipt(claim.receipt, result.receipt);
      return result;
    } catch (error) {
      if (claim?.status === "CLAIMED" && this.persistence) await this.settleClaimFailure(claim.receipt, error);
      throw error;
    }
  }

  private async executeExternal<T>(
    input: IdempotencyInput,
    work: () => T | Promise<T>,
    claim: Awaited<ReturnType<PostgresPersistence["claimCommandReceipt"]>> | null
  ): Promise<IdempotentCommandResult<T>> {
    const effectiveClaim = claim ?? await this.claimInMemory(input);
    if (effectiveClaim.status === "REPLAY") return this.replayWithoutDispatch(input);
    let value: T;
    try {
      // No local lock is held while the remote/provider callback runs.
      value = await work();
    } catch (error) {
      if (effectiveClaim.status === "CLAIMED") await this.settleClaimFailure(effectiveClaim.receipt, error);
      throw error;
    }
    const result = await this.coordinator.run(this.scopeKey(input.organizationId), () => idempotentAsync(
      this.store,
      input,
      async () => value,
      { reservedReceipt: effectiveClaim.receipt }
    ));
    syncReceipt(effectiveClaim.receipt, result.receipt);
    return result;
  }

  private replayWithoutDispatch<T>(input: IdempotencyInput): Promise<IdempotentCommandResult<T>> {
    return this.coordinator.run(this.scopeKey(input.organizationId), () => idempotentAsync(this.store, input, async () => {
      throw new DomainError("INTERNAL_ERROR", "idempotency replay preflight unexpectedly dispatched", 500);
    }));
  }

  private claimInMemory(input: IdempotencyInput): Promise<{ status: "CLAIMED" | "REPLAY"; receipt: CommandReceipt }> {
    return this.coordinator.run(this.scopeKey(input.organizationId), () => {
      const lookup = idempotencyLookup(input);
      const bodyDigest = digest({ v: 1, body: input.body });
      const existing = this.store.commandReceipts.get(lookup);
      if (!existing) {
        const receipt = newCommandReceipt(input);
        this.store.setCommandReceipt(receipt);
        return { status: "CLAIMED" as const, receipt };
      }
      if (existing.bodyDigest !== bodyDigest) throw new DomainError("IDEMPOTENCY_CONFLICT", "A chave já foi usada com outro corpo.", 409);
      if (existing.status === "SUCCEEDED") return { status: "REPLAY" as const, receipt: existing };
      if (existing.status === "IN_FLIGHT" || existing.status === "OUTCOME_UNKNOWN") throw new DomainError("OUTCOME_UNKNOWN", "A execução anterior permanece em reconciliação.", 409, { receiptId: existing.id });
      throw new DomainError("CONFLICT", "A execução anterior falhou; use uma nova intenção.", 409);
    });
  }

  private async settleClaimFailure(receipt: CommandReceipt, error: unknown): Promise<void> {
    const settled: CommandReceipt = {
      ...receipt,
      status: error instanceof DomainError && error.code === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "FAILED",
      result: null,
      completedAt: now()
    };
    await this.coordinator.run(this.scopeKey(receipt.organizationId), () => {
      syncReceipt(receipt, settled);
      this.store.setCommandReceipt(settled);
    });
    try {
      await this.persistence?.settleCommandReceipt(settled);
    } catch (settlementError) {
      this.observeSettlementFailure?.({ receiptId: receipt.id, error: settlementError });
      throw new DomainError("DEPENDENCY_UNAVAILABLE", "A falha da operação não pôde ser registrada duravelmente; nenhum sucesso deve ser inferido.", 503);
    }
  }
}

/** Keeps an adapter claim object current without exposing the store backing record. */
function syncReceipt(target: CommandReceipt, source: CommandReceipt): void {
  Object.assign(target, structuredClone(source));
}

/** Builds the canonical command input for an authenticated request. */
export function commandInput(
  context: CvgContext,
  operation: string,
  key: string,
  resourceId: IdempotencyInput["resourceId"],
  body: unknown,
  scope: Pick<IdempotencyInput, "unitId" | "workspaceId"> = context
): IdempotencyInput {
  return {
    organizationId: context.organizationId,
    actorId: context.actorId,
    sessionId: context.sessionId,
    operation,
    key,
    resourceId,
    unitId: scope.unitId,
    workspaceId: scope.workspaceId,
    body
  };
}
