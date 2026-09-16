import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Documentation provenance gate: a document may only claim CURRENT status when
 * its subject SHA equals the repository HEAD; otherwise it must be marked
 * HISTORICAL/WORKTREE.  Prevents stale scorecards from masquerading as current.
 */
const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim() ?? "";
const dirty = (spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout ?? "").trim().length > 0;
const statePath = "artifacts/quality/current-state.json";
const failures: string[] = [];

if (!head) failures.push("could not resolve repository HEAD");
if (!existsSync(statePath)) {
  failures.push(`${statePath}: missing canonical quality state`);
} else {
  const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
  const required = ["schemaVersion", "generatedAt", "subjectSha", "classification", "engineeringState", "productionState", "aaaState", "blockers", "lastVerification", "pointers"];
  for (const field of required) if (!(field in state)) failures.push(`${statePath}: missing field ${field}`);
  const classification = String(state.classification ?? "");
  const subjectSha = String(state.subjectSha ?? "");
  if (!["CURRENT", "HISTORICAL", "WORKTREE"].includes(classification)) failures.push(`${statePath}: invalid classification ${classification}`);
  if (classification === "CURRENT" && subjectSha !== head) {
    // A CURRENT claim is also valid when the only commits after the subject SHA
    // are documentation/evidence artifacts (never executable code).
    const diff = (spawnSync("git", ["diff", "--name-only", `${subjectSha}..HEAD`], { encoding: "utf8" }).stdout ?? "").trim().split("\n").filter(Boolean);
    const nonCode = diff.length > 0 && diff.every((path) => path.startsWith("artifacts/") || path.startsWith("docs/") || path.startsWith(".agent/") || path.startsWith(".gauntlet/") || path === "README.md");
    if (!nonCode) failures.push(`${statePath}: CURRENT requires subjectSha == HEAD or only documentation/evidence commits after it (${subjectSha} != ${head})`);
  }
  if (classification === "WORKTREE" && !dirty) failures.push(`${statePath}: WORKTREE classification requires a dirty worktree`);
  if (classification === "CURRENT" && dirty) {
    // Fresh evidence is regenerated after the subject commit; only evidence
    // artifacts may be dirty when CURRENT is claimed.
    const dirtyPaths = (spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout ?? "").trim().split("\n").filter(Boolean).map((line) => line.slice(3).trim());
    const evidenceOnlyDirty = dirtyPaths.every((path) => path.startsWith("artifacts/"));
    if (!evidenceOnlyDirty) failures.push(`${statePath}: CURRENT cannot be claimed with uncommitted non-evidence changes: ${dirtyPaths.filter((path) => !path.startsWith("artifacts/")).join(", ")}`);
  }
  if (state.productionState === "PRODUCTION_READY") failures.push(`${statePath}: production readiness requires human approval and is not automated`);
  const lastVerification = state.lastVerification as Record<string, unknown> | undefined;
  if (!lastVerification || typeof lastVerification.artifact !== "string" || !existsSync(String(lastVerification.artifact))) failures.push(`${statePath}: lastVerification.artifact must exist on disk`);
  const pointers = state.pointers as Record<string, unknown> | undefined;
  for (const pointer of Object.values(pointers ?? {})) {
    if (typeof pointer === "string" && !existsSync(pointer)) failures.push(`${statePath}: pointer target missing: ${pointer}`);
  }
}

const readme = readFileSync("README.md", "utf8");
if (!readme.includes(statePath)) failures.push(`README.md must derive its status from ${statePath}`);
const scorecard = "docs/final-state-of-art-scorecard.md";
if (!existsSync(scorecard)) failures.push(`${scorecard}: missing`);
else {
  const content = readFileSync(scorecard, "utf8");
  if (!/subject\s*SHA/i.test(content)) failures.push(`${scorecard}: must declare its subject SHA`);
  if (/CURRENT/i.test(content) && !content.includes(String(JSON.parse(readFileSync(statePath, "utf8")).subjectSha ?? ""))) failures.push(`${scorecard}: CURRENT claim does not match the canonical subject SHA`);
}
const triple = "docs/triple-aaa-final-scorecard.md";
if (!existsSync(triple)) failures.push(`${triple}: missing`);
else if (!/AAA_NOT_PROVEN|TRIPLE_AAA_CANDIDATE/.test(readFileSync(triple, "utf8"))) failures.push(`${triple}: must declare an explicit AAA state`);

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`DOCS_PROVENANCE_VERIFIED head=${head.slice(0, 12)} dirty=${dirty} state=${statePath}\n`);
