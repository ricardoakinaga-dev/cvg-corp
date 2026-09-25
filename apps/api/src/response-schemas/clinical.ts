import { z } from "zod";
import { idSchema, revisionSchema } from "@cvg/contracts";

const MAX_PAGE_ITEMS = 100;

const timestampSchema = z.string().datetime({ offset: true });
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const versionSchema = z.number().int().min(1).max(1_000_000_000);

const patientSummarySchema = z.object({
  id: idSchema,
  name: boundedText(120)
}).strict();

const encounterSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  unitId: idSchema,
  workspaceId: idSchema,
  patientId: idSchema,
  appointmentId: idSchema.nullable(),
  chiefComplaint: boundedText(500),
  urgency: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]),
  status: z.enum(["OPEN", "IN_PROGRESS", "SIGNED", "CLOSED"]),
  openedAt: timestampSchema,
  closedAt: timestampSchema.nullable()
}).strict();

const encounterListItemSchema = encounterSchema.extend({
  patient: patientSummarySchema
}).strict();

const redactedClinicalDocumentSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  encounterId: idSchema,
  patientId: idSchema,
  authorId: idSchema,
  documentType: z.enum(["EVOLUTION", "TRIAGE", "DISCHARGE", "PRESCRIPTION", "REPORT"]),
  title: boundedText(180),
  dataClass: z.enum(["D2", "D3"]),
  status: z.enum(["DRAFT", "REVIEW", "SIGNED", "PUBLISHED"]),
  version: versionSchema,
  signedAt: timestampSchema.nullable(),
  signedBy: idSchema.nullable(),
  createdAt: timestampSchema
}).strict();

const fullClinicalDocumentSchema = redactedClinicalDocumentSchema.extend({
  content: boundedText(30_000)
}).strict();

/*
 * ClinicalDocumentResponse is shared by detail/update/review routes that
 * return content and create/sign routes that remove it before serialization.
 * The union is intentionally broad at this nested boundary because the
 * nominal catalog has one response name for those different route shapes;
 * ClinicalDocumentListResponse remains redacted-only.
 */
const clinicalDocumentWireSchema = z.union([
  redactedClinicalDocumentSchema,
  fullClinicalDocumentSchema
]);

const clinicalAddendumSchema = z.object({
  id: idSchema,
  documentId: idSchema,
  authorId: idSchema,
  reason: boundedText(500),
  content: boundedText(30_000),
  createdAt: timestampSchema
}).strict();

const diagnosticRequestSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  patientId: idSchema,
  encounterId: idSchema.nullable(),
  testName: boundedText(180),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]),
  status: z.enum(["REQUESTED", "SPECIMEN_COLLECTED", "RESULTED", "REVIEWED", "CANCELLED"]),
  requestedBy: idSchema,
  createdAt: timestampSchema
}).strict();

const specimenSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  requestId: idSchema,
  patientId: idSchema,
  label: boundedText(160),
  collectedAt: timestampSchema,
  status: z.enum(["COLLECTED", "RECEIVED", "REJECTED"])
}).strict();

const resultSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  requestId: idSchema,
  specimenId: idSchema,
  patientId: idSchema,
  value: boundedText(20_000),
  source: boundedText(160),
  sourceVersion: boundedText(80),
  status: z.enum(["RECEIVED", "QUARANTINED", "VALID", "REJECTED"]),
  createdAt: timestampSchema
}).strict();

const listResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) => z.object({
  items: z.array(itemSchema).max(MAX_PAGE_ITEMS),
  nextCursor: idSchema.nullable().optional(),
  revision: revisionSchema.optional()
}).strict();

const encounterListResponseSchema = listResponseSchema(encounterListItemSchema);
const encounterResponseSchema = z.object({
  encounter: encounterSchema,
  receiptId: idSchema
}).strict();

const clinicalDocumentListResponseSchema = listResponseSchema(redactedClinicalDocumentSchema);
const clinicalDocumentResponseSchema = z.union([
  z.object({ document: clinicalDocumentWireSchema }).strict(),
  z.object({ document: clinicalDocumentWireSchema, receiptId: idSchema }).strict()
]);

const clinicalAddendumListResponseSchema = listResponseSchema(clinicalAddendumSchema);
const clinicalAddendumResponseSchema = z.object({
  addendum: clinicalAddendumSchema,
  receiptId: idSchema
}).strict();

const diagnosticRequestListResponseSchema = listResponseSchema(diagnosticRequestSchema);
const diagnosticRequestResponseSchema = z.object({
  request: diagnosticRequestSchema,
  receiptId: idSchema
}).strict();

const specimenListResponseSchema = listResponseSchema(specimenSchema);
const specimenResponseSchema = z.object({
  specimen: specimenSchema,
  receiptId: idSchema
}).strict();

const resultResponseSchema = z.object({
  result: resultSchema,
  receiptId: idSchema
}).strict();
const resultListResponseSchema = listResponseSchema(resultSchema);

/** Payload schemas keyed by the nominal response names in the API catalog. */
export const clinicalResponseSchemas: ReadonlyMap<string, z.ZodTypeAny> = new Map<string, z.ZodTypeAny>([
  ["EncounterListResponse", encounterListResponseSchema],
  ["EncounterResponse", encounterResponseSchema],
  ["ClinicalDocumentListResponse", clinicalDocumentListResponseSchema],
  ["ClinicalDocumentResponse", clinicalDocumentResponseSchema],
  ["ClinicalAddendumListResponse", clinicalAddendumListResponseSchema],
  ["ClinicalAddendumResponse", clinicalAddendumResponseSchema],
  ["DiagnosticRequestListResponse", diagnosticRequestListResponseSchema],
  ["DiagnosticRequestResponse", diagnosticRequestResponseSchema],
  ["SpecimenListResponse", specimenListResponseSchema],
  ["SpecimenResponse", specimenResponseSchema],
  ["ResultResponse", resultResponseSchema],
  ["ResultListResponse", resultListResponseSchema]
]);
