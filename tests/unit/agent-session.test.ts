import test from "node:test";
import assert from "node:assert/strict";
import { AgentSessionError, MemoryAgentSessionStore, checkpointDigest, type SqlExecutor } from "@cvg/agent-session";

function store(now = 1_000_000): { store: MemoryAgentSessionStore; advance: (ms: number) => void } {
  let current = now;
  const instance = new MemoryAgentSessionStore({ now: () => current });
  return { store: instance, advance: (ms) => (current += ms) };
}

const scope = { organizationId: "org-1", actorId: "actor-1" };

test("session store creates, loads and completes a scoped session", async () => {
  const { store: sessions } = store();
  const created = await sessions.create({ sessionId: "s1", organizationId: "org-1", actorId: "actor-1", unitId: "u1", workspaceId: "w1", purpose: "SUMMARY", taskObjective: "resumir", ttlMs: 60_000 });
  assert.equal(created.status, "ACTIVE");
  assert.equal(created.runState, "CREATED");
  assert.equal(created.fence, 0);
  assert.ok(await sessions.load("s1", scope));
  assert.equal(await sessions.load("s1", { organizationId: "org-2", actorId: "actor-1" }), null);
  const completed = await sessions.complete({ sessionId: "s1", organizationId: "org-1", fence: 0, runState: "COMPLETED" });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.runState, "COMPLETED");
});

test("leases fence concurrent owners and reject stale writers", async () => {
  const { store: sessions, advance } = store();
  await sessions.create({ sessionId: "s1", organizationId: "org-1", actorId: "actor-1", unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "x", ttlMs: 60_000 });
  const first = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "instance-a", ttlMs: 1_000 });
  assert.ok(first);
  assert.equal(first!.fence, 1);
  const blocked = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "instance-b", ttlMs: 1_000 });
  assert.equal(blocked, null);
  advance(2_000);
  const second = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "instance-b", ttlMs: 1_000 });
  assert.ok(second);
  assert.equal(second!.fence, 2);
  await assert.rejects(
    sessions.checkpoint({ sessionId: "s1", organizationId: "org-1", fence: first!.fence, payload: { state: "stale" } }),
    (error: unknown) => error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE"
  );
  const current = await sessions.checkpoint({ sessionId: "s1", organizationId: "org-1", fence: second!.fence, payload: { state: "current" } });
  assert.equal(current.fence, 2);
});

test("renew and release require the current owner and fence", async () => {
  const { store: sessions } = store();
  await sessions.create({ sessionId: "s1", organizationId: "org-1", actorId: "actor-1", unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "x", ttlMs: 60_000 });
  const lease = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000 });
  assert.ok(lease);
  assert.equal(await sessions.renewLease({ sessionId: "s1", organizationId: "org-1", ownerId: "b", ttlMs: 60_000, fence: lease!.fence }), null);
  assert.ok(await sessions.renewLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000, fence: lease!.fence }));
  await sessions.releaseLease({ sessionId: "s1", organizationId: "org-1", ownerId: "b", fence: lease!.fence });
  assert.equal(await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "c", ttlMs: 1_000 }), null);
  await sessions.releaseLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", fence: lease!.fence });
  assert.ok(await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "c", ttlMs: 1_000 }));
});

test("checkpoint is append-only, versioned and tamper-evident", async () => {
  const { store: sessions } = store();
  await sessions.create({ sessionId: "s1", organizationId: "org-1", actorId: "actor-1", unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "x", ttlMs: 60_000 });
  const lease = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000 });
  assert.ok(lease);
  const first = await sessions.checkpoint({ sessionId: "s1", organizationId: "org-1", fence: lease!.fence, payload: { turn: 1 } });
  const second = await sessions.checkpoint({ sessionId: "s1", organizationId: "org-1", fence: lease!.fence, payload: { turn: 2 } });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(first.digest, checkpointDigest({ turn: 1 }, 1));
  const latest = await sessions.latestCheckpoint("s1", scope);
  assert.equal(latest?.sequence, 2);
  assert.equal(latest?.digest, checkpointDigest({ turn: 2 }, 1));
});

test("turn ledger is append-only and fenced", async () => {
  const { store: sessions } = store();
  await sessions.create({ sessionId: "s1", organizationId: "org-1", actorId: "actor-1", unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "x", ttlMs: 60_000 });
  const lease = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000 });
  assert.ok(lease);
  const entry = {
    turnId: "t1",
    sessionId: "s1",
    organizationId: "org-1",
    sequence: 0,
    status: "COMPLETED" as const,
    inputDigest: "i".repeat(64),
    contextDigest: "c".repeat(64),
    modelRequestDigest: "m".repeat(64),
    modelResponseDigest: "r".repeat(64),
    toolRequestIds: [],
    usageRecordId: null,
    provenance: { provider: "mock" },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    fence: lease!.fence
  };
  const appended = await sessions.appendTurn(entry);
  assert.equal(appended.sequence, 1);
  await assert.rejects(
    sessions.appendTurn({ ...entry, fence: lease!.fence + 1 }),
    (error: unknown) => error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE"
  );
  await assert.rejects(
    sessions.appendTurn(entry),
    (error: unknown) => error instanceof AgentSessionError && error.code === "SESSION_INVALID"
  );
  const turns = await sessions.listTurns("s1", scope);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.turnId, "t1");
});

test("postgres session store rejects a stale fence and numbers sequences globally per session", async () => {
  const queries: { text: string; params: readonly unknown[] }[] = [];
  let authoritativeFence = 5;
  const executor: SqlExecutor = {
    async query(text, params) {
      queries.push({ text, params });
      if (/INSERT INTO agent_checkpoints/.test(text)) {
        const requestedFence = Number(params[5]);
        if (requestedFence !== authoritativeFence) return { rows: [] };
        return { rows: [{ checkpoint_id: "1", session_id: "s1", organization_id: "org-1", sequence: 3, schema_version: 1, digest: params[3], payload: JSON.parse(String(params[4])), fence: requestedFence, created_at: new Date() }] };
      }
      if (/INSERT INTO agent_turns/.test(text)) {
        const requestedFence = Number(params[13]);
        if (requestedFence !== authoritativeFence) return { rows: [] };
        return { rows: [{ turn_id: params[0], session_id: "s1", organization_id: "org-1", sequence: 7, status: params[3], input_digest: params[4], context_digest: params[5], model_request_digest: params[6], model_response_digest: params[7], tool_request_ids: [], usage_record_id: null, provenance: {}, started_at: new Date(), completed_at: null, fence: requestedFence }] };
      }
      if (/UPDATE agent_sessions/.test(text)) return { rows: [] };
      return { rows: [] };
    }
  };
  const { PostgresAgentSessionStore } = await import("@cvg/agent-session");
  const sessions = new PostgresAgentSessionStore({
    async withScopedTransaction<T>(organizationId: string, run: (query: SqlExecutor["query"]) => Promise<T>): Promise<T> {
      assert.equal(organizationId, "org-1");
      return run(executor.query);
    }
  });
  const checkpoint = await sessions.checkpoint({ sessionId: "s1", organizationId: "org-1", fence: 5, payload: { turn: 1 } });
  assert.equal(checkpoint.sequence, 3);
  await assert.rejects(
    sessions.checkpoint({ sessionId: "s1", organizationId: "org-1", fence: 4, payload: { turn: 2 } }),
    (error: unknown) => error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE"
  );
  const turn = await sessions.appendTurn({
    turnId: "t1", sessionId: "s1", organizationId: "org-1", sequence: 0, status: "COMPLETED",
    inputDigest: "i".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null,
    toolRequestIds: [], usageRecordId: null, provenance: {}, startedAt: new Date().toISOString(), completedAt: null, fence: 5
  });
  assert.equal(turn.sequence, 7);
  await assert.rejects(
    sessions.appendTurn({
      turnId: "t2", sessionId: "s1", organizationId: "org-1", sequence: 0, status: "COMPLETED",
      inputDigest: "j".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null,
      toolRequestIds: [], usageRecordId: null, provenance: {}, startedAt: new Date().toISOString(), completedAt: null, fence: 3
    }),
    (error: unknown) => error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE"
  );
  const checkpointSql = queries.find((query) => query.text.includes("INSERT INTO agent_checkpoints"))?.text ?? "";
  assert.match(checkpointSql, /WHERE EXISTS \(SELECT 1 FROM agent_sessions/);
  assert.match(checkpointSql, /MAX\(sequence\), 0\) \+ 1 FROM agent_checkpoints WHERE session_id = \$1/);
  const turnSql = queries.find((query) => query.text.includes("INSERT INTO agent_turns"))?.text ?? "";
  assert.match(turnSql, /WHERE EXISTS \(SELECT 1 FROM agent_sessions/);
  assert.doesNotMatch(turnSql, /FROM agent_turns WHERE session_id = \$2 AND fence/);
  void authoritativeFence;
});

test("postgres session store issues fenced SQL and rejects stale completion", async () => {
  const queries: { text: string; params: readonly unknown[] }[] = [];
  const executor: SqlExecutor = {
    async query(text, params) {
      queries.push({ text, params });
      if (/INSERT INTO agent_sessions/.test(text)) {
        return { rows: [{ session_id: "s1", organization_id: "org-1", actor_id: "actor-1", unit_id: null, workspace_id: null, purpose: "SUMMARY", task_objective: "x", status: "ACTIVE", run_state: "CREATED", fence: 0, checkpoint_digest: null, created_at: new Date(), updated_at: new Date(), expires_at: new Date() }] };
      }
      if (/INSERT INTO agent_leases/.test(text)) {
        return { rows: [{ session_id: "s1", owner_id: "a", fence: 1, acquired_at: new Date(), expires_at: new Date() }] };
      }
      if (/UPDATE agent_sessions SET run_state/.test(text)) return { rows: [] };
      return { rows: [] };
    }
  };
  const { PostgresAgentSessionStore } = await import("@cvg/agent-session");
  const scoped = {
    async withScopedTransaction<T>(organizationId: string, run: (query: SqlExecutor["query"]) => Promise<T>): Promise<T> {
      assert.equal(organizationId, "org-1");
      return run(executor.query);
    }
  };
  const sessions = new PostgresAgentSessionStore(scoped);
  const created = await sessions.create({ sessionId: "s1", organizationId: "org-1", actorId: "actor-1", unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "x", ttlMs: 60_000 });
  assert.equal(created.sessionId, "s1");
  const lease = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000 });
  assert.equal(lease?.fence, 1);
  await assert.rejects(
    sessions.complete({ sessionId: "s1", organizationId: "org-1", fence: 99, runState: "COMPLETED" }),
    (error: unknown) => error instanceof AgentSessionError && error.code === "DENIED_STALE_FENCE"
  );
  assert.ok(queries.some((query) => /ON CONFLICT \(session_id\) DO UPDATE/.test(query.text)));
});
