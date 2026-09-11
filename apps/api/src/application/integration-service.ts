import { assertIntegrationCallbackAllowed } from "@cvg/agent-policy";
import type { DurableInboxInput, DurableInboxReceipt, DurableOutboxInput } from "@cvg/persistence";

/** Repository port for the signed provider callback boundary. */
export interface IntegrationInboxRepository {
  processInboxEvent(input: DurableInboxInput, outboxRecords?: DurableOutboxInput[]): Promise<DurableInboxReceipt>;
}
/**
 * Owns the public integration write. Signature metadata is admitted by the
 * policy registry before the persistence adapter can receive the event.
 */
export class IntegrationInboxApplicationService {
  constructor(private readonly repository: IntegrationInboxRepository) {}

  async receive(input: DurableInboxInput, outboxRecords: DurableOutboxInput[] = []): Promise<DurableInboxReceipt> {
    assertIntegrationCallbackAllowed({
      operation: "integration.inbox",
      provider: input.provider,
      signatureAlgorithm: input.signatureAlgorithm,
      signatureKeyRef: input.signatureKeyRef,
      signature: input.signature,
      ...(input.rawBody !== undefined ? { rawBody: input.rawBody } : {})
    });
    return this.repository.processInboxEvent(input, outboxRecords);
  }
}
