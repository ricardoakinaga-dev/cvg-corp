import test from "node:test";
import assert from "node:assert/strict";
import { CvgStore, DomainError } from "@cvg/domain";
import { id, type AiTurn, type AiTurnInput, type OpaqueId } from "@cvg/contracts";
import { createDurableDeepSeekAcpGovernance, type DurableAcpGovernanceBudgetPort } from "@cvg/harness-adapters";
import type { AgentRuntime, AgentTurnResult } from "@cvg/agent-runtime";
import { AgentApplicationService } from "../../apps/api/src/application/agent-service.ts";
import { GovernedHarness } from "@cvg/harness";

const facts = { engineCommit: "synthetic-acp-test", profileDigest: "sha256:synthetic-profile" };

function userId(store: CvgStore, prefix: string): OpaqueId {
  const user = [...store.users.values()].find((candidate) => candidate.login.startsWith(prefix));
  assert.ok(user);
  return user.id;
}

function context(store: CvgStore, actorId: OpaqueId): ReturnType<CvgStore["resolveContext"]> {
  const option = store.contextOptions(actorId)[0];
  assert.ok(option);
  const authSession = store.createSession(actorId, `synthetic-token-${actorId}`, `synthetic-csrf-${actorId}`, 60);
  return store.resolveContext(actorId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", "budget-authority-test", null, null, authSession.id);
}

function turnInput(sessionId: OpaqueId, key: string): AiTurnInput {
  return { sessionId, prompt: "resumo operacional sintético", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: key };
}

function budgetRecorder() {
  const calls: string[] = [];
  let next = 0;
  const budget: DurableAcpGovernanceBudgetPort = {
    reserve: (units) => {
      const reservationId = `res-${next++}`;
      calls.push(`reserve:${units}`);
      return reservationId;
    },
    settle: (reservationId, actualUnits) => { calls.push(`settle:${reservationId}:${actualUnits === null ? "unknown" : actualUnits}`); },
    release: (reservationId) => { calls.push(`release:${reservationId}`); }
  };
  return { budget, calls };
}

test("ACP sem budget/reservation falha fechado e não admite dispatch", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const actorId = userId(store, "ana.");
  const ctx = context(store, actorId);
  const governance = createDurableDeepSeekAcpGovernance({ store });
  const session = await governance.createSession(ctx, { purpose: "OPERATIONS", patientId: null, encounterId: null }, facts);

  const authorization = await governance.authorizeTurn(ctx, session, turnInput(session.id, "no-budget"), null);

  assert.equal(authorization.disposition, "DENY");
  assert.equal(authorization.result?.turn.status, "DENIED");
  assert.equal(authorization.result?.turn.usage?.reservationId, null);
  assert.equal([...store.budgetReservations.values()].length, 0);
});

test("ACP reconstituído liquida o vínculo persistido uma vez e replay não executa duas vezes", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const actorId = userId(store, "ana.");
  const ctx = context(store, actorId);
  const { budget, calls } = budgetRecorder();
  const first = createDurableDeepSeekAcpGovernance({ store, budget });
  const session = await first.createSession(ctx, { purpose: "OPERATIONS", patientId: null, encounterId: null }, facts);
  const input = turnInput(session.id, "restart-settlement");

  assert.equal((await first.authorizeTurn(ctx, session, input, null)).disposition, "ALLOW");
  const admission = [...store.aiTurns.values()][0];
  assert.ok(admission);
  assert.equal(admission.status, "RECEIVED");
  assert.equal(admission.usage?.reservationId, "res-0");

  const restarted = createDurableDeepSeekAcpGovernance({ store, budget });
  const completed = await restarted.recordTurn(ctx, session, input, { status: "COMPLETED", response: "resultado sintético", model: "deepseek-test", inputTokens: 4, outputTokens: 2, correlationId: ctx.correlationId });
  assert.equal(completed.turn.status, "COMPLETED");
  assert.equal(completed.turn.usage?.status, "SETTLED");
  assert.equal(completed.turn.usage?.reservationId, "res-0");
  assert.deepEqual(calls, ["reserve:7", "settle:res-0:6"]);

  const replay = await restarted.authorizeTurn(ctx, session, input, null);
  assert.equal(replay.disposition, "DENY");
  await restarted.recordTurn(ctx, session, input, { status: "COMPLETED", response: "resultado duplicado", model: "deepseek-test", inputTokens: 4, outputTokens: 2, correlationId: ctx.correlationId });
  assert.deepEqual(calls, ["reserve:7", "settle:res-0:6"]);
});

test("harness local reutiliza o turno terminal em replay sem nova reserva", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const actorId = userId(store, "ana.");
  const ctx = context(store, actorId);
  const harness = new GovernedHarness(store);
  const input: AiTurnInput = { sessionId: null, prompt: "replay local", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "harness-replay" };

  const first = await harness.executeTurn(ctx, input);
  const replay = await harness.executeTurn(ctx, input);

  assert.equal(replay.turn.id, first.turn.id);
  assert.equal([...store.aiTurns.values()].filter((turn) => turn.usage?.idempotencyKey === first.turn.usage?.idempotencyKey).length, 1);
  assert.equal([...store.budgetReservations.values()].length, 1);
});

test("revogação durante await retém usage e impede COMPLETED/draft no boundary da aplicação", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const actorId = userId(store, "ana.");
  const ctx = context(store, actorId);
  const session = new GovernedHarness(store).createSession(ctx, { purpose: "DRAFT_CLINICAL", patientId: null, encounterId: null });
  const turnId = id("00000000-0000-4000-8000-000000000701");
  const usageId = id("00000000-0000-4000-8000-000000000702");
  const reservationId = id("00000000-0000-4000-8000-000000000703");
  const runtimeResult: AgentTurnResult = {
    session,
    turn: {
      id: turnId,
      sessionId: session.id,
      prompt: "gerar evolução",
      response: "FATO AUTORIZADO QUE NÃO DEVE SER DIVULGADO",
      status: "COMPLETED",
      model: "synthetic-model",
      inputTokens: 5,
      outputTokens: 5,
      references: [{ title: "fonte", source: "synthetic" }],
      provenance: { provider: "synthetic", engineCommit: session.engineCommit, manifestVersion: session.profileDigest, profileDigest: session.profileDigest, policyRevision: ctx.policyRevision, references: [], correlationId: ctx.correlationId, usageRecordId: usageId },
      usage: {
        id: usageId,
        reservationId,
        providerRequestId: "synthetic-request",
        idempotencyKey: "ai-turn:authority-await",
        usageKind: "TOKENS",
        reservedUnits: 100,
        consumedUnits: 900,
        status: "SETTLED",
        record: { source: "synthetic" },
        settlement: {
          model: "synthetic-model",
          inputTokens: 5,
          outputTokens: 5,
          providerResponseDigest: null,
          estimatedCost: { amountMicros: null, currency: null, source: "UNAVAILABLE", pricingRevision: null },
          actualCost: { amountMicros: null, currency: null, source: "UNAVAILABLE", pricingRevision: null },
          discrepancy: { status: "NOT_EVALUATED", deltaMicros: null, reason: "synthetic evidence" }
        }
      },
      createdAt: new Date().toISOString()
    },
    draft: { id: id("00000000-0000-4000-8000-000000000704"), sessionId: session.id, encounterId: null, draftType: "CLINICAL_NOTE", content: "FATO AUTORIZADO QUE NÃO DEVE SER DIVULGADO", sourceTurnId: turnId, status: "DRAFT", createdAt: new Date().toISOString() },
    approval: null,
    provenance: { provider: "synthetic", engineCommit: session.engineCommit, manifestVersion: session.profileDigest, profileDigest: session.profileDigest, policyRevision: ctx.policyRevision, references: [], correlationId: ctx.correlationId, usageRecordId: usageId }
  };
  const runtime: AgentRuntime = {
    adapterId: "synthetic-authority-test",
    health: async () => ({ status: "READY", capabilities: { adapterId: "synthetic-authority-test", provider: "synthetic", engineCommit: session.engineCommit, manifestVersion: session.profileDigest, toolNames: [], supports: { cancellation: true, approvals: true, replay: true, provenance: true } }, checkedAt: new Date().toISOString(), reason: null }),
    createSession: async () => session,
    executeTurn: async () => {
      store.revokeAllSessions(actorId);
      return runtimeResult;
    },
    approve: async () => { throw new Error("not used"); },
    promoteDraft: async () => { throw new Error("not used"); },
    replay: async () => { throw new Error("not used"); },
    shutdown: async () => undefined
  };

  const result = await new AgentApplicationService(store, runtime).executeTurn(ctx, { sessionId: session.id, prompt: "gerar evolução", purpose: "DRAFT_CLINICAL", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "authority-await" });

  assert.equal(result.value.turn.status, "OUTCOME_UNKNOWN");
  assert.equal(result.value.turn.response, null);
  assert.equal(result.value.draft, null);
  assert.equal(result.value.turn.usage?.status, "RECONCILIATION_REQUIRED");
  assert.equal(result.value.turn.usage?.consumedUnits, 900);
  assert.equal([...store.aiTurns.values()].some((turn) => turn.status === "COMPLETED"), false);
  assert.equal([...store.aiDrafts.values()].some((draft) => draft.content.includes("FATO AUTORIZADO")), false);
});
