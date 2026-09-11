import type { ClinicalDocument, CvgContext, OpaqueId } from "@cvg/contracts";
import { type CvgStore } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";
import { PersistenceCorruptionError } from "@cvg/persistence";
import type { DurableIdempotencyService, IdempotentCommandResult } from "./idempotency-service.ts";

/** Repository port for the irreversible clinical-sign transition. */
export interface ClinicalSignRepository {
  sign(context: CvgContext, documentId: OpaqueId, expectedVersion: string): Promise<ClinicalDocument>;
}

export class StoreClinicalSignRepository implements ClinicalSignRepository {
  constructor(private readonly store: CvgStore) {}

  async sign(context: CvgContext, documentId: OpaqueId, expectedVersion: string): Promise<ClinicalDocument> {
    return this.store.signClinicalDocument(context, documentId, expectedVersion);
  }
}

export class PostgresClinicalSignRepository implements ClinicalSignRepository {
  constructor(private readonly store: CvgStore) {}

  async sign(context: CvgContext, documentId: OpaqueId, expectedVersion: string): Promise<ClinicalDocument> {
    // The request commit owns the PostgreSQL transaction and receives the
    // command-owned signed document as its authoritative normalized write.
    return this.store.signClinicalDocument(context, documentId, expectedVersion);
  }
}

export class ClinicalSignApplicationService {
  constructor(private readonly repository: ClinicalSignRepository, private readonly idempotency?: DurableIdempotencyService) {}

  async sign(context: CvgContext, documentId: OpaqueId, expectedVersion: string): Promise<ClinicalDocument> {
    enforceApplicationPolicy(context, "clinical.sign", { resourceId: documentId });
    return this.repository.sign(context, documentId, expectedVersion);
  }

  /**
   * The complete clinical-sign command boundary owns policy, durable claim,
   * replay validation and repository access.  The HTTP route only supplies
   * input and cannot claim a receipt directly.
   */
  async signIdempotent(context: CvgContext, documentId: OpaqueId, expectedVersion: string, key: string, body: unknown): Promise<IdempotentCommandResult<ClinicalDocument>> {
    enforceApplicationPolicy(context, "clinical.sign", { resourceId: documentId });
    if (!this.idempotency) throw new Error("clinical sign idempotency service is not configured");
    const result = await this.idempotency.execute({
      organizationId: context.organizationId,
      actorId: context.actorId,
      sessionId: context.sessionId,
      operation: "clinical.sign",
      key,
      resourceId: documentId,
      unitId: context.unitId,
      workspaceId: context.workspaceId,
      body
    }, () => this.repository.sign(context, documentId, expectedVersion));
    if (result.replayed) {
      const value = result.value;
      if (!value || typeof value !== "object" || Array.isArray(value) || value.id !== documentId || value.status !== "SIGNED") throw new PersistenceCorruptionError(`command receipt ${result.receipt.id} has an invalid clinical signing result`);
    }
    return result;
  }
}
