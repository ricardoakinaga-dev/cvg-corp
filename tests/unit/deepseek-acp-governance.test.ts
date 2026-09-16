import test from "node:test";
import assert from "node:assert/strict";
import { CvgStore, DomainError } from "@cvg/domain";
import { id, type AiTurnInput, type OpaqueId } from "@cvg/contracts";
import type { DeepSeekAcpGovernance } from "@cvg/deepseek-bridge";
import { createDurableDeepSeekAcpGovernance, type DurableAcpGovernanceBudgetPort } from "@cvg/harness-adapters";

const facts = { engineCommit: "commit-acp-test-1", profileDigest: "sha256:profile-acp-test" };

function context(store: CvgStore, userId: OpaqueId) {
  const option = store.contextOptions(userId)[0];
  assert.ok(option);
  const session = store.createSession(userId, `acp-test-token-${userId}`, `acp-test-csrf-${userId}`, 60);
  return store.resolveContext(userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "test", "deepseek-acp-governance", null, null, session.id);
}

function userByLogin(store: CvgStore, prefix: string): OpaqueId {
  const user = [...store.users.values()].find((candidate) => candidate.login.startsWith(prefix));
  assert.ok(user, `usuário ${prefix} ausente no seed`);
  return user.id;
}

function input(overrides: Partial<AiTurnInput> = {}): AiTurnInput {
  return { sessionId: null, prompt: "resumo operacional sintético", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "governance-test-key", ...overrides };
}

function budgetRecorder() {
  const calls: string[] = [];
  const budget: DurableAcpGovernanceBudgetPort = {
    reserve: (units) => { const reservationId = `res-${calls.length}`; calls.push(`reserve:${units}`); return reservationId; },
    settle: (reservationId, actualUnits) => { calls.push(`settle:${reservationId}:${actualUnits === null ? "unknown" : String(actualUnits)}`); },
    release: (reservationId) => { calls.push(`release:${reservationId}`); }
  };
  return { budget, calls };
}

test("sessão ACP durável é recarregada após restart com o profile atestado e respeita escopo", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarian = userByLogin(store, "ana.");
  const ctx = context(store, veterinarian);
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === ctx.unitId && candidate.workspaceId === ctx.workspaceId);
  assert.ok(patient);
  const { budget } = budgetRecorder();
  const first = createDurableDeepSeekAcpGovernance({ store, budget });
  const created = await first.createSession(ctx, { purpose: "OPERATIONS", patientId: patient.id, encounterId: null }, facts);
  assert.equal(created.engineCommit, facts.engineCommit);
  assert.equal(created.profileDigest, facts.profileDigest);

  const restarted = createDurableDeepSeekAcpGovernance({ store, budget });
  const loaded = await restarted.loadSession(ctx, created.id);
  assert.ok(loaded);
  assert.equal(loaded.id, created.id);
  const authorization = await restarted.authorizeTurn(ctx, loaded, input({ sessionId: created.id, patientId: patient.id, requestedTool: "cvg.patient.read", resourceId: patient.id }), null);
  assert.equal(authorization.disposition, "ALLOW");

  const reception = context(store, userByLogin(store, "bia."));
  assert.equal(await restarted.loadSession(reception, created.id), null);
  await assert.rejects(() => restarted.replay(reception, created.id));
});

test("tool fora do catálogo ou role sem alçada resultam em DENY com turno persistido", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const reception = context(store, userByLogin(store, "bia."));
  const governance = createDurableDeepSeekAcpGovernance({ store });
  const session = await governance.createSession(reception, { purpose: "OPERATIONS", patientId: null, encounterId: null }, facts);

  const unknown = await governance.authorizeTurn(reception, session, input({ sessionId: session.id, requestedTool: "cvg.unknown.tool", idempotencyKey: "deny-unknown" }), null);
  assert.equal(unknown.disposition, "DENY");
  assert.equal(unknown.result?.turn.status, "DENIED");
  assert.equal(unknown.result?.turn.usage?.status, "SETTLED");

  const forbidden = await governance.authorizeTurn(reception, session, input({ sessionId: session.id, requestedTool: "cvg.finance.refund", idempotencyKey: "deny-role" }), null);
  assert.equal(forbidden.disposition, "DENY");
  assert.match(String(forbidden.result?.turn.response), /permissão/);
});

test("ação com aprovação exige decisão humana independente e consome uma única vez", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarian = context(store, userByLogin(store, "ana."));
  const reception = context(store, userByLogin(store, "bia."));
  const { budget } = budgetRecorder();
  const governance: DeepSeekAcpGovernance = createDurableDeepSeekAcpGovernance({ store, budget });
  const session = await governance.createSession(veterinarian, { purpose: "OPERATIONS", patientId: null, encounterId: null }, facts);
  const turnInput = input({ sessionId: session.id, prompt: "preparar comunicação ao tutor", purpose: "OPERATIONS", requestedTool: "cvg.communication.stage", idempotencyKey: "approval-flow" });

  const pending = await governance.authorizeTurn(veterinarian, session, turnInput, null);
  assert.equal(pending.disposition, "APPROVAL_REQUIRED");
  const approvalId = pending.result!.approval!.id;
  assert.equal(pending.result?.turn.status, "RECEIVED");

  const decided = await governance.approve(veterinarian, approvalId, "allowed-once", "revisado no mesmo ator (SAME_ACTOR)");
  assert.equal(decided.decision, "allowed-once");
  assert.equal(decided.decidedBy, veterinarian.actorId);

  const approvedInput = { ...turnInput, approvalId };
  const allowed = await governance.authorizeTurn(veterinarian, session, approvedInput, approvalId);
  assert.equal(allowed.disposition, "ALLOW");
  const completed = await governance.recordTurn(veterinarian, session, approvedInput, { status: "COMPLETED", response: "comunicação preparada", model: "deepseek-test", inputTokens: 12, outputTokens: 8, correlationId: veterinarian.correlationId });
  assert.equal(completed.turn.usage?.status, "SETTLED");
  assert.equal(store.aiApprovals.get(approvalId)?.decision, "consumed");

  const replayed = await governance.authorizeTurn(veterinarian, session, approvedInput, approvalId);
  assert.equal(replayed.disposition, "DENY");
  assert.equal(replayed.result?.turn.response, "comunicação preparada");
});

test("usage ausente vira OUTCOME_UNKNOWN com reconciliação obrigatória e nunca custo zero", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarian = context(store, userByLogin(store, "ana."));
  const { budget } = budgetRecorder();
  const governance = createDurableDeepSeekAcpGovernance({ store, budget });
  const session = await governance.createSession(veterinarian, { purpose: "OPERATIONS", patientId: null, encounterId: null }, facts);
  const usageInput = input({ sessionId: session.id, idempotencyKey: "usage-missing" });
  assert.equal((await governance.authorizeTurn(veterinarian, session, usageInput, null)).disposition, "ALLOW");
  const outcome = await governance.recordTurn(veterinarian, session, usageInput, { status: "OUTCOME_UNKNOWN", response: null, model: "deepseek-test", inputTokens: -1, outputTokens: -1, correlationId: veterinarian.correlationId, reason: "ACP_USAGE_UNAVAILABLE" });
  assert.equal(outcome.turn.status, "OUTCOME_UNKNOWN");
  assert.equal(outcome.turn.usage?.status, "RECONCILIATION_REQUIRED");
  assert.equal(outcome.turn.usage?.settlement?.actualCost?.amountMicros, null);
  assert.equal(outcome.turn.usage?.settlement?.actualCost?.source, "UNAVAILABLE");
  assert.equal(outcome.turn.usage?.settlement?.discrepancy?.status, "NOT_EVALUATED");
  assert.equal(outcome.turn.response, "ACP_USAGE_UNAVAILABLE");
});

test("orçamento reserva antes do dispatch, libera em DENY e mantém retido quando o custo é desconhecido", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const reception = context(store, userByLogin(store, "bia."));
  const { budget, calls } = budgetRecorder();
  const governance = createDurableDeepSeekAcpGovernance({ store, budget });
  const session = await governance.createSession(reception, { purpose: "OPERATIONS", patientId: null, encounterId: null }, facts);

  const unknownTool = await governance.authorizeTurn(reception, session, input({ sessionId: session.id, requestedTool: "cvg.unknown.tool", idempotencyKey: "budget-unknown-tool" }), null);
  assert.equal(unknownTool.disposition, "DENY");
  assert.deepEqual(calls, []);

  const invalidApproval = await governance.authorizeTurn(reception, session, input({ sessionId: session.id, requestedTool: "cvg.communication.stage", idempotencyKey: "budget-deny" }), id("00000000-0000-4000-8000-000000000099"));
  assert.equal(invalidApproval.disposition, "DENY");
  assert.deepEqual(calls, []);

  calls.length = 0;
  const deniedInput = input({ sessionId: session.id, idempotencyKey: "budget-denied-after-admission" });
  assert.equal((await governance.authorizeTurn(reception, session, deniedInput, null)).disposition, "ALLOW");
  await governance.recordTurn(reception, session, deniedInput, { status: "DENIED", response: null, model: "deepseek-test", inputTokens: 0, outputTokens: 0, correlationId: reception.correlationId, reason: "ACP_POLICY_DENIED" });
  assert.deepEqual(calls, ["reserve:7", "release:res-0"]);

  calls.length = 0;
  const allowed = await governance.authorizeTurn(reception, session, input({ sessionId: session.id, idempotencyKey: "budget-settle" }), null);
  assert.equal(allowed.disposition, "ALLOW");
  assert.equal(calls.length, 1);
  await governance.recordTurn(reception, session, input({ sessionId: session.id, idempotencyKey: "budget-settle" }), { status: "COMPLETED", response: "ok", model: "deepseek-test", inputTokens: 4, outputTokens: 2, correlationId: reception.correlationId });
  assert.deepEqual(calls, ["reserve:7", "settle:res-0:6"]);

  calls.length = 0;
  await governance.authorizeTurn(reception, session, input({ sessionId: session.id, idempotencyKey: "budget-unknown" }), null);
  await governance.recordTurn(reception, session, input({ sessionId: session.id, idempotencyKey: "budget-unknown" }), { status: "OUTCOME_UNKNOWN", response: null, model: "deepseek-test", inputTokens: 0, outputTokens: 0, correlationId: reception.correlationId, reason: "ACP_PROMPT_CANCELLED" });
  assert.deepEqual(calls, ["reserve:7", "settle:res-0:unknown"]);
});

test("admissões ACP concorrentes na mesma sessão não reservam duas vezes", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarian = context(store, userByLogin(store, "ana."));
  const { budget, calls } = budgetRecorder();
  const governance = createDurableDeepSeekAcpGovernance({ store, budget });
  const session = await governance.createSession(veterinarian, { purpose: "OPERATIONS", patientId: null, encounterId: null }, facts);
  const turnInput = input({ sessionId: session.id, idempotencyKey: "concurrent-admission" });

  const [first, second] = await Promise.all([
    governance.authorizeTurn(veterinarian, session, turnInput, null),
    governance.authorizeTurn(veterinarian, session, turnInput, null)
  ]);

  assert.deepEqual([first.disposition, second.disposition].sort(), ["ALLOW", "DENY"]);
  assert.equal(calls.filter((call) => call.startsWith("reserve:")).length, 1);
  assert.equal(calls.filter((call) => call.startsWith("settle:")).length, 1);
  assert.equal([...store.aiTurns.values()].filter((turn) => turn.sessionId === session.id && turn.prompt === turnInput.prompt).length, 1);
});

test("resultado ACP com correlationId divergente nunca expõe resposta como concluída", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarian = context(store, userByLogin(store, "ana."));
  const { budget } = budgetRecorder();
  const governance = createDurableDeepSeekAcpGovernance({ store, budget });
  const session = await governance.createSession(veterinarian, { purpose: "OPERATIONS", patientId: null, encounterId: null }, facts);
  const turnInput = input({ sessionId: session.id, idempotencyKey: "correlation-mismatch" });
  assert.equal((await governance.authorizeTurn(veterinarian, session, turnInput, null)).disposition, "ALLOW");

  const result = await governance.recordTurn(veterinarian, session, turnInput, {
    status: "COMPLETED",
    response: "não deve ser exposto",
    model: "deepseek-test",
    inputTokens: 4,
    outputTokens: 2,
    correlationId: "correlation-forjada"
  });

  assert.equal(result.turn.status, "OUTCOME_UNKNOWN");
  assert.equal(result.turn.response, "ACP_CORRELATION_MISMATCH");
  assert.equal(result.turn.usage?.status, "RECONCILIATION_REQUIRED");
});

test("promoção de rascunho cria documento clínico durável e não promove duas vezes", async () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const veterinarian = context(store, userByLogin(store, "ana."));
  const patient = [...store.patients.values()].find((candidate) => candidate.unitId === veterinarian.unitId && candidate.workspaceId === veterinarian.workspaceId);
  assert.ok(patient);
  const encounter = store.createEncounter(veterinarian, { patientId: patient.id, appointmentId: null, chiefComplaint: "promoção ACP", urgency: "ROUTINE" });
  const { budget } = budgetRecorder();
  const governance = createDurableDeepSeekAcpGovernance({ store, budget });
  const session = await governance.createSession(veterinarian, { purpose: "DRAFT_CLINICAL", patientId: patient.id, encounterId: encounter.id }, facts);
  const draftInput = input({ sessionId: session.id, prompt: "rascunho", purpose: "DRAFT_CLINICAL", patientId: patient.id, encounterId: encounter.id, idempotencyKey: "draft-turn" });
  assert.equal((await governance.authorizeTurn(veterinarian, session, draftInput, null)).disposition, "ALLOW");
  const turn = await governance.recordTurn(veterinarian, session, draftInput, { status: "COMPLETED", response: "evolução proposta", model: "deepseek-test", inputTokens: 5, outputTokens: 3, correlationId: veterinarian.correlationId });
  assert.ok(turn.draft);

  const promotion = await governance.promoteDraft(veterinarian, turn.draft!.id);
  assert.equal(promotion.draft.status, "PROMOTED");
  assert.ok(store.clinicalDocuments.get(promotion.documentId));
  await assert.rejects(() => governance.promoteDraft(veterinarian, turn.draft!.id), (error: unknown) => error instanceof DomainError || error instanceof Error);
});
