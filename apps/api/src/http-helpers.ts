import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { id, idSchema, type ApiResponse, type CvgContext, type OpaqueId, type Role } from "@cvg/contracts";
import { DomainError, type CvgStore, type StoreSnapshot } from "@cvg/domain";
import { PersistenceUnavailableError } from "@cvg/persistence";

export function persistenceDiagnostic(error: unknown): Record<string, string | null> {
  const cause = error instanceof PersistenceUnavailableError ? error.cause : error;
  const record = cause && typeof cause === "object" ? cause as { code?: unknown; constraint?: unknown; table?: unknown } : {};
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
    databaseCode: typeof record.code === "string" ? record.code : null,
    constraint: typeof record.constraint === "string" ? record.constraint : null,
    table: typeof record.table === "string" ? record.table : null
  };
}

export function correlationId(request: FastifyRequest): string {
  const supplied = request.headers["x-correlation-id"];
  if (typeof supplied === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(supplied)) return supplied;
  return randomUUID();
}

export function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", "A entrada não atende ao contrato desta operação.", 400, { issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
  return parsed.data;
}

export function safeId(value: string | null): OpaqueId | null {
  if (!value) return null;
  return id(parse(idSchema, value));
}

export function requireIdempotencyKey(request: FastifyRequest): string {
  const key = header(request, "idempotency-key");
  if (!key || !/^[A-Za-z0-9._:-]{1,160}$/.test(key)) throw new DomainError("INVALID_INPUT", "Idempotency-Key é obrigatório e deve ser estável.", 400);
  return key;
}

export function response<T>(reply: FastifyReply, payload: ApiResponse<T>, statusCode = 200): FastifyReply {
  return reply.code(statusCode).send(payload);
}

export function publicContext(context: CvgContext, store: CvgStore): Record<string, unknown> {
  const unit = context.unitId ? store.units.get(context.unitId) : null;
  const workspace = context.workspaceId ? store.workspaces.get(context.workspaceId) : null;
  return { organizationId: context.organizationId, organizationName: store.organizations.get(context.organizationId)?.name ?? "", unit: unit ? { id: unit.id, name: unit.name, code: unit.code } : null, workspace: workspace ? { id: workspace.id, name: workspace.name, purpose: workspace.purpose } : null, roles: context.actorRoleSnapshot, purpose: context.purpose, policyRevision: context.policyRevision, correlationId: context.correlationId };
}

export function publicPatientRecord(patient: StoreSnapshot["patients"][number], guardian: Pick<StoreSnapshot["guardians"][number], "id" | "displayName" | "phone"> | null, roles: Role[]): Record<string, unknown> {
  if (!guardian) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
  const minimum = { id: patient.id, name: patient.name, species: patient.species, breed: patient.breed, status: patient.status, guardian: { id: guardian.id, displayName: guardian.displayName, phone: guardian.phone } };
  if (!roles.includes("veterinario")) return minimum;
  return { ...minimum, sex: patient.sex, reproductiveStatus: patient.reproductiveStatus, birthDate: patient.birthDate, identifiers: [...patient.identifiers] };
}

export function publicPatient(store: CvgStore, patientId: OpaqueId, roles: Role[]): Record<string, unknown> {
  const patient = store.patients.get(patientId);
  const guardian = patient ? store.guardians.get(patient.guardianId) : null;
  if (!patient || !guardian) throw new DomainError("NOT_FOUND", "Recurso não encontrado.", 404);
  return publicPatientRecord(patient, guardian, roles);
}

export function publicGuardian(guardian: { id: OpaqueId; displayName: string; phone: string; email: string | null; status: string }): Record<string, unknown> {
  return { id: guardian.id, displayName: guardian.displayName, phone: guardian.phone, email: guardian.email, status: guardian.status };
}
