import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { clinicalResponseSchemas } from "../../apps/api/src/response-schemas/clinical.ts";

const ids = {
  organization: "00000000-0000-4000-8000-000000000001",
  unit: "00000000-0000-4000-8000-000000000002",
  workspace: "00000000-0000-4000-8000-000000000003",
  patient: "00000000-0000-4000-8000-000000000004",
  appointment: "00000000-0000-4000-8000-000000000005",
  encounter: "00000000-0000-4000-8000-000000000006",
  document: "00000000-0000-4000-8000-000000000007",
  author: "00000000-0000-4000-8000-000000000008",
  addendum: "00000000-0000-4000-8000-000000000009",
  request: "00000000-0000-4000-8000-000000000010",
  specimen: "00000000-0000-4000-8000-000000000011",
  result: "00000000-0000-4000-8000-000000000012",
  cursor: "00000000-0000-4000-8000-000000000013"
} as const;

const timestamp = "2026-09-21T12:00:00.000Z";

const encounter = {
  id: ids.encounter,
  organizationId: ids.organization,
  unitId: ids.unit,
  workspaceId: ids.workspace,
  patientId: ids.patient,
  appointmentId: null,
  chiefComplaint: "Acompanhamento clínico",
  urgency: "ROUTINE",
  status: "OPEN",
  openedAt: timestamp,
  closedAt: null
};

const encounterListItem = {
  ...encounter,
  patient: { id: ids.patient, name: "Nina" }
};

const redactedClinicalDocument = {
  id: ids.document,
  organizationId: ids.organization,
  encounterId: ids.encounter,
  patientId: ids.patient,
  authorId: ids.author,
  documentType: "EVOLUTION",
  title: "Evolução clínica",
  dataClass: "D3",
  status: "DRAFT",
  version: 1,
  signedAt: null,
  signedBy: null,
  createdAt: timestamp
};

const fullClinicalDocument = {
  ...redactedClinicalDocument,
  content: "Paciente estável; manter observação e retorno programado."
};

const addendum = {
  id: ids.addendum,
  documentId: ids.document,
  authorId: ids.author,
  reason: "Correção de informação clínica",
  content: "Ajuste registrado após revisão.",
  createdAt: timestamp
};

const diagnosticRequest = {
  id: ids.request,
  organizationId: ids.organization,
  patientId: ids.patient,
  encounterId: null,
  testName: "Hemograma",
  priority: "ROUTINE",
  status: "REQUESTED",
  requestedBy: ids.author,
  createdAt: timestamp
};

const specimen = {
  id: ids.specimen,
  organizationId: ids.organization,
  requestId: ids.request,
  patientId: ids.patient,
  label: "Amostra principal",
  collectedAt: timestamp,
  status: "COLLECTED"
};

const result = {
  id: ids.result,
  organizationId: ids.organization,
  requestId: ids.request,
  specimenId: ids.specimen,
  patientId: ids.patient,
  value: "12.4",
  source: "laboratorio-local",
  sourceVersion: "synthetic-1",
  status: "RECEIVED",
  createdAt: timestamp
};

const expectedNames = [
  "EncounterListResponse",
  "EncounterResponse",
  "ClinicalDocumentListResponse",
  "ClinicalDocumentResponse",
  "ClinicalAddendumListResponse",
  "ClinicalAddendumResponse",
  "DiagnosticRequestListResponse",
  "DiagnosticRequestResponse",
  "SpecimenListResponse",
  "SpecimenResponse",
  "ResultResponse",
  "ResultListResponse"
] as const;

function schemaFor(name: string): z.ZodTypeAny {
  const schema = clinicalResponseSchemas.get(name);
  if (!schema) throw new Error(`missing clinical response schema ${name}`);
  return schema;
}

function accepts(name: string, payload: unknown): void {
  const parsed = schemaFor(name).safeParse(payload);
  if (!parsed.success) assert.fail(`${name} rejected a valid payload: ${parsed.error.message}`);
}

function rejects(name: string, payload: unknown): void {
  assert.equal(schemaFor(name).safeParse(payload).success, false, `${name} accepted an invalid payload`);
}

test("exports exactly the assigned response-schema names as a readonly map", () => {
  assert.deepEqual([...clinicalResponseSchemas.keys()], expectedNames);
  assert.equal(clinicalResponseSchemas.size, expectedNames.length);
  for (const name of expectedNames) assert.equal(typeof clinicalResponseSchemas.get(name)?.safeParse, "function");
});

test("accepts actual clinical and diagnostic success payloads", () => {
  accepts("EncounterListResponse", { items: [encounterListItem] });
  accepts("EncounterListResponse", { items: [], nextCursor: ids.cursor, revision: "42" });
  accepts("EncounterResponse", { encounter, receiptId: ids.encounter });

  // Lists redact content in app.ts; detail/update/review may return it under
  // the same nominal response name, while create/sign return the redacted form.
  accepts("ClinicalDocumentListResponse", { items: [redactedClinicalDocument] });
  accepts("ClinicalDocumentListResponse", { items: [] });
  accepts("ClinicalDocumentResponse", { document: fullClinicalDocument });
  accepts("ClinicalDocumentResponse", { document: fullClinicalDocument, receiptId: ids.document });
  accepts("ClinicalDocumentResponse", { document: redactedClinicalDocument, receiptId: ids.document });

  accepts("ClinicalAddendumListResponse", { items: [addendum], nextCursor: null, revision: "7" });
  accepts("ClinicalAddendumResponse", { addendum, receiptId: ids.addendum });

  accepts("DiagnosticRequestListResponse", { items: [diagnosticRequest] });
  accepts("DiagnosticRequestResponse", { request: diagnosticRequest, receiptId: ids.request });
  accepts("SpecimenListResponse", { items: [specimen] });
  accepts("SpecimenResponse", { specimen, receiptId: ids.specimen });
  accepts("ResultResponse", { result, receiptId: ids.result });
  accepts("ResultListResponse", { items: [] });

  const boundedPage = Array.from({ length: 100 }, () => encounterListItem);
  accepts("EncounterListResponse", { items: boundedPage, nextCursor: null, revision: "1" });
});

test("rejects missing or unknown top-level payload fields", () => {
  rejects("EncounterListResponse", {});
  rejects("EncounterResponse", { receiptId: ids.encounter });
  rejects("ClinicalDocumentResponse", { receiptId: ids.document });
  rejects("ClinicalAddendumResponse", { addendum });
  rejects("DiagnosticRequestResponse", { request: diagnosticRequest, receiptId: ids.request, password: "redacted" });
  rejects("SpecimenResponse", { specimen, receiptId: ids.specimen, extra: true });
  rejects("ResultResponse", { result, receiptId: ids.result, rawResponse: "provider payload" });
  rejects("ResultListResponse", { items: [], cursor: ids.cursor });
});

test("rejects redacted clinical content, unsafe nested fields, and invalid primitives", () => {
  rejects("ClinicalDocumentListResponse", {
    items: [{ ...redactedClinicalDocument, content: "content must be removed" }]
  });
  rejects("ClinicalDocumentListResponse", {
    items: [{ ...redactedClinicalDocument, passwordDigest: "credential" }]
  });
  rejects("ClinicalDocumentResponse", {
    document: { ...redactedClinicalDocument, secret: "unsafe" }
  });
  rejects("ClinicalDocumentResponse", {
    document: { ...fullClinicalDocument, content: null }
  });
  rejects("EncounterResponse", {
    encounter: { ...encounter, urgency: "CRITICAL" },
    receiptId: ids.encounter
  });
  rejects("EncounterResponse", { encounter, receiptId: "not-an-id" });
  rejects("DiagnosticRequestResponse", {
    request: { ...diagnosticRequest, encounterId: "not-null-or-an-id" },
    receiptId: ids.request
  });
  rejects("ResultResponse", {
    result: { ...result, value: 12.4 },
    receiptId: ids.result
  });
  rejects("SpecimenResponse", {
    specimen: { ...specimen, collectedAt: "not-a-timestamp" },
    receiptId: ids.specimen
  });
});

test("rejects malformed list items and pagination outside the bounded contract", () => {
  rejects("EncounterListResponse", { items: [{ ...encounterListItem, patient: null }] });
  rejects("ClinicalAddendumListResponse", { items: { id: ids.addendum } });
  rejects("DiagnosticRequestListResponse", { items: [{ ...diagnosticRequest, status: "UNKNOWN" }] });
  rejects("SpecimenListResponse", { items: [{ ...specimen, label: "" }] });
  rejects("ResultListResponse", { items: [{ ...result, sourceVersion: 1 }] });
  rejects("EncounterListResponse", { items: [], nextCursor: "cursor-not-an-id" });
  rejects("EncounterListResponse", { items: [], revision: "not-a-decimal-revision" });
  rejects("EncounterListResponse", {
    items: Array.from({ length: 101 }, () => encounterListItem)
  });
});
