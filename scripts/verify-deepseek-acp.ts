import { id, type CvgContext } from "@cvg/contracts";
import { createAcpNativeHarnessPortFromEnvironment, readAcpManifestVersion } from "@cvg/deepseek-bridge";
import { createDeepSeekBridgeServer } from "../apps/deepseek-bridge/src/server.ts";

const configuredPort = createAcpNativeHarnessPortFromEnvironment(process.env);
if (!configuredPort) {
  console.error("DeepSeek ACP verification skipped: complete CVG_DEEPSEEK_ACP_* and attestation environment is required.");
  process.exitCode = 2;
} else {
  // The preliminary factory call only proves that configuration is complete;
  // the server call below exercises the production wiring that creates the
  // port from process.env.
  void configuredPort;
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
    const health = await created.bridge.health(controller.signal);
    if (health.status !== "READY") {
      console.error(JSON.stringify({ verification: "FAIL", health }, null, 2));
      process.exitCode = 1;
    } else {
      const session = await created.bridge.createSession(context, { purpose: "SUMMARY", patientId: null, encounterId: null }, controller.signal);
      const manifestPath = process.env.CVG_DEEPSEEK_ACP_MANIFEST_PATH;
      const manifestVersion = manifestPath ? await readAcpManifestVersion(manifestPath) : null;
      console.log(JSON.stringify({ verification: "PASS", boundary: "ACP stdio", health, session, manifestVersion, modelTurn: "NOT_RUN_NO_API_KEY" }, null, 2));
    }
  } finally {
    await created.bridge.shutdown(controller.signal);
  }
}
