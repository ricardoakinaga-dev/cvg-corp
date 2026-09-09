import type { AnimalPatient, CvgContext, PatientInput, OpaqueId } from "@cvg/contracts";
import { DomainError, type CvgStore } from "@cvg/domain";
import type { PostgresPersistence } from "@cvg/persistence";

export type PatientProjectionItem = AnimalPatient & { guardian: { id: OpaqueId; displayName: string; phone: string } | null };
export type PatientProjection = PatientProjectionItem[];

/** Repository port. HTTP routes depend on this contract, never on persistence internals. */
export interface PatientRepository {
  list(context: CvgContext, query?: string): Promise<PatientProjection>;
  get(context: CvgContext, patientId: OpaqueId): Promise<PatientProjectionItem | null>;
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

  async get(context: CvgContext, patientId: OpaqueId): Promise<PatientProjectionItem | null> {
    try {
      const patient = this.store.findPatient(context, patientId);
      const guardian = this.store.guardians.get(patient.guardianId);
      return guardian ? { ...patient, guardian: { id: guardian.id, displayName: guardian.displayName, phone: guardian.phone } } : { ...patient, guardian: null };
    } catch (error) {
      if (error instanceof DomainError && (error.code === "NOT_FOUND" || error.code === "POLICY_DENIED")) return null;
      throw error;
    }
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

  async get(context: CvgContext, patientId: OpaqueId): Promise<PatientProjectionItem | null> {
    const patients = await this.persistence.listPatients(context);
    return patients.find((patient) => patient.id === patientId) ?? null;
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

  get(context: CvgContext, patientId: OpaqueId): Promise<PatientProjectionItem | null> {
    return this.repository.get(context, patientId);
  }

  create(context: CvgContext, input: PatientInput): AnimalPatient {
    return this.repository.create(context, input);
  }
}
