import type { Appointment, AppointmentInput, CvgContext } from "@cvg/contracts";
import { type CvgStore } from "@cvg/domain";
import { enforceApplicationPolicy } from "@cvg/agent-policy";

/** Repository port for appointment commands. Persistence details stay below the application boundary. */
export interface AppointmentRepository {
  create(context: CvgContext, input: AppointmentInput): Promise<Appointment>;
}

export class StoreAppointmentRepository implements AppointmentRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: AppointmentInput): Promise<Appointment> {
    return this.store.createAppointment(context, input);
  }
}

export class PostgresAppointmentRepository implements AppointmentRepository {
  constructor(private readonly store: CvgStore) {}

  async create(context: CvgContext, input: AppointmentInput): Promise<Appointment> {
    // The request commit owns the PostgreSQL transaction and receives the
    // returned appointment as its command-owned normalized write.
    return this.store.createAppointment(context, input);
  }
}

export class AppointmentApplicationService {
  constructor(private readonly repository: AppointmentRepository) {}

  async create(context: CvgContext, input: AppointmentInput): Promise<Appointment> {
    enforceApplicationPolicy(context, "appointments.create", { resourceId: input.patientId });
    return this.repository.create(context, input);
  }
}
