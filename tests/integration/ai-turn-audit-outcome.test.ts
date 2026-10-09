import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "@cvg/api";
import { CvgStore } from "@cvg/domain";
import { MemoryAgentSessionStore } from "@cvg/agent-session";
import { EmbeddedAgentRuntime } from "@cvg/embedded-agent-runtime";
import { MockModelProvider } from "@cvg/model-adapters";

async function fixture(t: TestContext, sessionStore?: MemoryAgentSessionStore) {
  const password = "synthetic-audit-outcome-123";
  const store = new CvgStore({ bootstrapPassword: password });
  const agentRuntime = new EmbeddedAgentRuntime({
    store,
    modelProvider: new MockModelProvider(),
    ...(sessionStore ? { sessionStore } : {}),
    runtimeCommit: "test-commit"
  });
  const runtime = await createRuntime({
    store,
    agentRuntime,
    config: { nodeEnv: "test", storageMode: "memory", demoMode: false, secretProvider: "none", agentRuntimeMode: "embedded" }
  });
  t.after(async () => { await runtime.app.close(); });
  const login = await runtime.app.inject({
    method: "POST", url: "/api/v1/auth/login",
    payload: { login: store.getUser(store.bootstrapCredentials.userId).login, password }
  });
  assert.equal(login.statusCode, 200);
  const data = login.json<{ data: { csrfToken: string; contexts: { unit: { id: string }; workspace: { id: string } }[] } }>().data;
  const context = data.contexts[0];
  assert.ok(context);
  const headers = {
    cookie: login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    "x-csrf-token": data.csrfToken,
    "x-cvg-unit-id": context.unit.id,
    "x-cvg-workspace-id": context.workspace.id
  };
  const turn = async (idempotencyKey: string) => {
    const response = await runtime.app.inject({ method: "POST", url: "/api/v1/ai/turns", headers, payload: {
      sessionId: null, prompt: "Resuma a operação do dia.", purpose: "OPERATIONS", patientId: null,
      encounterId: null, requestedTool: null, approvalId: null, idempotencyKey
    } });
    assert.equal(response.statusCode, 201);
    const body = response.json<{ data: { turn: { id: string; status: string }; receiptId: string } }>().data;
    const records = [...store.auditRecords.values()].filter((record) => record.action === "ai.turn" && record.resourceId === body.turn.id);
    const receipt = [...store.commandReceipts.values()].find((candidate) => candidate.id === body.receiptId);
    return { body, records, receipt };
  };
  return { turn };
}

test("ai.turn audit records an unknown turn outcome as UNKNOWN, never as ALLOWED", async (t) => {
  const failingLedger = new Proxy(new MemoryAgentSessionStore(), {
    get(target, property, receiver) {
      if (property === "appendTurn") return async () => { throw new Error("synthetic ledger unavailable"); };
      return Reflect.get(target, property, receiver) as unknown;
    }
  });
  const { turn } = await fixture(t, failingLedger);
  const { body, records, receipt } = await turn("audit-outcome-unknown");
  assert.equal(body.turn.status, "OUTCOME_UNKNOWN");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.result, "UNKNOWN");
  assert.equal(records[0]?.metadata.turnStatus, "OUTCOME_UNKNOWN");
  assert.equal(records[0]?.reason, "turn outcome unknown; reconciliation required");
  // The receipt stays linked to the audit of its own command, now honest about the
  // unknown effect, instead of looking like a receipt that was never audited.
  assert.equal(receipt?.auditRecordId, records[0]?.id);
});

test("ai.turn audit keeps ALLOWED for a completed turn and links its receipt", async (t) => {
  const { turn } = await fixture(t);
  const { body, records, receipt } = await turn("audit-outcome-completed");
  assert.equal(body.turn.status, "COMPLETED");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.result, "ALLOWED");
  assert.equal(records[0]?.metadata.turnStatus, "COMPLETED");
  assert.equal(receipt?.auditRecordId, records[0]?.id);
});
