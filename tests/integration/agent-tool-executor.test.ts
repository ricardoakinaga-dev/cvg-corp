import test from "node:test";
import assert from "node:assert/strict";
import { CvgStore } from "@cvg/domain";
import { TOOL_REGISTRY } from "@cvg/harness";
import { AgentToolExecutorNotBoundError, AgentToolScopeError, createAgentToolExecutor } from "../../apps/api/src/agent-tool-executor.ts";
import type { AiSession, CvgContext, OpaqueId } from "@cvg/contracts";

function context(store: CvgStore, userId = store.bootstrapCredentials.userId): CvgContext {
  const option = store.contextOptions(userId)[0];
  assert.ok(option);
  const session = store.createSession(userId, "tool-executor-token", "tool-executor-csrf", 60);
  return store.resolveContext(userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", "agent-tool-executor", null, null, session.id);
}

function veterinarian(store: CvgStore): CvgContext {
  const id = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id;
  assert.ok(id);
  return context(store, id);
}

function tool(name: string) {
  const descriptor = TOOL_REGISTRY.find((candidate) => candidate.name === name);
  assert.ok(descriptor);
  return descriptor;
}

const session: AiSession = {
  id: "session-1" as OpaqueId,
  organizationId: "org" as OpaqueId,
  actorId: "actor" as OpaqueId,
  unitId: null,
  workspaceId: null,
  patientId: null,
  encounterId: null,
  purpose: "OPERATIONS",
  engineCommit: "test",
  profileDigest: "d".repeat(64),
  status: "ACTIVE",
  createdAt: new Date().toISOString()
};

test("patient read returns only the minimal authorized projection", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const ctx = veterinarian(store);
  const patient = [...store.patients.values()].find((candidate) => candidate.organizationId === ctx.organizationId && candidate.unitId === ctx.unitId && candidate.workspaceId === ctx.workspaceId);
  assert.ok(patient);
  const executor = createAgentToolExecutor({ store });
  const result = await executor({ tool: tool("cvg.patient.read"), parsedInput: { resourceId: patient.id, patientId: patient.id }, context: ctx, session, signal: new AbortController().signal });
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.resultPreview);
  const parsed = JSON.parse(result.resultPreview!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ["id", "name", "resource", "species", "status"]);
  assert.equal(parsed["id"], patient.id);
  assert.equal(result.resultDigest?.length, 64);
});

test("agenda read is context-scoped and bounded", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const ctx = veterinarian(store);
  const executor = createAgentToolExecutor({ store, agendaLimit: 5 });
  const result = await executor({ tool: tool("cvg.agenda.read"), parsedInput: {}, context: ctx, session, signal: new AbortController().signal });
  const parsed = JSON.parse(result.resultPreview!) as { items: { id: string }[] };
  assert.ok(parsed.items.length <= 5);
  for (const item of parsed.items) {
    const appointment = store.appointments.get(item.id as OpaqueId);
    assert.ok(appointment);
    assert.equal(appointment.organizationId, ctx.organizationId);
    assert.equal(appointment.unitId, ctx.unitId);
    assert.equal(appointment.workspaceId, ctx.workspaceId);
  }
});

function adminInUnitContext(store: CvgStore): CvgContext {
  const adminId = store.bootstrapCredentials.userId;
  const option = store.contextOptions(adminId).find((candidate) => candidate.unit.code === "CTR" && candidate.workspace.name === "Operação clínica");
  assert.ok(option, "admin fixture must expose the CTR clinical workspace");
  const session = store.createSession(adminId, "tool-executor-ctr-token", "tool-executor-ctr-csrf", 60);
  return store.resolveContext(adminId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", "agent-tool-executor-ctr", null, null, session.id);
}

function adminCrossUnitContext(store: CvgStore): CvgContext {
  const adminId = store.bootstrapCredentials.userId;
  const option = store.contextOptions(adminId).find((candidate) => candidate.unit.code === "SUL");
  assert.ok(option, "admin fixture must expose the SUL unit");
  const session = store.createSession(adminId, "tool-executor-sul-token", "tool-executor-sul-csrf", 60);
  return store.resolveContext(adminId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", "agent-tool-executor-sul", null, null, session.id);
}

function createPatient(context: CvgContext, store: CvgStore, name: string): OpaqueId {
  const guardian = store.createGuardian(context, { displayName: `Guardian ${name}`, phone: "+55 11 90000-0001", email: null });
  const patient = store.createPatient(context, { guardianId: guardian.id, name, species: "canino", breed: null, sex: "UNKNOWN", reproductiveStatus: "UNKNOWN", birthDate: null, identifiers: [] });
  return patient.id;
}

test("a resource outside the authenticated scope is rejected", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const ctx = veterinarian(store);
  const outsiderId = createPatient(adminCrossUnitContext(store), store, "Paciente de outra unidade");
  const executor = createAgentToolExecutor({ store });
  await assert.rejects(
    executor({ tool: tool("cvg.patient.read"), parsedInput: { resourceId: outsiderId }, context: ctx, session, signal: new AbortController().signal }),
    (error: unknown) => error instanceof AgentToolScopeError
  );
});

test("model-provided arguments cannot redirect the authoritative resource", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const ctx = veterinarian(store);
  const inScopeId = createPatient(adminInUnitContext(store), store, "Paciente autorizado");
  const outsiderId = createPatient(adminCrossUnitContext(store), store, "Paciente de outra unidade");
  const executor = createAgentToolExecutor({ store });
  // The gateway request pins resourceId to the authenticated target; a model
  // argument naming another patient is only data and must not be read.
  const result = await executor({ tool: tool("cvg.patient.read"), parsedInput: { resourceId: inScopeId, toolInput: { id: outsiderId } }, context: ctx, session, signal: new AbortController().signal });
  const parsed = JSON.parse(result.resultPreview!) as { id: string };
  assert.equal(parsed.id, inScopeId);
});

test("effect tools without an application binding fail closed instead of faking success", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const ctx = veterinarian(store);
  const executor = createAgentToolExecutor({ store });
  for (const name of ["cvg.communication.stage", "cvg.stock.dispense", "cvg.finance.refund"]) {
    await assert.rejects(
      executor({ tool: tool(name), parsedInput: {}, context: ctx, session, signal: new AbortController().signal }),
      (error: unknown) => error instanceof AgentToolExecutorNotBoundError
    );
  }
});
