import { createHash } from "node:crypto";
import { HttpMessagingProvider, validateProviderRealProofEvidence } from "@cvg/integrations";
import { lstat, readFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireExternalEvidenceRoot } from "./evidence-boundary.ts";

function required(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function currentSha(): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const value = (result.stdout ?? "").trim();
  return result.status === 0 && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function cleanWorktree(): boolean {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 && (result.stdout ?? "").trim() === "";
}

async function requireVerticalProof(): Promise<{ transactionId: string }> {
  const file = required("CVG_PROVIDER_REAL_EVIDENCE_FILE");
  if (!file) throw new Error("CVG_PROVIDER_REAL_EVIDENCE_FILE must point to a same-SHA appointment→PDP→approval→outbox→worker→provider→receipt→callback→inbox→effect-ledger→reconciliation→audit proof bundle");
  const proofPublicKey = required("CVG_PROVIDER_REAL_PROOF_PUBLIC_KEY");
  if (!proofPublicKey) throw new Error("CVG_PROVIDER_REAL_PROOF_PUBLIC_KEY must contain the external Ed25519 proof-signing authority");
  const sha = currentSha();
  if (!sha || !cleanWorktree()) throw new Error("provider real proof requires the current checkout to be clean and SHA-addressable");
  const bundlePath = resolve(file);
  const sourceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const bundleStats = await lstat(bundlePath);
  if (bundleStats.isSymbolicLink() || !bundleStats.isFile()) throw new Error("provider real evidence bundle must be a regular file");
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(bundlePath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`provider proof bundle is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const validation = validateProviderRealProofEvidence(raw, sha, Date.now(), proofPublicKey);
  if (!validation.ok) throw new Error(validation.reason);
  const evidenceRoot = await requireExternalEvidenceRoot(dirname(bundlePath), sourceRoot);
  for (const stage of Object.values(validation.evidence.stages)) {
    const path = resolve(evidenceRoot, stage.evidenceRef);
    const stats = await lstat(path);
    const canonicalPath = await realpath(path);
    const relativePath = relative(evidenceRoot, canonicalPath);
    if (stats.isSymbolicLink() || !stats.isFile() || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("provider proof evidence must be a regular file below its immutable bundle directory");
    const observed = createHash("sha256").update(await readFile(canonicalPath)).digest("hex");
    if (observed !== stage.evidenceDigest) throw new Error("provider proof evidence digest mismatch");
  }
  return { transactionId: validation.evidence.transactionId };
}
async function main(): Promise<void> {
  const proof = await requireVerticalProof();
  const endpoint = required("CVG_PROVIDER_REAL_URL");
  const token = required("CVG_PROVIDER_REAL_BEARER_TOKEN");
  const allowedHost = required("CVG_PROVIDER_REAL_ALLOWED_HOST");
  const recipient = required("CVG_PROVIDER_REAL_RECIPIENT");
  if (!endpoint || !token || !allowedHost || !recipient) throw new Error("CVG_PROVIDER_REAL_URL, bearer token, allowed host and recipient are required");
  const provider = new HttpMessagingProvider({ endpoint, allowedHosts: [allowedHost], credentialRef: "external.runtime", resolveSecret: async () => token, sendPath: process.env.CVG_PROVIDER_REAL_SEND_PATH ?? "/messages", ...(process.env.CVG_PROVIDER_REAL_QUERY_PATH ? { queryPath: process.env.CVG_PROVIDER_REAL_QUERY_PATH } : {}), defaultTimeoutMs: 10_000 });
  const idempotencyKey = `cvg-real-${proof.transactionId}`;
  const send = await provider.send({ idempotencyKey, requestId: idempotencyKey, channel: (process.env.CVG_PROVIDER_REAL_CHANNEL as "SMS" | "EMAIL" | "WHATSAPP" | undefined) ?? "EMAIL", recipient, body: "CVG-Corp controlled provider verification", metadata: { verification: "external-provider-real" } });
  if (send.status === "OUTCOME_UNKNOWN") {
    const query = await provider.queryStatus({ idempotencyKey, providerRequestId: send.providerRequestId });
    if (query.status !== "SUCCEEDED") throw new Error("provider accepted or lost the request without a conclusive query result");
    process.stdout.write(`${JSON.stringify({ send, query, external: true, verticalProof: proof.transactionId })}\nPROVIDER_REAL_VERIFIED\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ send, external: true, verticalProof: proof.transactionId })}\nPROVIDER_REAL_VERIFIED\n`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const missing = !required("CVG_PROVIDER_REAL_URL") || !required("CVG_PROVIDER_REAL_BEARER_TOKEN") || !required("CVG_PROVIDER_REAL_ALLOWED_HOST") || !required("CVG_PROVIDER_REAL_RECIPIENT") || !required("CVG_PROVIDER_REAL_EVIDENCE_FILE") || !required("CVG_PROVIDER_REAL_PROOF_PUBLIC_KEY");
  process.stderr.write(`${missing ? "PROVIDER_REAL_BLOCKED_EXTERNAL" : "PROVIDER_REAL_FAILED"} ${message}\n`);
  process.exitCode = missing ? 2 : 1;
}
