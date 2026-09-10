import type { CvgContext, DiagnosticRequest, DiagnosticRequestInput, DiagnosticResult, ResultInput, Specimen } from "@cvg/contracts";
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

/** Repository port for specimen commands; persistence owns the transaction. */
export interface DiagnosticSpecimenRepository {
  create(context: CvgContext, requestId: Parameters<CvgStore["createSpecimen"]>[1], label: string): Promise<Specimen>;
}

export class StoreDiagnosticSpecimenRepository implements DiagnosticSpecimenRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, requestId: Parameters<CvgStore["createSpecimen"]>[1], label: string): Promise<Specimen> {
    return this.store.createSpecimen(context, requestId, label);
  }
}

export class PostgresDiagnosticSpecimenRepository implements DiagnosticSpecimenRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, requestId: Parameters<CvgStore["createSpecimen"]>[1], label: string): Promise<Specimen> {
    // The request commit receives this command-owned row and writes it to the
    // normalized table in the same transaction as the canonical snapshot.
    return this.store.createSpecimen(context, requestId, label);
  }
}

export class DiagnosticSpecimenApplicationService {
  constructor(private readonly repository: DiagnosticSpecimenRepository) {}

  async create(context: CvgContext, requestId: Parameters<CvgStore["createSpecimen"]>[1], label: string): Promise<Specimen> {
    enforceApplicationPolicy(context, "diagnostics.specimen", { resourceId: requestId });
    return this.repository.create(context, requestId, label);
  }
}

/** Repository port for diagnostic result commands; persistence owns the transaction. */
export interface DiagnosticResultRepository {
  create(context: CvgContext, input: ResultInput): Promise<DiagnosticResult>;
}

export class StoreDiagnosticResultRepository implements DiagnosticResultRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: ResultInput): Promise<DiagnosticResult> {
    return this.store.createResult(context, input);
  }
}

export class PostgresDiagnosticResultRepository implements DiagnosticResultRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: ResultInput): Promise<DiagnosticResult> {
    // The request commit receives this command-owned row and writes it to the
    // normalized table in the same transaction as the canonical snapshot.
    return this.store.createResult(context, input);
  }
}

export class DiagnosticResultApplicationService {
  constructor(private readonly repository: DiagnosticResultRepository) {}

  async create(context: CvgContext, input: ResultInput): Promise<DiagnosticResult> {
    enforceApplicationPolicy(context, "diagnostics.result", { resourceId: input.requestId });
    return this.repository.create(context, input);
  }
}
