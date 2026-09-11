import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { AiTurnInput, CvgContext } from "@cvg/contracts";
import type { AgentRuntime } from "@cvg/agent-runtime";
import { DeepSeekHarnessAdapter } from "@cvg/harness-adapters";
import { isDeepSeekProofEvidenceRef, parseBridgeContext, parseBridgeSessionInput, parseBridgeTurnInput, validateDeepSeekRealProofEvidence, type DeepSeekRealProofEvidence } from "@cvg/deepseek-bridge";
import { lstat, readFile, realpath } from "node:fs/promises";
import { requireExternalEvidenceRoot } from "./evidence-boundary.ts";

const requiredEnvironment = ["CVG_DEEPSEEK_REAL_URL", "CVG_DEEPSEEK_REAL_BEARER_TOKEN", "CVG_DEEPSEEK_REAL_CONTEXT_SIGNING_SECRET", "CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT", "CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION", "CVG_DEEPSEEK_EXPECTED_TOOL_NAMES", "CVG_DEEPSEEK_REAL_CONTEXT_JSON", "CVG_DEEPSEEK_REAL_SESSION_INPUT_JSON", "CVG_DEEPSEEK_REAL_TURN_INPUT_JSON", "CVG_DEEPSEEK_REAL_EVIDENCE_FILE", "CVG_DEEPSEEK_REAL_PROOF_PUBLIC_KEY"] as const;
const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function currentSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function cleanWorktree(): boolean {
  return execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" }).trim().length === 0;
}

async function loadRealProof(expectedSourceSha: string, expectedEngineCommit: string, expectedManifestVersion: string): Promise<DeepSeekRealProofEvidence> {
  const filename = process.env.CVG_DEEPSEEK_REAL_EVIDENCE_FILE?.trim();
  if (!filename) throw new Error("CVG_DEEPSEEK_REAL_EVIDENCE_FILE is required");
  if (!cleanWorktree()) throw new Error("DeepSeek real proof requires a clean checkout");
  const bundlePath = resolve(filename);
  const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const bundleStats = await lstat(bundlePath);
  if (bundleStats.isSymbolicLink() || !bundleStats.isFile()) throw new Error("DeepSeek real evidence bundle must be a regular file");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(bundlePath, "utf8")) as unknown;
  } catch {
    throw new Error("DeepSeek real evidence bundle is unreadable");
  }
  const validation = validateDeepSeekRealProofEvidence(raw, expectedSourceSha, Date.now(), process.env.CVG_DEEPSEEK_REAL_PROOF_PUBLIC_KEY);
  if (!validation.ok) throw new Error(validation.reason);
  if (validation.evidence.engineCommit !== expectedEngineCommit || validation.evidence.manifestDigest !== expectedManifestVersion) throw new Error("DeepSeek proof identity does not match the configured engine and manifest");
  const evidenceRoot = await requireExternalEvidenceRoot(dirname(bundlePath), sourceRoot);
  for (const stage of Object.values(validation.evidence.stages)) {
    if (!isDeepSeekProofEvidenceRef(stage.evidenceRef)) throw new Error("DeepSeek proof evidence reference is invalid");
    const path = resolve(evidenceRoot, stage.evidenceRef);
    const stats = await lstat(path);
    const canonicalPath = await realpath(path);
    const relativePath = relative(evidenceRoot, canonicalPath);
    if (stats.isSymbolicLink() || !stats.isFile() || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("DeepSeek proof evidence must be a regular file below its immutable bundle directory");
    const observed = createHash("sha256").update(await readFile(canonicalPath)).digest("hex");
    if (observed !== stage.evidenceDigest) throw new Error("DeepSeek proof evidence digest mismatch");
  }
  return validation.evidence;
}

/** A transport smoke proves neither real model execution nor the full required failure matrix. */
export async function runDeepSeekProtocolSmoke(runtime: AgentRuntime, context: CvgContext, sessionInput: Pick<AiTurnInput, "purpose" | "patientId" | "encounterId">, turnInput: AiTurnInput) {
  const health = await runtime.health();
  if (health.status !== "READY") throw new Error("DeepSeek health/capability admission failed");
  const session = await runtime.createSession(context, sessionInput);
  // context.sessionId is the authenticated CVG session, never the AI session.
  const result = await runtime.executeTurn(context, { ...turnInput, sessionId: session.id });
  if (result.turn.status !== "COMPLETED" || !result.turn.response?.trim() || result.turn.inputTokens <= 0 || result.turn.outputTokens <= 0 || !result.turn.usage || result.turn.usage.status !== "SETTLED" || result.turn.usage.consumedUnits !== result.turn.inputTokens + result.turn.outputTokens) throw new Error("DeepSeek smoke requires completed output and a settled nonzero usage record");
  const replay = await runtime.replay(context, session.id);
  const replayedTurn = replay.turns.find((turn) => turn.id === result.turn.id);
  if (!replayedTurn || digest(replayedTurn) !== digest(result.turn)) throw new Error("DeepSeek replay does not contain the exact completed turn");
  return { scope: "BRIDGE_PROTOCOL_SMOKE", status: "VERIFIED_PROTOCOL_ONLY", engineCommit: health.capabilities.engineCommit, manifestVersion: health.capabilities.manifestVersion, sessionDigest: digest(session), turnDigest: digest(result), replayDigest: digest(replay), inputTokens: result.turn.inputTokens, outputTokens: result.turn.outputTokens, executedAt: new Date().toISOString() };
}

async function main(): Promise<void> {
  const missing = requiredEnvironment.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    process.stderr.write(`DEEPSEEK_REAL_BLOCKED_EXTERNAL missing=${missing.join(",")}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const base = new URL(process.env.CVG_DEEPSEEK_REAL_URL!);
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("DeepSeek real URL must be an HTTPS origin without credentials");
    const expectedCommit = process.env.CVG_DEEPSEEK_EXPECTED_ENGINE_COMMIT!.trim();
    const expectedManifest = process.env.CVG_DEEPSEEK_EXPECTED_MANIFEST_VERSION!.trim();
    if (!/^[a-f0-9]{40}$/.test(expectedCommit) || !/^sha256:[a-f0-9]{64}$/.test(expectedManifest)) throw new Error("DeepSeek identity requires an exact git SHA and SHA-256 manifest attestation");
    const context = parseBridgeContext(JSON.parse(process.env.CVG_DEEPSEEK_REAL_CONTEXT_JSON!));
    const sessionInput = parseBridgeSessionInput(JSON.parse(process.env.CVG_DEEPSEEK_REAL_SESSION_INPUT_JSON!));
    const turnInput = parseBridgeTurnInput(JSON.parse(process.env.CVG_DEEPSEEK_REAL_TURN_INPUT_JSON!));
    const runtime = new DeepSeekHarnessAdapter({ baseUrl: base.origin, expectedEngineCommit: expectedCommit, expectedManifestVersion: expectedManifest, expectedToolNames: process.env.CVG_DEEPSEEK_EXPECTED_TOOL_NAMES!.split(",").map((name) => name.trim()).filter(Boolean), requestTimeoutMs: 120_000, resolveBearerToken: async () => process.env.CVG_DEEPSEEK_REAL_BEARER_TOKEN!.trim(), resolveContextSigningSecret: async () => process.env.CVG_DEEPSEEK_REAL_CONTEXT_SIGNING_SECRET!.trim() });
    const sourceSha = currentSha();
    const proof = await loadRealProof(sourceSha, expectedCommit, expectedManifest);
    const smoke = await runDeepSeekProtocolSmoke(runtime, context, sessionInput, turnInput);
    process.stdout.write(`${JSON.stringify({ smoke, proof: { sourceSha: proof.sourceSha, engineCommit: proof.engineCommit, manifestDigest: proof.manifestDigest, stages: Object.keys(proof.stages).length, chainDigest: proof.chainDigest, producer: proof.producer, reviewer: proof.reviewer }})}\nDEEPSEEK_REAL_VERIFIED\n`);
  } catch {
    // Configuration/model responses may contain secrets: never echo exception text.
    process.stderr.write("DEEPSEEK_REAL_FAILED protocol_identity_schema_usage_or_replay_contract\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
