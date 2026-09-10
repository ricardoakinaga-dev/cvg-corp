import type { CommandReceipt, CvgContext } from "@cvg/contracts";
import { DomainError, idempotentAsync, type CvgStore, type IdempotencyInput } from "@cvg/domain";
import type { PostgresPersistence } from "@cvg/persistence";

export type IdempotentCommandResult<T> = {
  receipt: CommandReceipt;
  value: T;
  replayed: boolean;
};

export type DurableIdempotencyFailureObserver = (input: {
  receiptId: string;
  error: unknown;
}) => void;

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
    private readonly observeSettlementFailure?: DurableIdempotencyFailureObserver
  ) {}

  async execute<T>(
    input: IdempotencyInput,
    work: () => T | Promise<T>
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
    if (claim?.status === "REPLAY") this.store.commandReceipts.set(claim.receipt.idempotencyLookup, claim.receipt);

    try {
      return await idempotentAsync(
        this.store,
        input,
        async () => await work(),
        claim?.status === "CLAIMED" ? { reservedReceipt: claim.receipt } : undefined
      );
    } catch (error) {
      if (claim?.status === "CLAIMED" && this.persistence) {
        try {
          // idempotentAsync has already moved the claimed receipt to a
          // terminal failure/unknown state. Persist that state before the
          // request can acknowledge the failed command.
          await this.persistence.settleCommandReceipt(claim.receipt);
        } catch (settlementError) {
          this.observeSettlementFailure?.({ receiptId: claim.receipt.id, error: settlementError });
          throw new DomainError("DEPENDENCY_UNAVAILABLE", "A falha da operação não pôde ser registrada duravelmente; nenhum sucesso deve ser inferido.", 503);
        }
      }
      throw error;
    }
  }
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
