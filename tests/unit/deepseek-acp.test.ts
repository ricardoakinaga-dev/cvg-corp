import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcpNativeHarnessPortFromEnvironment, DeepSeekAcpNativeHarnessPort, DeepSeekBridgeError, readAcpManifestVersion } from "@cvg/deepseek-bridge";

test("ACP factory stays disabled until the complete explicit deployment contract exists", () => {
  assert.equal(createAcpNativeHarnessPortFromEnvironment({}), undefined);
  assert.equal(createAcpNativeHarnessPortFromEnvironment({
    CVG_DEEPSEEK_ACP_COMMAND: "node",
    CVG_DEEPSEEK_ACP_ENGINE_ROOT: "/srv/deepseek-harness",
    CVG_DEEPSEEK_ACP_WORKSPACE_ROOT: "/srv/cvg-workspace",
    CVG_DEEPSEEK_ACP_MANIFEST_PATH: "/srv/dsh-home/profiles/acp/package.json",
    CVG_DEEPSEEK_ACP_ARGS_JSON: "not-json",
    CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT: "approved",
    CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION: "sha256:approved"
  }), undefined);
});

test("ACP manifest attestation hashes the exact profile and requires the ACP bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "cvg-acp-manifest-test-"));
  const manifestPath = join(root, "package.json");
  await writeFile(manifestPath, JSON.stringify({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-acp-app"] } } }));
  try {
    const version = await readAcpManifestVersion(manifestPath);
    assert.match(version, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACP native port blocks an ungoverned model turn", async () => {
  const port = new DeepSeekAcpNativeHarnessPort({ command: "node", args: [], engineRoot: "/tmp/deepseek-engine", workspaceRoot: "/tmp/cvg-workspace", manifestPath: "/tmp/deepseek-manifest.json", expectedAgentName: "deepseek-harness-acp", modelName: "deepseek-acp" });
  await assert.rejects(() => port.executeTurn({} as Parameters<DeepSeekAcpNativeHarnessPort["executeTurn"]>[0]), (error: unknown) => error instanceof DeepSeekBridgeError && error.code === "CAPABILITY_DISABLED");
});

test("real DeepSeek Harness ACP boundary initializes only when explicitly enabled", { skip: process.env.CVG_DEEPSEEK_ACP_E2E !== "1" }, async () => {
  const port = createAcpNativeHarnessPortFromEnvironment(process.env);
  assert.ok(port);
  const controller = new AbortController();
  const health = await port.health({ correlationId: "test-deepseek-acp", signal: controller.signal });
  assert.equal(typeof health, "object");
  await port.shutdown({ correlationId: "test-deepseek-acp", signal: controller.signal });
});
