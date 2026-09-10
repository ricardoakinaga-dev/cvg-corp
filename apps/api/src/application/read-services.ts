import type { AnimalPatient, Appointment, AuditRecord, CvgContext, Guardian, OpaqueId } from "@cvg/contracts";
import type { CvgStore } from "@cvg/domain";
import type { NormalizedAppointmentRead, PostgresPersistence } from "@cvg/persistence";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

export type PatientRead = AnimalPatient & { guardian: Pick<Guardian, "id" | "displayName" | "phone"> | null };
export type AppointmentRead = Appointment & { patient: { id: OpaqueId; name: string } | null; provider: string | null };

export interface GuardianReadRepository {
  list(context: CvgContext, query?: string): Promise<Guardian[]>;
}

export interface AppointmentReadRepository {
  list(context: CvgContext, range?: "today" | "week"): Promise<AppointmentRead[]>;
}

export interface AuditRepository {
  list(context: CvgContext, limit?: number, cursor?: string | null): Promise<AuditRecord[]>;
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

/** Read-side use cases select a repository behind one application boundary. */
export class ReadApplicationService {
  constructor(private readonly guardians: GuardianReadRepository, private readonly appointments: AppointmentReadRepository, private readonly audit: AuditRepository) {}

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
}

export function createReadApplicationService(store: CvgStore, persistence: PostgresPersistence | null): ReadApplicationService {
  return new ReadApplicationService(
    persistence ? new PostgresGuardianReadRepository(persistence) : new StoreGuardianReadRepository(store),
    persistence ? new PostgresAppointmentReadRepository(persistence) : new StoreAppointmentReadRepository(store),
    persistence ? new PostgresAuditRepository(persistence) : new StoreAuditRepository(store)
  );
}
