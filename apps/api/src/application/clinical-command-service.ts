import type { ClinicalDocument, CvgContext, OpaqueId } from "@cvg/contracts";
import { type CvgStore } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

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
  constructor(private readonly repository: ClinicalSignRepository) {}

  async sign(context: CvgContext, documentId: OpaqueId, expectedVersion: string): Promise<ClinicalDocument> {
    enforceApplicationPolicy(context, "clinical.sign", { resourceId: documentId });
    return this.repository.sign(context, documentId, expectedVersion);
  }
}
