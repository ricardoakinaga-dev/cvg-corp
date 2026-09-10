import type { CvgContext, DiagnosticRequest, DiagnosticRequestInput } from "@cvg/contracts";
import { type CvgStore } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

/** Repository port for diagnostic-request commands; persistence owns the transaction. */
export interface DiagnosticRequestRepository {
  create(context: CvgContext, input: DiagnosticRequestInput): Promise<DiagnosticRequest>;
}

export class StoreDiagnosticRequestRepository implements DiagnosticRequestRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: DiagnosticRequestInput): Promise<DiagnosticRequest> {
    return this.store.createDiagnosticRequest(context, input);
  }
}

export class PostgresDiagnosticRequestRepository implements DiagnosticRequestRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: DiagnosticRequestInput): Promise<DiagnosticRequest> {
    // The request commit receives this command-owned row and writes it to the
    // normalized table in the same transaction as the canonical snapshot.
    return this.store.createDiagnosticRequest(context, input);
  }
}

export class DiagnosticRequestApplicationService {
  constructor(private readonly repository: DiagnosticRequestRepository) {}

  async create(context: CvgContext, input: DiagnosticRequestInput): Promise<DiagnosticRequest> {
    enforceApplicationPolicy(context, "diagnostics.create", { resourceId: input.patientId });
    return this.repository.create(context, input);
  }
}
