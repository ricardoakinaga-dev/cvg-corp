import test from "node:test";
import assert from "node:assert/strict";
import { DisabledAgentRuntime } from "../../packages/agent-runtime/src/disabled.ts";
import { AgentRuntimeUnavailableError } from "../../packages/agent-runtime/src/errors.ts";

test("disabled agent runtime keeps the hospital operational and fails closed", async () => {
  const runtime = new DisabledAgentRuntime();
  assert.equal(runtime.adapterId, "disabled");
  const health = await runtime.health();
  assert.equal(health.status, "DISABLED");
  assert.equal(health.capabilities.provider, "none");
  assert.deepEqual(health.capabilities.toolNames, []);
  assert.equal(health.capabilities.supports.approvals, false);
  await assert.rejects(() => runtime.createSession({} as never, {} as never), (error: unknown) => error instanceof AgentRuntimeUnavailableError);
  await assert.rejects(() => runtime.executeTurn({} as never, {} as never), (error: unknown) => error instanceof AgentRuntimeUnavailableError);
  await assert.rejects(() => runtime.approve({} as never, "approval" as never, "allowed-once", null), (error: unknown) => error instanceof AgentRuntimeUnavailableError);
  await assert.rejects(() => runtime.promoteDraft({} as never, "draft" as never), (error: unknown) => error instanceof AgentRuntimeUnavailableError);
  await assert.rejects(() => runtime.replay({} as never, "session" as never), (error: unknown) => error instanceof AgentRuntimeUnavailableError);
  await runtime.shutdown();
});
