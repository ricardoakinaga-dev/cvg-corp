import type { PoolClient } from "pg";
import { appointmentRangeBounds } from "@cvg/domain";
import type { Appointment, AppointmentRange, CvgContext, Guardian, OpaqueId } from "@cvg/contracts";
import type { NormalizedAppointmentRead, NormalizedPatientRead, NormalizedQueueRead } from "./index.js";

type SqlTimestamp = string | Date | null;

export interface NormalizedEarlyReadDependencies {
  scopedRead<T>(context: CvgContext, operation: string, callback: (client: PoolClient) => Promise<T>): Promise<T>;
  id(value: unknown, field: string): OpaqueId;
  text(value: unknown, field: string): string;
  timestamp(value: SqlTimestamp, field: string): string;
  nullableTimestamp(value: SqlTimestamp): string | null;
  stringArray(value: unknown, field: string): string[];
  enum<T extends string>(value: unknown, allowed: readonly T[], field: string): T;
  corruption(message: string): Error;
}

export function listGuardians(dependencies: NormalizedEarlyReadDependencies, context: CvgContext, query = ""): Promise<Guardian[]> {
  const normalized = query.trim();
  return dependencies.scopedRead(context, "guardians", async (client) => {
    const result = await client.query<{
      id: string;
      unit_id: string | null;
      workspace_id: string | null;
      display_name: string;
      phone: string;
      email: string | null;
      data_class: "D2";
      status: "ACTIVE" | "INACTIVE";
    }>(
      "select g.id::text as id, g.unit_id::text as unit_id, g.workspace_id::text as workspace_id, g.display_name, g.phone, g.email, g.data_class, g.status from guardians g where g.organization_id = cvg_request_organization() and g.status = 'ACTIVE' and ($1::text = '' or g.display_name ilike '%' || $1 || '%' or g.phone ilike '%' || $1 || '%' or coalesce(g.email, '') ilike '%' || $1 || '%') and ($2::uuid is null or ((g.unit_id = $2::uuid) and ($3::uuid is null or g.workspace_id = $3::uuid)) or exists (select 1 from patients p where p.organization_id = g.organization_id and p.guardian_id = g.id and p.status = 'ACTIVE' and p.unit_id = $2::uuid and ($3::uuid is null or p.workspace_id = $3::uuid))) order by lower(g.display_name), g.id",
      [normalized, context.unitId, context.workspaceId]
    );
    return result.rows.map((row) => ({ id: dependencies.id(row.id, "guardian.id"), organizationId: context.organizationId, unitId: row.unit_id ? dependencies.id(row.unit_id, "guardian.unit_id") : null, workspaceId: row.workspace_id ? dependencies.id(row.workspace_id, "guardian.workspace_id") : null, displayName: dependencies.text(row.display_name, "guardian.display_name"), phone: dependencies.text(row.phone, "guardian.phone"), email: row.email, dataClass: row.data_class, status: row.status }));
  });
}

export function listPatients(dependencies: NormalizedEarlyReadDependencies, context: CvgContext, query = ""): Promise<NormalizedPatientRead[]> {
  const normalized = query.trim();
  return dependencies.scopedRead(context, "patients", async (client) => {
    const result = await client.query<{
      id: string;
      unit_id: string | null;
      workspace_id: string | null;
      guardian_id: string;
      name: string;
      species: string;
      breed: string | null;
      sex: "FEMALE" | "MALE" | "UNKNOWN";
      reproductive_status: "INTACT" | "NEUTERED" | "UNKNOWN";
      birth_date: string | null;
      identifiers: unknown;
      data_class: "D3";
      status: "ACTIVE" | "INACTIVE" | "MERGED";
      merged_into_id: string | null;
      status_changed_at: SqlTimestamp;
      created_at: SqlTimestamp;
      guardian_display_name: string | null;
      guardian_phone: string | null;
    }>(
      "select p.id::text as id, p.unit_id::text as unit_id, p.workspace_id::text as workspace_id, p.guardian_id::text as guardian_id, p.name, p.species, p.breed, p.sex, p.reproductive_status, to_char(p.birth_date, 'YYYY-MM-DD') as birth_date, p.identifiers, p.data_class, p.status, p.merged_into_id::text as merged_into_id, p.status_changed_at, p.created_at, g.display_name as guardian_display_name, g.phone as guardian_phone from patients p left join guardians g on g.id = p.guardian_id and g.organization_id = p.organization_id where p.organization_id = cvg_request_organization() and p.status = 'ACTIVE' and ($1::text = '' or p.name ilike '%' || $1 || '%' or p.species ilike '%' || $1 || '%' or coalesce(p.breed, '') ilike '%' || $1 || '%') and ($2::uuid is null or (p.unit_id = $2::uuid and ($3::uuid is null or p.workspace_id = $3::uuid)) or exists (select 1 from appointments a where a.organization_id = p.organization_id and a.patient_id = p.id and a.unit_id = $2::uuid and ($3::uuid is null or a.workspace_id = $3::uuid)) or exists (select 1 from encounters e where e.organization_id = p.organization_id and e.patient_id = p.id and e.unit_id = $2::uuid and ($3::uuid is null or e.workspace_id = $3::uuid)) or exists (select 1 from communication_messages m where m.organization_id = p.organization_id and m.patient_id = p.id and m.unit_id = $2::uuid and ($3::uuid is null or m.workspace_id = $3::uuid))) order by lower(p.name), p.id",
      [normalized, context.unitId, context.workspaceId]
    );
    return result.rows.map((row) => ({
      id: dependencies.id(row.id, "patient.id"), organizationId: context.organizationId,
      unitId: row.unit_id ? dependencies.id(row.unit_id, "patient.unit_id") : null,
      workspaceId: row.workspace_id ? dependencies.id(row.workspace_id, "patient.workspace_id") : null,
      guardianId: dependencies.id(row.guardian_id, "patient.guardian_id"), name: dependencies.text(row.name, "patient.name"), species: dependencies.text(row.species, "patient.species"), breed: row.breed, sex: row.sex, reproductiveStatus: row.reproductive_status, birthDate: row.birth_date,
      identifiers: dependencies.stringArray(row.identifiers, "patient.identifiers"), dataClass: row.data_class, status: row.status,
      mergedIntoId: row.merged_into_id ? dependencies.id(row.merged_into_id, "patient.merged_into_id") : null,
      statusChangedAt: dependencies.nullableTimestamp(row.status_changed_at), createdAt: dependencies.timestamp(row.created_at, "patient.created_at"),
      guardian: row.guardian_display_name === null || row.guardian_phone === null ? null : { id: dependencies.id(row.guardian_id, "guardian.id"), displayName: row.guardian_display_name, phone: row.guardian_phone }
    }));
  });
}

export function listAppointments(dependencies: NormalizedEarlyReadDependencies, context: CvgContext, range: AppointmentRange = "today"): Promise<NormalizedAppointmentRead[]> {
  return dependencies.scopedRead(context, "appointments", async (client) => {
    const { start, end } = appointmentRangeBounds(range);
    const result = await client.query<{
      id: string; organization_id: string; unit_id: string; workspace_id: string; patient_id: string; provider_id: string; resource_id: string | null; service_id: string; starts_at: SqlTimestamp; ends_at: SqlTimestamp; purpose: string; status: Appointment["status"]; version: number; created_at: SqlTimestamp; patient_name: string | null; provider_name: string | null;
    }>(
      "select a.id::text as id, a.organization_id::text as organization_id, a.unit_id::text as unit_id, a.workspace_id::text as workspace_id, a.patient_id::text as patient_id, a.provider_id::text as provider_id, a.resource_id::text as resource_id, a.service_id::text as service_id, a.starts_at, a.ends_at, a.purpose, a.status, a.version, a.created_at, p.name as patient_name, pr.display_name as provider_name from appointments a left join patients p on p.id = a.patient_id and p.organization_id = a.organization_id left join providers pr on pr.id = a.provider_id and pr.organization_id = a.organization_id where a.organization_id = cvg_request_organization() and ($1::uuid is null or a.unit_id = $1::uuid) and ($2::uuid is null or a.workspace_id = $2::uuid) and a.starts_at >= $3::timestamptz and a.starts_at < $4::timestamptz order by a.starts_at, a.id",
      [context.unitId, context.workspaceId, start, end]
    );
    return result.rows.map((row) => ({
      id: dependencies.id(row.id, "appointment.id"), organizationId: dependencies.id(row.organization_id, "appointment.organization_id"), unitId: dependencies.id(row.unit_id, "appointment.unit_id"), workspaceId: dependencies.id(row.workspace_id, "appointment.workspace_id"), patientId: dependencies.id(row.patient_id, "appointment.patient_id"), providerId: dependencies.id(row.provider_id, "appointment.provider_id"), resourceId: row.resource_id ? dependencies.id(row.resource_id, "appointment.resource_id") : null, serviceId: dependencies.id(row.service_id, "appointment.service_id"), startsAt: dependencies.timestamp(row.starts_at, "appointment.starts_at"), endsAt: dependencies.timestamp(row.ends_at, "appointment.ends_at"), purpose: dependencies.text(row.purpose, "appointment.purpose"), status: row.status, version: row.version, createdAt: dependencies.timestamp(row.created_at, "appointment.created_at"), patient: row.patient_name === null ? null : { id: dependencies.id(row.patient_id, "patient.id"), name: row.patient_name }, provider: row.provider_name
    }));
  });
}

type QueueReadRow = { id: string; organization_id: string; unit_id: string; appointment_id: string | null; patient_id: string; status: unknown; priority: unknown; checked_in_at: SqlTimestamp; appointment_workspace_id: string | null; patient_name: string | null };

export function listQueue(dependencies: NormalizedEarlyReadDependencies, context: CvgContext): Promise<NormalizedQueueRead[]> {
  return dependencies.scopedRead(context, "queue", async (client) => {
    const result = await client.query<QueueReadRow>(
      "select q.id::text as id, q.organization_id::text as organization_id, q.unit_id::text as unit_id, q.appointment_id::text as appointment_id, q.patient_id::text as patient_id, q.status, q.priority, q.checked_in_at, a.workspace_id::text as appointment_workspace_id, p.name as patient_name from queue_entries q left join appointments a on a.id = q.appointment_id and a.organization_id = q.organization_id left join patients p on p.id = q.patient_id and p.organization_id = q.organization_id where q.organization_id = cvg_request_organization() and cvg_request_scope_allows(q.unit_id, null) and ($1::uuid is null or q.unit_id = $1::uuid) and ($2::uuid is null or a.workspace_id = $2::uuid) order by q.checked_in_at, q.id",
      [context.unitId, context.workspaceId]
    );
    return result.rows.map((row) => {
      const organizationId = dependencies.id(row.organization_id, "queue.organization_id");
      const unitId = dependencies.id(row.unit_id, "queue.unit_id");
      const appointmentWorkspaceId = row.appointment_workspace_id ? dependencies.id(row.appointment_workspace_id, "queue.appointment_workspace_id") : null;
      if (organizationId !== context.organizationId || (context.unitId !== null && unitId !== context.unitId) || (context.workspaceId !== null && appointmentWorkspaceId !== context.workspaceId)) throw dependencies.corruption(`normalized queue entry ${row.id} is outside the requested scope`);
      return { id: dependencies.id(row.id, "queue.id"), organizationId, unitId, appointmentId: row.appointment_id ? dependencies.id(row.appointment_id, "queue.appointment_id") : null, patientId: dependencies.id(row.patient_id, "queue.patient_id"), status: dependencies.enum(row.status, ["WAITING", "TRIAGE", "IN_SERVICE", "DONE", "CANCELLED"] as const, "queue.status"), priority: dependencies.enum(row.priority, ["ROUTINE", "URGENT", "EMERGENCY"] as const, "queue.priority"), checkedInAt: dependencies.timestamp(row.checked_in_at, "queue.checked_in_at"), patient: row.patient_name === null ? null : { id: dependencies.id(row.patient_id, "queue.patient.id"), name: dependencies.text(row.patient_name, "queue.patient.name") } };
    });
  });
}
