import test from "node:test";
import assert from "node:assert/strict";
import { AgentSessionError, MemoryAgentSessionStore, checkpointDigest, type SqlExecutor } from "@cvg/agent-session";
import { verifyAgentSessionTtlContract } from "../../scripts/lib/agent-session-contract.ts";

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
  await assert.rejects(
    sessions.complete({ sessionId: "s1", organizationId: "org-1", fence: 0, runState: "QUARANTINED_RESTORE" }),
    (error: unknown) => error instanceof AgentSessionError && error.code === "SESSION_INVALID"
  );
  const completed = await sessions.complete({ sessionId: "s1", organizationId: "org-1", fence: 0, runState: "COMPLETED" });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.runState, "COMPLETED");
});

test("terminal completion invalidates lease authority and keeps cleanup idempotent", async () => {
  const { store: sessions } = store();
  await sessions.create({ sessionId: "s1", organizationId: "org-1", actorId: "actor-1", unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "x", ttlMs: 60_000 });
  const lease = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000 });
  assert.ok(lease);
  await sessions.complete({ sessionId: "s1", organizationId: "org-1", fence: lease!.fence, runState: "COMPLETED" });
  assert.equal(await sessions.renewLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000, fence: lease!.fence }), null);
  await sessions.releaseLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", fence: lease!.fence });
  assert.equal(await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "b", ttlMs: 60_000 }), null);
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

test("CVG-AUD19-003: TTL expirado bloqueia load, lease, renovacao e operacoes terminais", async () => {
  const { store: sessions, advance } = store();
  const failures = await verifyAgentSessionTtlContract({
    store: sessions,
    organizationId: "org-1",
    actorId: "actor-1",
    unitId: "u1",
    workspaceId: "w1",
    sessionId: "ttl-memory-1",
    ttlMs: 30,
    expireSession: async () => { advance(31); }
  });
  assert.deepEqual(failures, []);
});

test("CVG-AUD21-010: TTL boundary remains deterministic across 20 repetitions", async () => {
  const { store: sessions, advance } = store();
  for (let iteration = 1; iteration <= 20; iteration += 1) {
    const sessionId = `ttl-matrix-${iteration}`;
    await sessions.create({ sessionId, organizationId: "org-1", actorId: "actor-1", unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "boundary", ttlMs: 1_000 });
    assert.ok(await sessions.load(sessionId, scope));
    const lease = await sessions.acquireLease({ sessionId, organizationId: "org-1", ownerId: `owner-a-${iteration}`, ttlMs: 1_000 });
    assert.ok(lease);
    assert.equal(await sessions.acquireLease({ sessionId, organizationId: "org-1", ownerId: `owner-b-${iteration}`, ttlMs: 1_000 }), null);
    assert.ok(await sessions.renewLease({ sessionId, organizationId: "org-1", ownerId: lease!.ownerId, ttlMs: 1_000, fence: lease!.fence }));
    advance(1_000);
    assert.equal(await sessions.load(sessionId, scope), null);
    assert.equal(await sessions.acquireLease({ sessionId, organizationId: "org-1", ownerId: `owner-b-at-${iteration}`, ttlMs: 1_000 }), null);
    assert.equal(await sessions.renewLease({ sessionId, organizationId: "org-1", ownerId: lease!.ownerId, ttlMs: 1_000, fence: lease!.fence }), null);
    advance(1);
    assert.equal(await sessions.load(sessionId, scope), null);
    assert.equal(await sessions.acquireLease({ sessionId, organizationId: "org-1", ownerId: `owner-b-after-${iteration}`, ttlMs: 1_000 }), null);
  }
});

test("CVG-AUD19-007: checkpoints and turns are not visible to another actor", async () => {
  const { store: sessions } = store();
  await sessions.create({ sessionId: "s1", organizationId: "org-1", actorId: "actor-1", unitId: null, workspaceId: null, purpose: "SUMMARY", taskObjective: "x", ttlMs: 60_000 });
  const lease = await sessions.acquireLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000 });
  assert.ok(lease);
  await sessions.checkpoint({ sessionId: "s1", organizationId: "org-1", fence: lease!.fence, payload: { turn: 1 } });
  await sessions.appendTurn({
    turnId: "t-actor-scope", sessionId: "s1", organizationId: "org-1", sequence: 0, status: "COMPLETED",
    inputDigest: "i".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null,
    toolRequestIds: [], usageRecordId: null, provenance: { provider: "mock" }, startedAt: "2026-01-01T00:00:00.000Z", completedAt: null, fence: lease!.fence
  });
  assert.equal(await sessions.latestCheckpoint("s1", { organizationId: "org-1", actorId: "actor-2" }), null);
  assert.deepEqual(await sessions.listTurns("s1", { organizationId: "org-1", actorId: "actor-2" }), []);
  assert.equal(await sessions.latestCheckpoint("s1", { organizationId: "org-2", actorId: "actor-1" }), null);
  assert.ok(await sessions.latestCheckpoint("s1", { organizationId: "org-1", actorId: "actor-1" }));
  assert.equal((await sessions.listTurns("s1", { organizationId: "org-1", actorId: "actor-1" })).length, 1);
});

test("postgres session store rejects a stale fence and numbers sequences globally per session", async () => {
  const queries: { text: string; params: readonly unknown[] }[] = [];
  const authoritativeFence = 5;
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
    toolRequestIds: [], usageRecordId: "usage-1", provenance: { provider: "fixture" }, startedAt: new Date().toISOString(), completedAt: null, fence: 5
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
  assert.match(turnSql, /AND \(\$10::uuid IS NULL OR EXISTS \(SELECT 1 FROM ai_usage_ledger AS usage WHERE usage\.id = \$10::uuid AND usage\.organization_id = \$3\)\)/);
  assert.doesNotMatch(turnSql, /usage\.id = \$11/);
  assert.doesNotMatch(turnSql, /FROM agent_turns WHERE session_id = \$2 AND fence/);
  const turnQuery = queries.find((query) => query.text.includes("INSERT INTO agent_turns"));
  assert.equal(turnQuery?.params[9], "usage-1");
  assert.deepEqual(turnQuery?.params[10], JSON.stringify({ provider: "fixture" }));
  void authoritativeFence;
});

test("postgres session store separates invalid usage references from stale fences", async () => {
  const queries: { text: string; params: readonly unknown[] }[] = [];
  const executor: SqlExecutor = {
    async query(text, params) {
      queries.push({ text, params });
      if (/INSERT INTO agent_turns/.test(text)) return { rows: [] };
      if (/SELECT 1 AS session_valid/.test(text)) return { rows: [{ session_valid: true }] };
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

  await assert.rejects(
    sessions.appendTurn({
      turnId: "dangling-usage-turn", sessionId: "s1", organizationId: "org-1", sequence: 0, status: "COMPLETED",
      inputDigest: "i".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null,
      toolRequestIds: [], usageRecordId: "missing-usage", provenance: { provider: "fixture" }, startedAt: new Date().toISOString(), completedAt: null, fence: 5
    }),
    (error: unknown) => error instanceof AgentSessionError && error.code === "SESSION_INVALID" && error.message.includes("usage reference is invalid")
  );
  assert.ok(queries.some((query) => /SELECT 1 AS session_valid/.test(query.text)));
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

test("postgres lease renewal requires an active session and completion deletes its lease", async () => {
  const queries: { text: string; params: readonly unknown[] }[] = [];
  const sessionRow = { session_id: "s1", organization_id: "org-1", actor_id: "actor-1", unit_id: null, workspace_id: null, purpose: "SUMMARY", task_objective: "x", status: "COMPLETED", run_state: "COMPLETED", fence: 1, checkpoint_digest: null, created_at: new Date(), updated_at: new Date(), expires_at: new Date(Date.now() + 60_000) };
  const executor: SqlExecutor = {
    async query(text, params) {
      queries.push({ text, params });
      if (/UPDATE agent_leases SET expires_at/.test(text)) {
        if (/session\.status = 'ACTIVE'/.test(text)) return { rows: [] };
        return { rows: [{ session_id: "s1", organization_id: "org-1", owner_id: "a", fence: 1, acquired_at: new Date(), expires_at: new Date(Date.now() + 60_000) }] };
      }
      if (/UPDATE agent_sessions/.test(text)) return { rows: [sessionRow] };
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

  const renewed = await sessions.renewLease({ sessionId: "s1", organizationId: "org-1", ownerId: "a", ttlMs: 60_000, fence: 1 });
  assert.equal(renewed, null);
  await sessions.complete({ sessionId: "s1", organizationId: "org-1", fence: 1, runState: "COMPLETED" });
  const renewSql = queries.find((query) => /UPDATE agent_leases SET expires_at/.test(query.text))?.text ?? "";
  assert.match(renewSql, /session\.status = 'ACTIVE'/);
  assert.ok(queries.some((query) => /DELETE FROM agent_leases WHERE session_id = \$1 AND organization_id = \$2/.test(query.text)));
});
