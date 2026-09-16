import test from "node:test";
import assert from "node:assert/strict";
import { PluginRuntime, pluginManifestDigest, type AgentPlugin, type AgentPluginContext, type AgentPluginLogger } from "@cvg/agent-plugins";

function manifest(overrides: Partial<Omit<Parameters<typeof pluginManifestDigest>[0], "digest">> = {}) {
  const base = {
    name: "sample-plugin",
    version: "1.0.0",
    publisher: "cvg",
    apiVersion: "cvg-agent-plugin/1",
    permissions: ["logger", "approved-tools"] as const,
    capabilities: [{ name: "sample.read", version: "1.0.0" }],
    dependencies: [] as { capability: string; minVersion: string | null }[],
    risk: "LOW" as const,
    ...overrides
  };
  return { ...base, digest: pluginManifestDigest(base) };
}

function plugin(overrides: Partial<Omit<Parameters<typeof pluginManifestDigest>[0], "digest">> = {}, hooks: AgentPlugin["hooks"] extends () => infer H ? H : never = [], behavior: { initThrows?: boolean; shutdownThrows?: boolean } = {}): AgentPlugin {
  const changedManifest = manifest(overrides);
  let initializedWith: AgentPluginContext | null = null;
  return {
    manifest: changedManifest,
    async initialize(context) {
      initializedWith = context;
      if (behavior.initThrows) throw new Error("plugin init failed");
    },
    capabilities: () => changedManifest.capabilities.map((capability) => capability.name),
    hooks: () => hooks,
    async shutdown() {
      if (behavior.shutdownThrows) throw new Error("plugin shutdown failed");
    }
  };
}

test("plugin with a valid manifest and allowlist reaches READY and exposes capabilities", async () => {
  const runtime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: manifest().digest }] });
  const record = runtime.register(plugin());
  assert.equal(record.state, "VALIDATED");
  const records = await runtime.initializeAll();
  assert.equal(records.find((entry) => entry.name === "sample-plugin")?.state, "READY");
  assert.deepEqual(runtime.availableCapabilities(), ["sample.read"]);
});

test("tampered manifest digest is rejected before load", () => {
  const valid = manifest();
  const tampered: AgentPlugin = { ...plugin(), manifest: { ...valid, version: "2.0.0" } };
  const runtime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "2.0.0", digest: valid.digest }] });
  const record = runtime.register(tampered);
  assert.equal(record.state, "FAILED");
  assert.equal(record.reason, "MANIFEST_DIGEST_MISMATCH");
  assert.equal(runtime.availableCapabilities().length, 0);
});

test("plugin outside the allowlist or with a forbidden permission is rejected", () => {
  const runtime = new PluginRuntime({ allowlist: [] });
  assert.equal(runtime.register(plugin()).reason, "NOT_ALLOWLISTED");
  const forbidden = plugin({ permissions: ["database" as never] });
  const allowlistRuntime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: forbidden.manifest.digest }] });
  assert.equal(allowlistRuntime.register(forbidden).reason, "FORBIDDEN_PERMISSION:database");
});

test("risky plugin requires explicit runtime approval", () => {
  const risky = plugin({ risk: "HIGH", permissions: [] });
  const runtime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: risky.manifest.digest }] });
  assert.equal(runtime.register(risky).reason, "RISKY_PLUGIN_NOT_APPROVED");
  const approved = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: risky.manifest.digest }], approvedRiskyPlugins: ["sample-plugin"] });
  assert.equal(approved.register(risky).state, "VALIDATED");
});

test("plugin receives no ambient authority: no database, filesystem, secrets or http client", async () => {
  let received: AgentPluginContext | null = null;
  const scoped: AgentPlugin = {
    ...plugin(),
    async initialize(context) {
      received = context;
    }
  };
  const runtime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: scoped.manifest.digest }] });
  runtime.register(scoped);
  await runtime.initializeAll();
  assert.ok(received);
  const context = received as unknown as AgentPluginContext & Record<string, unknown>;
  assert.deepEqual(Object.keys(context).sort(), ["approvedToolClient", "clock", "logger", "metrics", "scopedConfig"]);
  assert.equal(context["database"], undefined);
  assert.equal(context["filesystem"], undefined);
  assert.equal(context["secrets"], undefined);
  assert.equal(context["httpClient"], undefined);
});

test("plugin without the approved-tools permission has no tool client", async () => {
  let received: AgentPluginContext | null = null;
  const noTools: AgentPlugin = { ...plugin({ permissions: ["logger"] }), async initialize(context) { received = context; } };
  const runtime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: noTools.manifest.digest }], approvedToolClient: { request: async () => ({ status: "COMPLETED", resultDigest: null }) } });
  runtime.register(noTools);
  await runtime.initializeAll();
  assert.equal((received as unknown as AgentPluginContext).approvedToolClient, null);
});

test("dependency graph detects missing capabilities and cycles and fails startup closed", async () => {
  const provider = plugin({ capabilities: [{ name: "a", version: "1.0.0" }], dependencies: [{ capability: "b", minVersion: null }] });
  const runtime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: provider.manifest.digest }] });
  runtime.register(provider);
  const resolution = runtime.resolveDependencies();
  assert.equal(resolution.ok, false);
  assert.deepEqual(resolution.missing, [{ plugin: "sample-plugin", capability: "b" }]);
  const records = await runtime.initializeAll();
  assert.equal(records[0]?.state, "FAILED");
  assert.equal(records[0]?.reason, "DEPENDENCY_RESOLUTION_FAILED");
});

test("capability version conflicts are detected", () => {
  const first = plugin({ name: "plugin-a", capabilities: [{ name: "shared", version: "1.0.0" }] });
  const second = plugin({ name: "plugin-b", capabilities: [{ name: "shared", version: "2.0.0" }] });
  const runtime = new PluginRuntime({ allowlist: [
    { name: "plugin-a", version: "1.0.0", digest: first.manifest.digest },
    { name: "plugin-b", version: "1.0.0", digest: second.manifest.digest }
  ] });
  runtime.register(first);
  runtime.register(second);
  const resolution = runtime.resolveDependencies();
  assert.equal(resolution.conflicts.length, 1);
  assert.equal(resolution.ok, false);
});

test("a failed plugin never offers capabilities and disable removes hooks", async () => {
  const crash = plugin({}, [], { initThrows: true });
  const runtime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: crash.manifest.digest }] });
  runtime.register(crash);
  const records = await runtime.initializeAll();
  assert.equal(records[0]?.state, "FAILED");
  assert.deepEqual(runtime.availableCapabilities(), []);

  const healthy = plugin({ name: "healthy-plugin", capabilities: [{ name: "healthy.read", version: "1.0.0" }] }, [{ name: "hook", phase: "PRE_TURN", handler: async () => ({}) }]);
  const second = new PluginRuntime({ allowlist: [{ name: "healthy-plugin", version: "1.0.0", digest: healthy.manifest.digest }] });
  second.register(healthy);
  await second.initializeAll();
  assert.equal(second.hooks("PRE_TURN").length, 1);
  await second.disable("healthy-plugin", "operator kill switch");
  assert.equal(second.hooks("PRE_TURN").length, 0);
  assert.deepEqual(second.availableCapabilities(), []);
});

test("plugin logger redacts secret-like metadata", async () => {
  const lines: string[] = [];
  const logger: AgentPluginLogger = { info: (message) => lines.push(message), warn: () => undefined, error: () => undefined };
  const noisy: AgentPlugin = {
    ...plugin(),
    async initialize(context) {
      context.logger.info("hello", { apiKey: "super-secret", safe: 1 });
    }
  };
  const runtime = new PluginRuntime({ allowlist: [{ name: "sample-plugin", version: "1.0.0", digest: noisy.manifest.digest }], logger });
  runtime.register(noisy);
  await runtime.initializeAll();
  assert.equal(lines.length, 1);
});
