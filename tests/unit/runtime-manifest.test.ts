import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_RUNTIME_CONTRACT_VERSION, DisabledAgentRuntime, buildAiUsageSettlement, classifyReplay, runtimeCompatibilitySupported, runtimeManifestDigest, type RuntimeManifest } from "@cvg/agent-runtime";

function manifest(overrides: Partial<RuntimeManifest> = {}): RuntimeManifest {
  return {
    runtimeVersion: "embedded-agent-runtime/1.0.0",
    runtimeCommit: "abc123",
    agentContractVersion: AGENT_RUNTIME_CONTRACT_VERSION,
    pluginApiVersion: "cvg-agent-plugin/1",
    skillSchemaVersion: "cvg-agent-skill/1",
    toolRegistryDigest: "d".repeat(64),
    policyRevision: "local-synthetic-v1",
    supportedModelProviders: ["deepseek", "mock-model"],
    ...overrides
  };
}

test("runtime manifest digest is deterministic and content-bound", () => {
  const first = runtimeManifestDigest(manifest());
  assert.equal(first, runtimeManifestDigest(manifest({ supportedModelProviders: ["mock-model", "deepseek"] })));
  assert.notEqual(first, runtimeManifestDigest(manifest({ runtimeCommit: "def456" })));
  assert.notEqual(first, runtimeManifestDigest(manifest({ toolRegistryDigest: "e".repeat(64) })));
  assert.equal(first.length, 64);
});

test("replay classification never claims exact equivalence across runtimes", () => {
  const recorded = { runtimeVersion: "1.0.0", manifestDigest: "a".repeat(64) };
  assert.equal(classifyReplay(recorded, { ...recorded, agentContractVersion: "AgentRuntimeContract/v1" }, "AgentRuntimeContract/v1"), "EXACT_REPLAY");
  assert.equal(classifyReplay({ runtimeVersion: "1.0.0", manifestDigest: "b".repeat(64) }, { ...recorded, agentContractVersion: "AgentRuntimeContract/v1" }, "AgentRuntimeContract/v1"), "COMPATIBLE_REPLAY");
  assert.equal(classifyReplay({ runtimeVersion: "2.0.0", manifestDigest: "b".repeat(64) }, { ...recorded, agentContractVersion: "AgentRuntimeContract/v2" }, "AgentRuntimeContract/v1"), "NON_EQUIVALENT_REPLAY");
});

test("compatibility matrix fails closed for unknown contract versions", () => {
  const supported = { agentContract: [AGENT_RUNTIME_CONTRACT_VERSION], pluginApi: ["cvg-agent-plugin/1"], skillSchema: ["cvg-agent-skill/1"] };
  assert.equal(runtimeCompatibilitySupported({ cvgProductVersion: "0.1.0", agentRuntimeContract: AGENT_RUNTIME_CONTRACT_VERSION, pluginApiVersion: "cvg-agent-plugin/1", skillSchemaVersion: "cvg-agent-skill/1", toolSchemaVersion: "tools/v1", modelProviderVersion: "model-runtime/1.0.0" }, supported), true);
  assert.equal(runtimeCompatibilitySupported({ cvgProductVersion: "0.1.0", agentRuntimeContract: "AgentRuntimeContract/v9", pluginApiVersion: "cvg-agent-plugin/1", skillSchemaVersion: "cvg-agent-skill/1", toolSchemaVersion: "tools/v1", modelProviderVersion: "model-runtime/1.0.0" }, supported), false);
  assert.equal(runtimeCompatibilitySupported({ cvgProductVersion: "0.1.0", agentRuntimeContract: AGENT_RUNTIME_CONTRACT_VERSION, pluginApiVersion: "cvg-agent-plugin/2", skillSchemaVersion: "cvg-agent-skill/1", toolSchemaVersion: "tools/v1", modelProviderVersion: "model-runtime/1.0.0" }, supported), false);
});

test("usage settlement keeps an unknown price explicit", () => {
  const unknown = buildAiUsageSettlement({ model: "m", inputTokens: 10, outputTokens: 5, providerResponseDigest: null, estimatedCostMicros: null, actualCostMicros: null, currency: null, costSource: "UNAVAILABLE", pricingRevision: null, discrepancy: "NOT_EVALUATED", discrepancyDeltaMicros: null, discrepancyReason: "pricing absent" });
  assert.equal(unknown.actualCost.amountMicros, null);
  assert.equal(unknown.actualCost.source, "UNAVAILABLE");
  assert.equal(unknown.discrepancy.status, "NOT_EVALUATED");
  const known = buildAiUsageSettlement({ model: "m", inputTokens: 10, outputTokens: 5, providerResponseDigest: "a".repeat(64), estimatedCostMicros: 35, actualCostMicros: 35, currency: "USD", costSource: "PROVIDER", pricingRevision: "pricing-1", discrepancy: "MATCHED", discrepancyDeltaMicros: 0, discrepancyReason: null });
  assert.equal(known.actualCost.amountMicros, 35);
  assert.equal(known.actualCost.pricingRevision, "pricing-1");
});

test("the disabled runtime degrades AI without touching the domain", async () => {
  const runtime = new DisabledAgentRuntime();
  assert.equal(runtime.adapterId, "disabled");
  const health = await runtime.health();
  assert.equal(health.status, "DISABLED");
  assert.equal(health.capabilities.supports.approvals, false);
  await assert.rejects(runtime.executeTurn({} as never, {} as never), (error: unknown) => error instanceof Error && (error as { code?: string }).code === "AGENT_RUNTIME_UNAVAILABLE");
  await assert.rejects(runtime.replay({} as never, "session" as never), (error: unknown) => error instanceof Error && (error as { code?: string }).code === "AGENT_RUNTIME_UNAVAILABLE");
  await runtime.shutdown();
});
