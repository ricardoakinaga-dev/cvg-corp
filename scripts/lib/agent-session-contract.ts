import { randomUUID } from "node:crypto";
import { AgentSessionError, type AgentSessionScope, type AgentSessionStore } from "@cvg/agent-session";

/**
 * Shared TTL/lease contract for the agent session store (CVG-AUD19-003/008).
 *
 * The exact same assertions run against MemoryAgentSessionStore (unit suite,
 * deterministic clock) and PostgresAgentSessionStore (verify-postgres, real
 * database).  A failure is reported as a named string so the caller can assert
 * an empty list without hiding which invariant broke.
 */
export interface AgentSessionContractInput {
  store: AgentSessionStore;
  organizationId: string;
  actorId: string;
  unitId: string | null;
  workspaceId: string | null;
  sessionId: string;
  /** Session TTL; must be small enough that expireSession() can elapse it. */
  ttlMs: number;
  /** Deterministically makes the session TTL elapse (advance clock or sleep). */
  expireSession(): Promise<void>;
}

export async function verifyAgentSessionTtlContract(input: AgentSessionContractInput): Promise<string[]> {
  const failures: string[] = [];
  const scope: AgentSessionScope = { organizationId: input.organizationId, actorId: input.actorId };
  const base = { sessionId: input.sessionId, organizationId: input.organizationId };
  await input.store.create({ ...base, actorId: input.actorId, unitId: input.unitId, workspaceId: input.workspaceId, purpose: "SUMMARY", taskObjective: "ttl-contract", ttlMs: input.ttlMs });

  const active = await input.store.load(input.sessionId, scope);
  if (!active) {
    failures.push("active session must load before expiry");
    return failures;
  }
  const lease = await input.store.acquireLease({ ...base, ownerId: "contract-owner", ttlMs: 60_000 });
  if (!lease) {
    failures.push("active session must accept a lease");
    return failures;
  }
  const sameOwner = await input.store.acquireLease({ ...base, ownerId: "contract-owner", ttlMs: 60_000 });
  if (sameOwner !== null) failures.push("same owner must not take a live lease for overlapping work");
  const otherOwner = await input.store.acquireLease({ ...base, ownerId: "contract-other", ttlMs: 60_000 });
  if (otherOwner !== null) failures.push("a live lease must block another owner");
  const renewal = await input.store.renewLease({ ...base, ownerId: "contract-owner", ttlMs: 60_000, fence: lease.fence });
  if (!renewal) failures.push("the lease holder must renew before expiry");

  await input.expireSession();

  const expiredLoad = await input.store.load(input.sessionId, scope);
  if (expiredLoad !== null) failures.push("expired session must not load");
  const expiredLease = await input.store.acquireLease({ ...base, ownerId: "contract-other", ttlMs: 60_000 });
  if (expiredLease !== null) failures.push("expired session must not accept a lease");
  const expiredRenew = await input.store.renewLease({ ...base, ownerId: "contract-owner", ttlMs: 60_000, fence: lease.fence });
  if (expiredRenew !== null) failures.push("expired session must not renew a lease");

  const terminalOperations: Array<[string, () => Promise<unknown>]> = [
    ["checkpoint", () => input.store.checkpoint({ ...base, fence: lease.fence, payload: { after: "expiry" } })],
    ["appendTurn", () => input.store.appendTurn({ turnId: randomUUID(), ...base, sequence: 0, status: "COMPLETED", inputDigest: "a".repeat(64), contextDigest: null, modelRequestDigest: null, modelResponseDigest: null, toolRequestIds: [], usageRecordId: null, provenance: { provider: "contract" }, startedAt: new Date().toISOString(), completedAt: null, fence: lease.fence })],
    ["complete", () => input.store.complete({ ...base, fence: lease.fence, runState: "COMPLETED" })]
  ];
  for (const [name, action] of terminalOperations) {
    try {
      await action();
      failures.push(`${name} must fail closed on an expired session`);
    } catch (error) {
      if (!(error instanceof AgentSessionError)) failures.push(`${name} must fail with AgentSessionError, observed ${error instanceof Error ? error.name : typeof error}`);
    }
  }
  const latest = await input.store.latestCheckpoint(input.sessionId, scope);
  if (latest !== null) failures.push("expired session must not expose checkpoints");
  const turns = await input.store.listTurns(input.sessionId, scope);
  if (turns.length !== 0) failures.push("expired session must not expose turns");

  // Fencing must be monotonic across leases, including after a release.
  const fencingSessionId = randomUUID();
  await input.store.create({ ...base, sessionId: fencingSessionId, actorId: input.actorId, unitId: input.unitId, workspaceId: input.workspaceId, purpose: "SUMMARY", taskObjective: "fencing-contract", ttlMs: input.ttlMs });
  const first = await input.store.acquireLease({ ...base, sessionId: fencingSessionId, ownerId: "fence-owner", ttlMs: 60_000 });
  if (!first || first.fence !== 1) failures.push(`first lease fence must be 1, observed ${first?.fence}`);
  if (first) {
    await input.store.releaseLease({ ...base, sessionId: fencingSessionId, ownerId: "fence-owner", fence: first.fence });
    const second = await input.store.acquireLease({ ...base, sessionId: fencingSessionId, ownerId: "fence-owner", ttlMs: 60_000 });
    if (!second || second.fence !== 2) failures.push(`re-acquired lease fence must be 2 after a release, observed ${second?.fence}`);
    if (second) await input.store.releaseLease({ ...base, sessionId: fencingSessionId, ownerId: "fence-owner", fence: second.fence });
  }
  return failures;
}
