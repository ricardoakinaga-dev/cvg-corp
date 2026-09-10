import type { AnimalPatient, Appointment, AuditRecord, ClinicalDocument, CvgContext, Encounter, Guardian, OpaqueId } from "@cvg/contracts";
import type { CvgStore } from "@cvg/domain";
import type { NormalizedAppointmentRead, NormalizedEncounterRead, PostgresPersistence } from "@cvg/persistence";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

export type PatientRead = AnimalPatient & { guardian: Pick<Guardian, "id" | "displayName" | "phone"> | null };
export type AppointmentRead = Appointment & { patient: { id: OpaqueId; name: string } | null; provider: string | null };
export type EncounterRead = Encounter & { patient: { id: OpaqueId; name: string } };

export interface GuardianReadRepository {
  list(context: CvgContext, query?: string): Promise<Guardian[]>;
}

export interface AppointmentReadRepository {
  list(context: CvgContext, range?: "today" | "week"): Promise<AppointmentRead[]>;
}

export interface AuditRepository {
  list(context: CvgContext, limit?: number, cursor?: string | null): Promise<AuditRecord[]>;
}

export interface EncounterRepository {
  list(context: CvgContext): Promise<EncounterRead[]>;
}

export interface ClinicalRepository {
  list(context: CvgContext): Promise<ClinicalDocument[]>;
}

class StoreGuardianReadRepository implements GuardianReadRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext, query = ""): Promise<Guardian[]> {
    return this.store.listGuardians(context, query);
  }
}

class PostgresGuardianReadRepository implements GuardianReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext, query = ""): Promise<Guardian[]> {
    return this.persistence.listGuardians(context, query);
  }
}

class StoreAppointmentReadRepository implements AppointmentReadRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext, range: "today" | "week" = "today"): Promise<AppointmentRead[]> {
    return this.store.listAppointments(context, range).map((appointment) => ({
      ...appointment,
      patient: this.store.patients.get(appointment.patientId) ? { id: appointment.patientId, name: this.store.patients.get(appointment.patientId)!.name } : null,
      provider: this.store.providers.get(appointment.providerId)?.displayName ?? null
    }));
  }
}

class PostgresAppointmentReadRepository implements AppointmentReadRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  async list(context: CvgContext, range: "today" | "week" = "today"): Promise<NormalizedAppointmentRead[]> {
    return this.persistence.listAppointments(context, range);
  }
}

class StoreAuditRepository implements AuditRepository {
  constructor(private readonly store: CvgStore) {}

  list(context: CvgContext, limit = 25, cursor: string | null = null): Promise<AuditRecord[]> {
    return Promise.resolve(this.store.listAudit(context, limit, cursor));
  }
}

class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext, limit = 25, cursor: string | null = null): Promise<AuditRecord[]> {
    return this.persistence.listAudit(context, limit, cursor);
  }
}

class StoreEncounterRepository implements EncounterRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext): Promise<EncounterRead[]> {
    return this.store.listEncounters(context).map((encounter) => {
      const patient = this.store.patients.get(encounter.patientId);
      if (!patient) throw new Error(`encounter ${encounter.id} has no patient projection`);
      return { ...encounter, patient: { id: patient.id, name: patient.name } };
    });
  }
}

class PostgresEncounterRepository implements EncounterRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<NormalizedEncounterRead[]> {
    return this.persistence.listEncounters(context);
  }
}

class StoreClinicalRepository implements ClinicalRepository {
  constructor(private readonly store: CvgStore) {}

  async list(context: CvgContext): Promise<ClinicalDocument[]> {
    this.store.requireRole(context, ["admin", "veterinario"], "clinical:read");
    return [...this.store.clinicalDocuments.values()]
      .filter((document) => {
        const encounter = this.store.encounters.get(document.encounterId);
        return document.organizationId === context.organizationId && Boolean(encounter) && (!context.unitId || encounter!.unitId === context.unitId) && (!context.workspaceId || encounter!.workspaceId === context.workspaceId);
      })
      .map((document) => ({ ...document }));
  }
}

class PostgresClinicalRepository implements ClinicalRepository {
  constructor(private readonly persistence: PostgresPersistence) {}

  list(context: CvgContext): Promise<ClinicalDocument[]> {
    return this.persistence.listClinicalDocuments(context);
  }
}

/** Read-side use cases select a repository behind one application boundary. */
export class ReadApplicationService {
  constructor(private readonly guardians: GuardianReadRepository, private readonly appointments: AppointmentReadRepository, private readonly audit: AuditRepository, private readonly encounters: EncounterRepository, private readonly clinical: ClinicalRepository) {}

  listGuardians(context: CvgContext, query?: string): Promise<Guardian[]> {
    enforceApplicationPolicy(context, "guardians.read");
    return this.guardians.list(context, query);
  }

  listAppointments(context: CvgContext, range: "today" | "week" = "today"): Promise<AppointmentRead[]> {
    enforceApplicationPolicy(context, "appointments.read");
    return this.appointments.list(context, range);
  }

  listAudit(context: CvgContext, limit = 25, cursor: string | null = null): Promise<AuditRecord[]> {
    enforceApplicationPolicy(context, "audit.read");
    return this.audit.list(context, limit, cursor);
  }

  listEncounters(context: CvgContext): Promise<EncounterRead[]> {
    enforceApplicationPolicy(context, "encounters.read");
    return this.encounters.list(context);
  }

  listClinicalDocuments(context: CvgContext): Promise<ClinicalDocument[]> {
    enforceApplicationPolicy(context, "clinical.read");
    return this.clinical.list(context);
  }
}

export function createReadApplicationService(store: CvgStore, persistence: PostgresPersistence | null): ReadApplicationService {
  return new ReadApplicationService(
    persistence ? new PostgresGuardianReadRepository(persistence) : new StoreGuardianReadRepository(store),
    persistence ? new PostgresAppointmentReadRepository(persistence) : new StoreAppointmentReadRepository(store),
    persistence ? new PostgresAuditRepository(persistence) : new StoreAuditRepository(store),
    persistence ? new PostgresEncounterRepository(persistence) : new StoreEncounterRepository(store),
    persistence ? new PostgresClinicalRepository(persistence) : new StoreClinicalRepository(store)
  );
}
