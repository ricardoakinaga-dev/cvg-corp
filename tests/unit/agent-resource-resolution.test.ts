import test from "node:test";
import assert from "node:assert/strict";
import { id, type CvgContext, type OpaqueId } from "@cvg/contracts";
import { CvgStore, isInContext } from "@cvg/domain";

const password = "synthetic-password-123";

function adminContext(store: CvgStore, workspaceName: string, correlationId: string): CvgContext {
  const option = store.contextOptions(store.bootstrapCredentials.userId).find((candidate) => candidate.workspace.name === workspaceName);
  assert.ok(option, `fixture workspace ${workspaceName} must exist`);
  const session = store.createSession(store.bootstrapCredentials.userId, `${correlationId}-token`, `${correlationId}-csrf`, 60);
  return store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", correlationId, null, null, session.id);
}

function fixture(store: CvgStore): { clinical: CvgContext; reception: CvgContext; patient: OpaqueId; encounter: OpaqueId } {
  const clinical = adminContext(store, "Operação clínica", "aud21-003-clinical");
  const reception = adminContext(store, "Recepção", "aud21-003-reception");
  const patient = id("00000000-0000-4000-8000-000000000111");
  const encounter = store.createEncounter(clinical, { patientId: patient, appointmentId: null, chiefComplaint: "matriz de identidade", urgency: "ROUTINE" });
  return { clinical, reception, patient, encounter: encounter.id };
}

test("CVG-AUD21-003: qualquer combinação contraditória conhecida ou parcialmente conhecida retorna DIVERGENT", () => {
  const store = new CvgStore({ bootstrapPassword: password });
  const { patient, encounter } = fixture(store);
  const unknownPatient = id("00000000-0000-4000-8000-000000000901");
  const unknownEncounter = id("00000000-0000-4000-8000-000000000902");
  const unknownResource = id("00000000-0000-4000-8000-000000000903");

  const cases: Array<{ name: string; input: { resourceId?: OpaqueId | null; encounterId?: OpaqueId | null; patientId?: OpaqueId | null }; status: "RESOLVED" | "NOT_FOUND" | "DIVERGENT" }> = [
    { name: "canonical encounter", input: { resourceId: encounter, encounterId: encounter, patientId: patient }, status: "RESOLVED" },
    { name: "canonical patient", input: { resourceId: patient, patientId: patient }, status: "RESOLVED" },
    { name: "patient resource plus encounter", input: { resourceId: patient, encounterId: encounter, patientId: patient }, status: "DIVERGENT" },
    { name: "encounter plus wrong patient", input: { resourceId: encounter, encounterId: encounter, patientId: unknownPatient }, status: "DIVERGENT" },
    { name: "encounter plus unknown patient", input: { resourceId: encounter, patientId: unknownPatient }, status: "DIVERGENT" },
    { name: "patient plus unknown encounter", input: { resourceId: patient, encounterId: unknownEncounter, patientId: patient }, status: "DIVERGENT" },
    { name: "unknown resource plus known patient", input: { resourceId: unknownResource, patientId: patient }, status: "DIVERGENT" },
    { name: "known encounter plus unknown encounter", input: { resourceId: encounter, encounterId: unknownEncounter, patientId: patient }, status: "DIVERGENT" },
    { name: "all unknown", input: { resourceId: unknownResource, encounterId: unknownEncounter, patientId: unknownPatient }, status: "NOT_FOUND" },
    { name: "only unknown patient", input: { patientId: unknownPatient }, status: "NOT_FOUND" },
    { name: "only unknown encounter", input: { encounterId: unknownEncounter }, status: "NOT_FOUND" }
  ];

  for (const candidate of cases) {
    assert.equal(store.resolveAgentResource(candidate.input).status, candidate.status, candidate.name);
  }
});

test("CVG-AUD21-003: recurso resolvido mantém tenant, unit e workspace autoritativos", () => {
  const store = new CvgStore({ bootstrapPassword: password });
  const { clinical, reception, patient, encounter } = fixture(store);
  const resolution = store.resolveAgentResource({ resourceId: encounter, encounterId: encounter, patientId: patient });
  assert.equal(resolution.status, "RESOLVED");
  if (resolution.status !== "RESOLVED") return;

  assert.equal(isInContext(resolution.resource, clinical), true);
  assert.equal(isInContext(resolution.resource, reception), false);
  assert.equal(isInContext(resolution.resource, { ...clinical, organizationId: id("00000000-0000-4000-8000-000000000999") }), false);
  assert.equal(resolution.resource.unitId, clinical.unitId);
  assert.equal(resolution.resource.workspaceId, clinical.workspaceId);
  assert.equal(resolution.resource.organizationId, clinical.organizationId);
});
