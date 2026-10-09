import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRuntime } from "@cvg/api";
import { CvgStore } from "@cvg/domain";
import { id, type CvgContext, type OpaqueId } from "@cvg/contracts";
import { EmbeddedAgentRuntime, DEFAULT_RUNTIME_CONTROLS, type EmbeddedToolExecutor } from "@cvg/embedded-agent-runtime";
import type { ModelProvider, ModelProviderCapabilities, ModelProviderDataPolicy, ModelProviderHealth, ModelRequest, ModelResponse } from "@cvg/model-runtime";
import { createAgentToolExecutor } from "../../apps/api/src/agent-tool-executor.ts";

/**
 * CVG-AUD19-002 (origem AUD-2026-001): regressão HTTP cross-workspace com
 * provider-capture.  Prova que (a) um recurso de outro workspace da mesma
 * organização não alcança o executor/provider, (b) divergência entre
 * resourceId e encounterId falha fechado e (c) o caminho same-workspace
 * autorizado continua funcional.
 */

const password = "synthetic-password-123";

interface CapturedToolExecution {
  tool: string;
  resourceId: string | null;
  contextWorkspaceId: string | null;
}

class CaptureModelProvider implements ModelProvider {
  readonly providerId = "aud19-capture-provider";
  readonly requests: ModelRequest[] = [];

  async health(): Promise<ModelProviderHealth> {
    return { status: "READY", checkedAt: new Date().toISOString(), reason: null, latencyMs: 0 };
  }

  capabilities(): ModelProviderCapabilities {
    return { toolCalling: true, structuredOutput: true, streaming: false, reasoning: false, vision: false, contextWindow: 32_768, maxOutput: 2_048 };
  }

  dataPolicy(): ModelProviderDataPolicy {
    return { allowedDataClasses: ["D0", "D1", "D2", "D3"], region: "local", retention: "SESSION", training: "NONE" };
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    const payload = JSON.stringify({ messages: request.messages, system: request.systemInstructions });
    return {
      reply: { kind: "MESSAGE", content: "Resposta sintética de captura." },
      usage: { inputTokens: 8, outputTokens: 6, costMicros: null, currency: null, source: "LOCAL_SYNTHETIC" },
      providerId: this.providerId,
      model: "aud19-capture",
      responseDigest: createHash("sha256").update(payload).digest("hex"),
      finishReason: "stop",
      providerRequestId: null,
      retryable: false
    };
  }

  cancel(): boolean {
    return true;
  }

  capturedText(): string {
    return JSON.stringify(this.requests.map((request) => ({ messages: request.messages, system: request.systemInstructions, purpose: request.purpose })));
  }
}

let runtime: Awaited<ReturnType<typeof createRuntime>>;
let provider: CaptureModelProvider;
const toolExecutions: CapturedToolExecution[] = [];
let foreignEncounterId: OpaqueId;
let foreignPatientId: OpaqueId;
let inScopeEncounterId: OpaqueId;
let inScopePatientId: OpaqueId;

function userByLogin(store: CvgStore, login: string) {
  const user = [...store.users.values()].find((candidate) => candidate.login === login);
  assert.ok(user, `fixture user ${login} must exist`);
  return user;
}

function contextFor(store: CvgStore, userId: OpaqueId, predicate: (option: ReturnType<CvgStore["contextOptions"]>[number]) => boolean, correlation: string): CvgContext {
  const option = store.contextOptions(userId).find(predicate);
  assert.ok(option, `fixture context for ${userId} must exist`);
  const session = store.createSession(userId, `${correlation}-token`, `${correlation}-csrf`, 60);
  return store.resolveContext(userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", correlation, null, null, session.id);
}

function makeClient() {
  let cookies = "";
  let csrf = "";
  let context: { unit: { id: string }; workspace: { id: string } } | null = null;
  const saveCookies = (value: unknown): void => {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    const pairs = values.map((item) => (typeof item === "string" ? item.split(";")[0] : "")).filter((item): item is string => Boolean(item));
    const map = new Map<string, string>();
    for (const item of cookies.split("; ").filter(Boolean)) { const separator = item.indexOf("="); if (separator > 0) map.set(item.slice(0, separator), item.slice(separator + 1)); }
    for (const pair of pairs) { const separator = pair.indexOf("="); if (separator > 0) map.set(pair.slice(0, separator), pair.slice(separator + 1)); }
    cookies = [...map.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    csrf = decodeURIComponent(map.get("cvg_csrf") ?? "");
  };
  const request = async (path: string, init: { method?: string; payload?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(init.payload ? { "content-type": "application/json" } : {}), cookie: cookies, ...(context ? { "x-cvg-unit-id": context.unit.id, "x-cvg-workspace-id": context.workspace.id } : {}), ...(init.headers ?? {}) };
    if (init.method && init.method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
    const injectRequest = runtime.app.inject.bind(runtime.app) as unknown as (options: { method: string; url: string; headers: Record<string, string>; payload?: string }) => Promise<{ statusCode: number; body: string; headers: Record<string, unknown> }>;
    const options: { method: string; url: string; headers: Record<string, string>; payload?: string } = { method: init.method ?? "GET", url: `/api/v1${path}`, headers };
    if (init.payload) options.payload = JSON.stringify(init.payload);
    const result = await injectRequest(options);
    saveCookies(result.headers["set-cookie"]);
    return { statusCode: result.statusCode, body: JSON.parse(result.body) as { schemaVersion: number; data?: unknown; error?: { code: string; message: string }; correlationId: string } };
  };
  return {
    request,
    login: async (login: string, secret: string) => {
      const result = await request("/auth/login", { method: "POST", payload: { login, password: secret } });
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      const data = result.body.data as { contexts?: Array<{ unit: { id: string }; workspace: { id: string } }> } | undefined;
      context = data?.contexts?.[0] ?? null;
    }
  };
}

before(async () => {
  const store = new CvgStore({ bootstrapPassword: password });
  const admin = userByLogin(store, "admin@cvg.local");
  const reception = contextFor(store, admin.id, (option) => option.unit.code === "CTR" && option.workspace.name === "Recepção", "aud19-setup-reception");
  const patientB = store.patients.get(id("00000000-0000-4000-8000-000000000112"));
  assert.ok(patientB);
  foreignPatientId = patientB.id;
  const foreign = store.createEncounter(reception, { patientId: patientB.id, appointmentId: null, chiefComplaint: "recurso de outro workspace", urgency: "ROUTINE" });
  foreignEncounterId = foreign.id;

  const vet = userByLogin(store, "ana.vet@cvg.local");
  const clinical = contextFor(store, vet.id, (option) => option.unit.code === "CTR" && option.workspace.name === "Operação clínica", "aud19-setup-clinical");
  const patientA = store.patients.get(id("00000000-0000-4000-8000-000000000111"));
  assert.ok(patientA);
  inScopePatientId = patientA.id;
  const inScope = store.createEncounter(clinical, { patientId: patientA.id, appointmentId: null, chiefComplaint: "recurso autorizado", urgency: "ROUTINE" });
  inScopeEncounterId = inScope.id;

  provider = new CaptureModelProvider();
  const baseExecutor = createAgentToolExecutor({ store });
  const captureExecutor: EmbeddedToolExecutor = async (input) => {
    toolExecutions.push({ tool: input.tool.name, resourceId: input.session.encounterId ? String(input.session.encounterId) : null, contextWorkspaceId: input.context.workspaceId ? String(input.context.workspaceId) : null });
    return baseExecutor(input);
  };
  const agentRuntime = new EmbeddedAgentRuntime({
    store,
    modelProvider: provider,
    toolExecutor: captureExecutor,
    instanceId: "aud19-isolation-test",
    controls: () => ({ ...DEFAULT_RUNTIME_CONTROLS })
  });
  runtime = await createRuntime({ store, agentRuntime, config: { storageMode: "memory", demoMode: true, webOrigin: "http://127.0.0.1:5173" } });
});

after(async () => {
  await runtime.app.close();
});

function turnPayload(input: { resourceId: string | null; encounterId: string | null; patientId: string | null; key: string }) {
  return {
    sessionId: null,
    prompt: "Produza um rascunho clínico do atendimento informado.",
    purpose: "DRAFT_CLINICAL",
    patientId: input.patientId,
    encounterId: input.encounterId,
    resourceId: input.resourceId,
    requestedTool: "cvg.clinical.draft",
    idempotencyKey: input.key
  };
}

test("CVG-AUD19-002: recurso de outro workspace da mesma organização nao alcanca tool nem provider", async () => {
  const before = toolExecutions.length;
  const beforeRequests = provider.requests.length;
  const vet = makeClient();
  await vet.login("ana.vet@cvg.local", "veterinario-synthetic-0002");
  const response = await vet.request("/ai/turns", { method: "POST", payload: turnPayload({ resourceId: foreignEncounterId, encounterId: null, patientId: null, key: "aud19-cross-workspace-1" }) });
  const status = response.statusCode === 201 ? (response.body.data as { turn?: { status?: string } } | undefined)?.turn?.status : undefined;
  assert.notEqual(status, "COMPLETED", `cross-workspace resource must not complete: ${JSON.stringify(response.body).slice(0, 600)}`);
  assert.equal(toolExecutions.length, before, "no tool execution may happen for a foreign-workspace resource");
  assert.equal(provider.requests.length, beforeRequests, "no provider request may happen for a foreign-workspace resource");
  const captured = provider.capturedText();
  assert.equal(captured.includes(String(foreignEncounterId)), false, "foreign encounter id must never reach the provider");
  assert.equal(captured.includes(String(foreignPatientId)), false, "foreign patient id must never reach the provider");
});

test("CVG-AUD19-002: divergencia entre resourceId e encounterId falha fechado", async () => {
  const before = toolExecutions.length;
  const beforeRequests = provider.requests.length;
  const vet = makeClient();
  await vet.login("ana.vet@cvg.local", "veterinario-synthetic-0002");
  const response = await vet.request("/ai/turns", { method: "POST", payload: turnPayload({ resourceId: foreignEncounterId, encounterId: inScopeEncounterId, patientId: inScopePatientId, key: "aud19-divergence-1" }) });
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.equal(response.body.error?.code, "DIVERGENT");
  assert.equal(toolExecutions.length, before, "divergence must not dispatch the tool");
  assert.equal(provider.requests.length, beforeRequests, "divergence must not dispatch to the provider");
});

test("CVG-AUD20-006: patient resourceId plus encounterId is divergent and never reaches tool or provider", async () => {
  const before = toolExecutions.length;
  const beforeRequests = provider.requests.length;
  const vet = makeClient();
  await vet.login("ana.vet@cvg.local", "veterinario-synthetic-0002");
  const response = await vet.request("/ai/turns", { method: "POST", payload: turnPayload({ resourceId: inScopePatientId, encounterId: inScopeEncounterId, patientId: inScopePatientId, key: "aud20-divergent-patient-encounter" }) });
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.equal(response.body.error?.code, "DIVERGENT");
  assert.equal(toolExecutions.length, before, "divergence must not dispatch the tool");
  assert.equal(provider.requests.length, beforeRequests, "divergence must not reach the provider");
});

test("CVG-AUD21-003: ID desconhecido ao lado de identidade conhecida é DIVERGENT, não NOT_FOUND", async () => {
  const before = toolExecutions.length;
  const beforeRequests = provider.requests.length;
  const vet = makeClient();
  await vet.login("ana.vet@cvg.local", "veterinario-synthetic-0002");
  const response = await vet.request("/ai/turns", { method: "POST", payload: turnPayload({ resourceId: inScopePatientId, encounterId: id("00000000-0000-4000-8000-000000000903"), patientId: inScopePatientId, key: "aud21-divergent-unknown-encounter" }) });
  assert.equal(response.statusCode, 409, JSON.stringify(response.body));
  assert.equal(response.body.error?.code, "DIVERGENT");
  assert.equal(toolExecutions.length, before, "partially-known divergence must not dispatch the tool");
  assert.equal(provider.requests.length, beforeRequests, "partially-known divergence must not reach the provider");
});

test("CVG-AUD19-002: fluxo same-workspace autorizado continua funcional", async () => {
  const before = toolExecutions.length;
  const beforeRequests = provider.requests.length;
  const vet = makeClient();
  await vet.login("ana.vet@cvg.local", "veterinario-synthetic-0002");
  const response = await vet.request("/ai/turns", { method: "POST", payload: turnPayload({ resourceId: inScopeEncounterId, encounterId: inScopeEncounterId, patientId: inScopePatientId, key: "aud19-same-workspace-1" }) });
  assert.equal(response.statusCode, 201, JSON.stringify(response.body).slice(0, 600));
  const turn = (response.body.data as { turn: { status: string } }).turn;
  assert.equal(turn.status, "COMPLETED");
  assert.equal(toolExecutions.length, before + 1, "the authorized resource must dispatch exactly one tool execution");
  assert.equal(provider.requests.length, beforeRequests + 1, "the authorized flow must reach the provider exactly once");
  const captured = provider.capturedText();
  assert.equal(captured.includes(String(inScopeEncounterId)), true, "the authorized resource may reach the provider");
});
