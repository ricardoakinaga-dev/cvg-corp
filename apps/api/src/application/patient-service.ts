import type { AnimalPatient, CvgContext, PatientInput, OpaqueId } from "@cvg/contracts";
import type { CvgStore } from "@cvg/domain";
import type { PostgresPersistence } from "@cvg/persistence";

export type PatientProjection = Array<AnimalPatient & { guardian: { id: OpaqueId; displayName: string; phone: string } | null }>;

/** Repository port. HTTP routes depend on this contract, never on persistence internals. */
export interface PatientRepository {
  list(context: CvgContext, query?: string): Promise<PatientProjection>;
  create(context: CvgContext, input: PatientInput): AnimalPatient;
}

export interface UnitOfWork {
  run<T>(context: CvgContext, operation: string, work: () => Promise<T>): Promise<T>;
}

export class StorePatientRepository implements PatientRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext, query = ""): Promise<PatientProjection> {
    return this.store.listPatients(context, query);
  }

  create(context: CvgContext, input: PatientInput): AnimalPatient {
    return this.store.createPatient(context, input);
  }
}

export class PostgresPatientRepository implements PatientRepository {
  constructor(private readonly persistence: PostgresPersistence, private readonly store: CvgStore) {}

  list(context: CvgContext, query = ""): Promise<PatientProjection> {
    return this.persistence.listPatients(context, query);
  }

  create(context: CvgContext, input: PatientInput): AnimalPatient {
    return this.store.createPatient(context, input);
  }
}

export class PatientApplicationService {
  constructor(private readonly repository: PatientRepository) {}

  list(context: CvgContext, query?: string): Promise<PatientProjection> {
    return this.repository.list(context, query);
  }

  create(context: CvgContext, input: PatientInput): AnimalPatient {
    return this.repository.create(context, input);
  }
}
