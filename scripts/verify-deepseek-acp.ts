import { id, type CvgContext } from "@cvg/contracts";
import { createAcpNativeHarnessPortFromEnvironment, readAcpManifestVersion } from "@cvg/deepseek-bridge";
import { createDeepSeekBridgeServer } from "../apps/deepseek-bridge/src/server.ts";

const configuredPort = createAcpNativeHarnessPortFromEnvironment(process.env);
if (!configuredPort) {
  console.error("DeepSeek ACP verification skipped: complete CVG_DEEPSEEK_ACP_* and attestation environment is required.");
  process.exitCode = 2;
} else {
  // Exercise the real stdio transport separately from the public CVG bridge.
  // The local ACP adapter currently lacks governed CVG tools/approvals/replay,
  // so the public bridge must remain unavailable even when ACP itself starts.
  const created = createDeepSeekBridgeServer();
  const controller = new AbortController();
  const context: CvgContext = {
    organizationId: id("00000000-0000-4000-8000-000000000001"),
    unitId: id("00000000-0000-4000-8000-000000000002"),
    workspaceId: id("00000000-0000-4000-8000-000000000003"),
    actorId: id("00000000-0000-4000-8000-000000000004"),
    sessionId: id("00000000-0000-4000-8000-000000000005"),
    actorRoleSnapshot: ["admin"],
    patientId: null,
    encounterId: null,
    purpose: "SUMMARY",
    policyRevision: "verify-deepseek-acp",
    correlationId: "verify-deepseek-acp"
  };
  try {
    const transportHealth = await configuredPort.health({ correlationId: "verify-deepseek-acp-transport", signal: controller.signal });
    if (typeof transportHealth !== "object" || transportHealth === null || !("status" in transportHealth) || transportHealth.status !== "READY") {
      console.error(JSON.stringify({ verification: "FAIL", boundary: "ACP stdio", transportHealth }, null, 2));
      process.exitCode = 1;
    } else {
      const session = await configuredPort.createSession({ correlationId: "verify-deepseek-acp-session", signal: controller.signal, context, input: { purpose: "SUMMARY", patientId: null, encounterId: null } });
      const bridgeHealth = await created.bridge.health(controller.signal);
      if (bridgeHealth.status !== "UNAVAILABLE") {
        console.error(JSON.stringify({ verification: "FAIL", transportHealth, bridgeHealth }, null, 2));
        process.exitCode = 1;
      }
      const manifestPath = process.env.CVG_DEEPSEEK_ACP_MANIFEST_PATH;
      const manifestVersion = manifestPath ? await readAcpManifestVersion(manifestPath) : null;
      console.log(JSON.stringify({ verification: process.exitCode === 1 ? "FAIL" : "PASS", boundary: "ACP stdio transport", transportHealth, bridgeHealth, session, manifestVersion, modelTurn: "NOT_RUN_NO_API_KEY", runtime: "BLOCKED_CAPABILITIES" }, null, 2));
    }
  } finally {
    await created.bridge.shutdown(controller.signal);
    await configuredPort.shutdown({ correlationId: "verify-deepseek-acp-shutdown", signal: controller.signal });
  }
}
