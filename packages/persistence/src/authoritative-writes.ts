import type { PoolClient } from "pg";
import type { AnimalPatient, Appointment, ClinicalDocument, DiagnosticRequest, DiagnosticResult, Encounter, Guardian, Specimen } from "@cvg/contracts";

export interface AuthoritativeWriteDependencies {
  corruption: (message: string) => Error;
}

export function assertAuthoritativeWriteReplayExclusive(write: unknown, replayId: string | null | undefined, subject: string, dependencies: AuthoritativeWriteDependencies): void {
  if (write && replayId) throw dependencies.corruption(`authoritative ${subject} write and replay cannot be requested together`);
}

export async function writeAuthoritativePatient(client: PoolClient, patient: AnimalPatient, dependencies: AuthoritativeWriteDependencies): Promise<void> {
  if (!patient.unitId || !patient.workspaceId) throw dependencies.corruption("patient " + patient.id + " has no complete unit/workspace scope for authoritative write");
  await client.query("select set_config('cvg.unit_id', $1, true)", [patient.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [patient.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into patients(id, organization_id, unit_id, workspace_id, guardian_id, name, species, breed, sex, reproductive_status, birth_date, identifiers, data_class, status, merged_into_id, status_changed_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, guardian_id = excluded.guardian_id, name = excluded.name, species = excluded.species, breed = excluded.breed, sex = excluded.sex, reproductive_status = excluded.reproductive_status, birth_date = excluded.birth_date, identifiers = excluded.identifiers, data_class = excluded.data_class, status = excluded.status, merged_into_id = excluded.merged_into_id, status_changed_at = excluded.status_changed_at where patients.organization_id = excluded.organization_id and patients.unit_id is not distinct from excluded.unit_id and patients.workspace_id is not distinct from excluded.workspace_id and patients.guardian_id = excluded.guardian_id and patients.name = excluded.name and patients.species = excluded.species and patients.breed is not distinct from excluded.breed and patients.sex = excluded.sex and patients.reproductive_status = excluded.reproductive_status and patients.birth_date is not distinct from excluded.birth_date and patients.identifiers = excluded.identifiers and patients.data_class = excluded.data_class and patients.status = excluded.status and patients.merged_into_id is not distinct from excluded.merged_into_id and patients.status_changed_at is not distinct from excluded.status_changed_at and patients.created_at = excluded.created_at returning id::text",
    [patient.id, patient.organizationId, patient.unitId, patient.workspaceId, patient.guardianId, patient.name, patient.species, patient.breed, patient.sex, patient.reproductiveStatus, patient.birthDate, JSON.stringify(patient.identifiers), patient.dataClass, patient.status, patient.mergedIntoId, patient.statusChangedAt, patient.createdAt]
  );
  if (!result.rows[0]) throw dependencies.corruption("authoritative patient " + patient.id + " conflicts with an existing normalized row");
}

export async function writeAuthoritativeAppointment(client: PoolClient, appointment: Appointment, dependencies: AuthoritativeWriteDependencies): Promise<void> {
  if (!appointment.unitId || !appointment.workspaceId) throw dependencies.corruption("appointment " + appointment.id + " has no complete unit/workspace scope for authoritative write");
  await client.query("select set_config('cvg.unit_id', $1, true)", [appointment.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [appointment.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into appointments(id, organization_id, unit_id, workspace_id, patient_id, provider_id, resource_id, service_id, starts_at, ends_at, purpose, status, version, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, provider_id = excluded.provider_id, resource_id = excluded.resource_id, service_id = excluded.service_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at, purpose = excluded.purpose, status = excluded.status, version = excluded.version where appointments.organization_id = excluded.organization_id and appointments.unit_id = excluded.unit_id and appointments.workspace_id = excluded.workspace_id and appointments.patient_id = excluded.patient_id and appointments.provider_id = excluded.provider_id and appointments.resource_id is not distinct from excluded.resource_id and appointments.service_id = excluded.service_id and appointments.starts_at = excluded.starts_at and appointments.ends_at = excluded.ends_at and appointments.purpose = excluded.purpose and appointments.status = excluded.status and appointments.version = excluded.version and appointments.created_at = excluded.created_at returning id::text",
    [appointment.id, appointment.organizationId, appointment.unitId, appointment.workspaceId, appointment.patientId, appointment.providerId, appointment.resourceId, appointment.serviceId, appointment.startsAt, appointment.endsAt, appointment.purpose, appointment.status, appointment.version, appointment.createdAt]
  );
  if (!result.rows[0]) throw dependencies.corruption("authoritative appointment " + appointment.id + " conflicts with an existing normalized row");
}

export async function writeAuthoritativeEncounter(client: PoolClient, encounter: Encounter, dependencies: AuthoritativeWriteDependencies): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw dependencies.corruption("encounter " + encounter.id + " has no complete unit/workspace scope for authoritative write");
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into encounters(id, organization_id, unit_id, workspace_id, patient_id, appointment_id, chief_complaint, urgency, status, opened_at, closed_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, appointment_id = excluded.appointment_id, chief_complaint = excluded.chief_complaint, urgency = excluded.urgency, status = excluded.status, opened_at = excluded.opened_at, closed_at = excluded.closed_at where encounters.organization_id = excluded.organization_id and encounters.unit_id = excluded.unit_id and encounters.workspace_id = excluded.workspace_id and encounters.patient_id = excluded.patient_id and encounters.appointment_id is not distinct from excluded.appointment_id and encounters.chief_complaint = excluded.chief_complaint and encounters.urgency = excluded.urgency and encounters.status = excluded.status and encounters.opened_at = excluded.opened_at and encounters.closed_at is not distinct from excluded.closed_at returning id::text",
    [encounter.id, encounter.organizationId, encounter.unitId, encounter.workspaceId, encounter.patientId, encounter.appointmentId, encounter.chiefComplaint, encounter.urgency, encounter.status, encounter.openedAt, encounter.closedAt]
  );
  if (!result.rows[0]) throw dependencies.corruption("authoritative encounter " + encounter.id + " conflicts with an existing normalized row");
}

export async function writeAuthoritativeClinicalDocument(client: PoolClient, document: ClinicalDocument, encounter: Encounter, dependencies: AuthoritativeWriteDependencies): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw dependencies.corruption("clinical document " + document.id + " has no complete encounter scope for authoritative sign");
  if (document.status !== "SIGNED" || document.version < 2 || !document.signedAt || !document.signedBy) throw dependencies.corruption("authoritative clinical sign " + document.id + " has an incomplete signed state");
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "update clinical_documents set status = $1, version = $2, signed_at = $3, signed_by = $4 where id = $5 and organization_id = $6 and unit_id = $7 and workspace_id = $8 and encounter_id = $9 and patient_id = $10 and author_id = $11 and document_type = $12 and title = $13 and content = $14 and data_class = $15 and status in ('DRAFT', 'REVIEW') and version = $2 - 1 and signed_at is null and signed_by is null and created_at = $16 returning id::text",
    [document.status, document.version, document.signedAt, document.signedBy, document.id, document.organizationId, encounter.unitId, encounter.workspaceId, document.encounterId, document.patientId, document.authorId, document.documentType, document.title, document.content, document.dataClass, document.createdAt]
  );
  if (!result.rows[0]) throw dependencies.corruption("authoritative clinical sign " + document.id + " conflicts with an existing normalized row");
}

export async function writeAuthoritativeGuardian(client: PoolClient, guardian: Guardian, dependencies: AuthoritativeWriteDependencies): Promise<void> {
  if (!guardian.unitId || !guardian.workspaceId) throw dependencies.corruption("guardian " + guardian.id + " has no complete unit/workspace scope for authoritative write");
  await client.query("select set_config('cvg.unit_id', $1, true)", [guardian.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [guardian.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into guardians(id, organization_id, unit_id, workspace_id, display_name, phone, email, data_class, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, display_name = excluded.display_name, phone = excluded.phone, email = excluded.email, data_class = excluded.data_class, status = excluded.status where guardians.organization_id = excluded.organization_id and guardians.unit_id is not distinct from excluded.unit_id and guardians.workspace_id is not distinct from excluded.workspace_id and guardians.display_name = excluded.display_name and guardians.phone = excluded.phone and guardians.email is not distinct from excluded.email and guardians.data_class = excluded.data_class and guardians.status = excluded.status returning id::text",
    [guardian.id, guardian.organizationId, guardian.unitId, guardian.workspaceId, guardian.displayName, guardian.phone, guardian.email, guardian.dataClass, guardian.status]
  );
  if (!result.rows[0]) throw dependencies.corruption("authoritative guardian " + guardian.id + " conflicts with an existing normalized row");
}

export async function writeAuthoritativeDiagnosticRequest(client: PoolClient, request: DiagnosticRequest, encounter: Encounter, dependencies: AuthoritativeWriteDependencies): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw dependencies.corruption("diagnostic request " + request.id + " has no complete encounter scope for authoritative write");
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into diagnostic_requests(id, organization_id, unit_id, workspace_id, patient_id, encounter_id, test_name, priority, status, requested_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, patient_id = excluded.patient_id, encounter_id = excluded.encounter_id, test_name = excluded.test_name, priority = excluded.priority, status = excluded.status, requested_by = excluded.requested_by where diagnostic_requests.organization_id = excluded.organization_id and diagnostic_requests.unit_id = excluded.unit_id and diagnostic_requests.workspace_id = excluded.workspace_id and diagnostic_requests.patient_id = excluded.patient_id and diagnostic_requests.encounter_id is not distinct from excluded.encounter_id and diagnostic_requests.test_name = excluded.test_name and diagnostic_requests.priority = excluded.priority and diagnostic_requests.status = excluded.status and diagnostic_requests.requested_by = excluded.requested_by and diagnostic_requests.created_at = excluded.created_at returning id::text",
    [request.id, request.organizationId, encounter.unitId, encounter.workspaceId, request.patientId, request.encounterId, request.testName, request.priority, request.status, request.requestedBy, request.createdAt]
  );
  if (!result.rows[0]) throw dependencies.corruption("authoritative diagnostic request " + request.id + " conflicts with an existing normalized row");
}

export async function writeAuthoritativeSpecimen(client: PoolClient, specimen: Specimen, encounter: Encounter, dependencies: AuthoritativeWriteDependencies): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw dependencies.corruption("specimen " + specimen.id + " has no complete encounter scope for authoritative write");
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into specimens(id, organization_id, unit_id, workspace_id, request_id, patient_id, label, collected_at, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, request_id = excluded.request_id, patient_id = excluded.patient_id, label = excluded.label, collected_at = excluded.collected_at, status = excluded.status where specimens.organization_id = excluded.organization_id and specimens.unit_id = excluded.unit_id and specimens.workspace_id = excluded.workspace_id and specimens.request_id = excluded.request_id and specimens.patient_id = excluded.patient_id and specimens.label = excluded.label and specimens.collected_at = excluded.collected_at and specimens.status = excluded.status returning id::text",
    [specimen.id, specimen.organizationId, encounter.unitId, encounter.workspaceId, specimen.requestId, specimen.patientId, specimen.label, specimen.collectedAt, specimen.status]
  );
  if (!result.rows[0]) throw dependencies.corruption("authoritative specimen " + specimen.id + " conflicts with an existing normalized row");
}

export async function writeAuthoritativeDiagnosticResult(client: PoolClient, resultRow: DiagnosticResult, encounter: Encounter, dependencies: AuthoritativeWriteDependencies): Promise<void> {
  if (!encounter.unitId || !encounter.workspaceId) throw dependencies.corruption("diagnostic result " + resultRow.id + " has no complete encounter scope for authoritative write");
  await client.query("select set_config('cvg.unit_id', $1, true)", [encounter.unitId]);
  await client.query("select set_config('cvg.workspace_id', $1, true)", [encounter.workspaceId]);
  const result = await client.query<{ id: string }>(
    "insert into diagnostic_results(id, organization_id, unit_id, workspace_id, request_id, specimen_id, patient_id, value, source, source_version, status, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (id) do update set organization_id = excluded.organization_id, unit_id = excluded.unit_id, workspace_id = excluded.workspace_id, request_id = excluded.request_id, specimen_id = excluded.specimen_id, patient_id = excluded.patient_id, value = excluded.value, source = excluded.source, source_version = excluded.source_version, status = excluded.status where diagnostic_results.organization_id = excluded.organization_id and diagnostic_results.unit_id = excluded.unit_id and diagnostic_results.workspace_id = excluded.workspace_id and diagnostic_results.request_id = excluded.request_id and diagnostic_results.specimen_id = excluded.specimen_id and diagnostic_results.patient_id = excluded.patient_id and diagnostic_results.value = excluded.value and diagnostic_results.source = excluded.source and diagnostic_results.source_version = excluded.source_version and diagnostic_results.status = excluded.status and diagnostic_results.created_at = excluded.created_at returning id::text",
    [resultRow.id, resultRow.organizationId, encounter.unitId, encounter.workspaceId, resultRow.requestId, resultRow.specimenId, resultRow.patientId, resultRow.value, resultRow.source, resultRow.sourceVersion, resultRow.status, resultRow.createdAt]
  );
  if (!result.rows[0]) throw dependencies.corruption("authoritative diagnostic result " + resultRow.id + " conflicts with an existing normalized row");
}
