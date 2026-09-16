import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CvgStore } from "@cvg/domain";
import type { CvgContext } from "@cvg/contracts";
import { EmbeddedAgentRuntime } from "@cvg/embedded-agent-runtime";
import { MemoryAgentSessionStore } from "@cvg/agent-session";
import { createDeepSeekModelProvider } from "@cvg/model-adapters";
import { ModelProviderError, type ModelRequest } from "@cvg/model-runtime";

/**
 * External proof: Embedded runtime -> DeepSeek Model Adapter -> real DeepSeek.
 *
 * FAIL-CLOSED CONTRACT: without an explicit endpoint, credential and authorized
 * data classes this script reports BLOCKED_EXTERNAL and performs no request.
 * A loopback or mock endpoint is never accepted as external evidence.
 */

const endpoint = process.env.CVG_EMBEDDED_DEEPSEEK_URL?.trim() ?? "";
const apiKey = process.env.CVG_EMBEDDED_DEEPSEEK_API_KEY?.trim() ?? "";
const model = process.env.CVG_EMBEDDED_DEEPSEEK_MODEL?.trim() ?? "deepseek-v4-flash";
const allowedDataClasses = (process.env.CVG_EMBEDDED_DEEPSEEK_ALLOWED_DATA_CLASSES ?? "").split(",").map((value) => value.trim()).filter(Boolean) as ("D0" | "D1" | "D2" | "D3" | "D4" | "D5")[];
const evidenceFile = process.env.CVG_EMBEDDED_DEEPSEEK_EVIDENCE_FILE?.trim() ?? "";
const allowInsecureHttp = process.env.CVG_EMBEDDED_DEEPSEEK_ALLOW_INSECURE === "true";
const timeoutMs = Number(process.env.CVG_EMBEDDED_DEEPSEEK_TIMEOUT_MS ?? 60_000);
const sha = process.env.CVG_BUILD_SHA ?? process.env.CVG_GIT_SHA ?? "local";
const artifactPath = process.env.CVG_EMBEDDED_DEEPSEEK_ARTIFACT?.trim() || "artifacts/operational-proof/embedded-deepseek-proof.json";

const missing = [
  ...(endpoint ? [] : ["CVG_EMBEDDED_DEEPSEEK_URL"]),
  ...(apiKey ? [] : ["CVG_EMBEDDED_DEEPSEEK_API_KEY"]),
  ...(allowedDataClasses.length > 0 ? [] : ["CVG_EMBEDDED_DEEPSEEK_ALLOWED_DATA_CLASSES"]),
  ...(evidenceFile ? [] : ["CVG_EMBEDDED_DEEPSEEK_EVIDENCE_FILE"])
];

function writeArtifact(payload: Record<string, unknown>): void {
  mkdirSync("artifacts/operational-proof", { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), subjectSha: sha, ...payload }, null, 2)}\n`);
}

if (missing.length > 0) {
  writeArtifact({ status: "BLOCKED_EXTERNAL", evidenceClass: "EXTERNAL_REAL", missing, stages: [] });
  process.stdout.write(`BLOCKED_EXTERNAL missing=${missing.join(",")} artifact=${artifactPath}\n`);
  process.exit(0);
}

if (!/^https:\/\//.test(endpoint) && !allowInsecureHttp) {
  process.stderr.write("embedded-deepseek: endpoint must use HTTPS unless CVG_EMBEDDED_DEEPSEEK_ALLOW_INSECURE=true is explicitly authorized\n");
  process.exit(1);
}
if (/^https?:\/\/(?:localhost|127\.|\[::1\])/.test(endpoint)) {
  process.stderr.write("embedded-deepseek: a loopback endpoint is not external evidence\n");
  process.exit(1);
}

const stages: { stage: string; status: "PASS" | "FAIL"; detail: string; latencyMs: number }[] = [];
async function stage(name: string, run: () => Promise<string>): Promise<boolean> {
  const started = performance.now();
  try {
    const detail = await run();
    stages.push({ stage: name, status: "PASS", detail, latencyMs: Math.round((performance.now() - started) * 100) / 100 });
    process.stdout.write(`PASS ${name} — ${detail}\n`);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stages.push({ stage: name, status: "FAIL", detail, latencyMs: Math.round((performance.now() - started) * 100) / 100 });
    process.stderr.write(`FAIL ${name} — ${detail}\n`);
    return false;
  }
}

function context(store: CvgStore): CvgContext {
  const veterinarianId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id ?? store.bootstrapCredentials.userId;
  const option = store.contextOptions(veterinarianId)[0];
  if (!option) throw new Error("proof requires a synthetic context option");
  const session = store.createSession(veterinarianId, "embedded-deepseek-token", "embedded-deepseek-csrf", 60);
  return store.resolveContext(veterinarianId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "proof", "embedded-deepseek", null, null, session.id);
}

const provider = createDeepSeekModelProvider({
  baseUrl: endpoint,
  model,
  apiKeyResolver: () => apiKey,
  allowedDataClasses,
  timeoutMs,
  allowInsecureHttp,
  capabilities: { toolCalling: true, structuredOutput: true, streaming: true }
});

let evidenceDigest: string | null = null;
try {
  evidenceDigest = createHash("sha256").update(readFileSync(evidenceFile)).digest("hex");
} catch (error) {
  process.stderr.write(`embedded-deepseek: cannot read CVG_EMBEDDED_DEEPSEEK_EVIDENCE_FILE: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const modelRequest = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  messages: [{ role: "user", content: "Responda com a palavra OK." }],
  tools: [],
  systemInstructions: "Você é um assistente governado; responda de forma mínima.",
  maxOutputTokens: 64,
  temperature: null,
  purpose: "SUMMARY",
  contextDigest: "c".repeat(64),
  responseFormat: "TEXT",
  correlationId: "embedded-deepseek-proof",
  ...overrides
});

const results: boolean[] = [];
results.push(await stage("provider.health", async () => {
  const health = await provider.health();
  if (health.status !== "READY") throw new Error(`health status ${health.status}: ${health.reason ?? "unknown"}`);
  return `READY latencyMs=${health.latencyMs ?? "n/a"}`;
}));
results.push(await stage("provider.capabilities", async () => {
  const capabilities = provider.capabilities();
  if (!capabilities.toolCalling) throw new Error("real DeepSeek must declare tool calling for the governed runtime");
  return `toolCalling=${capabilities.toolCalling} contextWindow=${capabilities.contextWindow} maxOutput=${capabilities.maxOutput}`;
}));
results.push(await stage("provider.complete", async () => {
  const response = await provider.complete(modelRequest());
  if (response.reply.kind !== "MESSAGE") throw new Error(`expected MESSAGE, observed ${response.reply.kind}`);
  return `model=${response.model} digest=${response.responseDigest.slice(0, 12)} tokens=${response.usage.inputTokens}/${response.usage.outputTokens} source=${response.usage.source}`;
}));
results.push(await stage("provider.structuredOutput", async () => {
  const response = await provider.complete(modelRequest({ messages: [{ role: "user", content: "Responda somente com {\"ok\": true} em JSON." }], responseFormat: "JSON_OBJECT" }));
  if (response.reply.kind !== "STRUCTURED") throw new Error(`expected STRUCTURED, observed ${response.reply.kind}`);
  return `structured keys=${Object.keys(response.reply.value as Record<string, unknown>).join(",")}`;
}));
results.push(await stage("provider.cancel", async () => {
  const controller = new AbortController();
  controller.abort();
  try {
    await provider.complete(modelRequest(), { signal: controller.signal });
  } catch (error) {
    if (error instanceof ModelProviderError && error.code === "MODEL_CANCELLED") return "MODEL_CANCELLED before egress completed";
    throw error;
  }
  throw new Error("aborted call unexpectedly resolved");
}));
results.push(await stage("provider.timeout", async () => {
  try {
    await provider.complete(modelRequest(), { timeoutMs: 1 });
  } catch (error) {
    if (error instanceof ModelProviderError && (error.code === "MODEL_TIMEOUT" || error.code === "MODEL_CANCELLED")) return error.code;
    throw error;
  }
  throw new Error("timed-out call unexpectedly resolved");
}));

// Governed runtime path: tool round-trip, approval, provenance, replay.
{
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const ctx = context(store);
  const patient = [...store.patients.values()].find((candidate) => candidate.organizationId === ctx.organizationId && candidate.unitId === ctx.unitId && candidate.workspaceId === ctx.workspaceId);
  const runtime = new EmbeddedAgentRuntime({
    store,
    modelProvider: provider,
    sessionStore: new MemoryAgentSessionStore(),
    instanceId: "embedded-deepseek-proof",
    runtimeCommit: sha
  });
  results.push(await stage("runtime.turn", async () => {
    const result = await runtime.executeTurn(ctx, { sessionId: null, prompt: "Responda com uma frase curta de confirmação.", purpose: "SUMMARY", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: "embedded-deepseek-turn-1" });
    if (result.turn.status !== "COMPLETED") throw new Error(`turn status ${result.turn.status}`);
    if (result.provenance.provider !== "deepseek") throw new Error(`provenance.provider ${result.provenance.provider}`);
    return `status=${result.turn.status} provider=${result.provenance.provider} model=${result.turn.model} tokens=${result.turn.inputTokens}/${result.turn.outputTokens} usage=${result.turn.usage?.status}`;
  }));
  results.push(await stage("runtime.toolGateway", async () => {
    if (!patient) throw new Error("synthetic patient fixture missing");
    const result = await runtime.executeTurn(ctx, { sessionId: null, prompt: "Leia o paciente autorizado.", purpose: "OPERATIONS", patientId: patient.id, encounterId: null, requestedTool: "cvg.patient.read", approvalId: null, idempotencyKey: "embedded-deepseek-tool-1" });
    if (result.turn.status !== "COMPLETED") throw new Error(`turn status ${result.turn.status}`);
    const receipts = [...store.commandReceipts.values()].filter((receipt) => receipt.operation === "tool.patients.read" && receipt.status === "SUCCEEDED");
    if (receipts.length !== 1) throw new Error(`expected one governed receipt, observed ${receipts.length}`);
    return `receipts=${receipts.length} status=${result.turn.status}`;
  }));
  results.push(await stage("runtime.approval", async () => {
    const paused = await runtime.executeTurn(ctx, { sessionId: null, prompt: "Prepare uma comunicação para revisão.", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: "cvg.communication.stage", approvalId: null, idempotencyKey: "embedded-deepseek-approval-1" });
    if (paused.turn.status !== "RECEIVED" || !paused.approval) throw new Error(`expected a staged approval, observed ${paused.turn.status}`);
    await runtime.approve(ctx, paused.approval.id, "allowed-once", "revisão externa autorizada");
    const resumed = await runtime.executeTurn(ctx, { sessionId: paused.session.id, prompt: "Prepare uma comunicação para revisão.", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: "cvg.communication.stage", approvalId: paused.approval.id, idempotencyKey: "embedded-deepseek-approval-2" });
    if (resumed.turn.status !== "COMPLETED") throw new Error(`resumed status ${resumed.turn.status}`);
    return `approval=consumed resumed=${resumed.turn.status}`;
  }));
  results.push(await stage("runtime.replay", async () => {
    const sessions = [...store.aiSessions.values()];
    const target = sessions.at(-1);
    if (!target) throw new Error("no persisted session to replay");
    const replay = await runtime.replay(ctx, target.id);
    if (replay.digest.length !== 64) throw new Error("replay digest malformed");
    return `turns=${replay.turns.length} digest=${replay.digest.slice(0, 12)} manifest=${runtime.runtimeManifestDigest().slice(0, 12)}`;
  }));
  await runtime.shutdown();
}

const passed = results.every(Boolean);
writeArtifact({
  status: passed ? "EMBEDDED_DEEPSEEK_VERIFIED" : "EMBEDDED_DEEPSEEK_FAILED",
  evidenceClass: "EXTERNAL_REAL",
  endpointHost: new URL(endpoint).host,
  model,
  allowedDataClasses,
  evidenceFile: evidenceFile || null,
  evidenceDigest,
  stages,
  limitations: [
    "Single authorized endpoint and model; no multi-region or load evidence.",
    "Evidence file is recorded by path only; independent signature review follows the same-SHA bundle process.",
    "Loopback and mock endpoints are rejected by design."
  ]
});
if (!passed) {
  process.stderr.write(`EMBEDDED_DEEPSEEK_FAILED stages=${stages.filter((stage) => stage.status === "FAIL").length} artifact=${artifactPath}\n`);
  process.exit(1);
}
process.stdout.write(`EMBEDDED_DEEPSEEK_VERIFIED stages=${stages.length} model=${model} artifact=${artifactPath}\n`);
