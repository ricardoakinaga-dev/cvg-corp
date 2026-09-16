import { CvgStore } from "@cvg/domain";
import { createRuntime } from "@cvg/api";

/**
 * Proves the core system survives with AI completely disabled:
 * general readiness stays green, AI readiness reports DISABLED, and
 * unauthenticated business/AI access is still rejected.
 */
const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
const runtime = await createRuntime({
  store,
  config: { nodeEnv: "test", storageMode: "memory", demoMode: false, agentRuntimeMode: "disabled" }
});
const failures: string[] = [];
try {
  const health = await runtime.app.inject({ method: "GET", url: "/api/v1/health" });
  if (health.statusCode !== 200) failures.push(`health expected 200 but observed ${health.statusCode}`);
  const ready = await runtime.app.inject({ method: "GET", url: "/api/v1/ready" });
  if (ready.statusCode !== 200) failures.push(`general readiness must not depend on AI; observed ${ready.statusCode} ${ready.body}`);
  const readyBody = ready.json<{ data: { ready: boolean; ai?: { status: string; degraded: boolean } } }>();
  if (readyBody.data.ai?.status !== "DISABLED") failures.push(`readiness must report AI DISABLED; observed ${JSON.stringify(readyBody.data.ai)}`);

  const aiReady = await runtime.app.inject({ method: "GET", url: "/api/v1/ai/ready" });
  if (aiReady.statusCode !== 503) failures.push(`ai readiness expected 503 but observed ${aiReady.statusCode}`);
  const aiReadyBody = aiReady.json<{ data: { ready: boolean; aiState: string } }>();
  if (aiReadyBody.data.aiState !== "DISABLED") failures.push(`aiState expected DISABLED but observed ${aiReadyBody.data.aiState}`);

  const aiTurn = await runtime.app.inject({ method: "POST", url: "/api/v1/ai/turns", payload: { sessionId: null, prompt: "teste", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "ai-disabled-1" } });
  if (aiTurn.statusCode !== 401) failures.push(`unauthenticated AI turn expected 401 but observed ${aiTurn.statusCode}`);
  const patients = await runtime.app.inject({ method: "GET", url: "/api/v1/patients" });
  if (patients.statusCode !== 401) failures.push(`unauthenticated patient read expected 401 but observed ${patients.statusCode}`);
  const aiHealth = await runtime.app.inject({ method: "GET", url: "/api/v1/ai/health" });
  if (aiHealth.statusCode >= 500) failures.push(`ai health must degrade explicitly, not crash; observed ${aiHealth.statusCode}`);
} finally {
  await runtime.app.close();
}
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("AI_DISABLED_VERIFIED core=health,ready,auth patients=401 aiReadiness=503/DISABLED degradation=AI_DEGRADED\n");
