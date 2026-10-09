import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Finding = { id: string; canonical_tasks: string[] };
type Task = { id: string; title: string; findings: string[]; semantic_subject: string; aggregate?: boolean };
type Manifest = {
  schema_version: number;
  manifest_id: string;
  status: string;
  canonical_digest?: string;
  source_documents: Record<string, { path: string; sha256: string }>;
  finding_catalog: Finding[];
  aud26_task_catalog: Task[];
  aud27_finding_catalog: Array<{ id: string }>;
};
type BacklogItem = {
  id: string;
  title?: string;
  findings?: string[];
  semantic_subject?: string;
  status?: string;
  observed?: unknown;
  remaining?: unknown;
  evidence_state?: string;
  blocker_type?: string | null;
  blocker_owner?: string | null;
};
type Backlog = { items: BacklogItem[] };

export type SemanticFinding = { code: string; detail: string };

const ROOT = resolve(process.cwd());
const MANIFEST_PATH = resolve(ROOT, "docs/aud27-semantic-manifest.json");
const BACKLOG_PATH = resolve(ROOT, ".agent/backlog.json");
const EXPECTED_FINDINGS = Array.from({ length: 39 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`);
const EXPECTED_TASKS = Array.from({ length: 36 }, (_, index) => `CVG-AUD26-${String(index + 1).padStart(3, "0")}`);
const CANONICAL_MANIFEST_DIGEST = "b77b00f2b3daf09993a7f1b885cf07d5eb0036f75320412dcbdea530fa4ed05d";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function pathForSource(sourcePath: string): string {
  return sourcePath.startsWith("/") ? sourcePath : resolve(ROOT, sourcePath);
}

function validateManifestShape(manifest: Manifest): SemanticFinding[] {
  const findings: SemanticFinding[] = [];
  if (manifest.schema_version !== 1) findings.push({ code: "MANIFEST_SCHEMA", detail: "AUD27 semantic manifest schema must be 1" });
  if (manifest.manifest_id !== "CVG-AUD27-SEMANTICS-V1") findings.push({ code: "MANIFEST_ID", detail: "unexpected semantic manifest id" });
  if (manifest.status !== "CURRENT_RECONCILED") findings.push({ code: "MANIFEST_STATUS", detail: "semantic manifest is not marked CURRENT_RECONCILED" });
  const withoutDigest = { ...manifest } as Record<string, unknown>;
  delete withoutDigest.canonical_digest;
  const actualDigest = sha256(Buffer.from(JSON.stringify(withoutDigest)));
  if (manifest.canonical_digest !== CANONICAL_MANIFEST_DIGEST || actualDigest !== CANONICAL_MANIFEST_DIGEST) {
    findings.push({ code: "MANIFEST_CANONICAL_DIGEST", detail: `semantic manifest canonical digest mismatch: expected ${CANONICAL_MANIFEST_DIGEST}, declared ${manifest.canonical_digest ?? "(missing)"}, actual ${actualDigest}` });
  }
  const findingIds = manifest.finding_catalog.map((finding) => finding.id);
  if (findingIds.length !== EXPECTED_FINDINGS.length || sortedUnique(findingIds).join("|") !== EXPECTED_FINDINGS.join("|")) {
    findings.push({ code: "FINDING_COVERAGE", detail: `expected unique F01-F39, got ${sortedUnique(findingIds).join(",")}` });
  }
  const taskIds = manifest.aud26_task_catalog.map((task) => task.id);
  if (taskIds.length !== EXPECTED_TASKS.length || sortedUnique(taskIds).join("|") !== EXPECTED_TASKS.join("|")) {
    findings.push({ code: "TASK_COVERAGE", detail: `expected unique CVG-AUD26-001..036, got ${sortedUnique(taskIds).join(",")}` });
  }
  const auditFindingIds = manifest.aud27_finding_catalog.map((finding) => finding.id).sort();
  const expectedAuditFindings = Array.from({ length: 20 }, (_, index) => `A27-F${String(index + 1).padStart(2, "0")}`);
  if (auditFindingIds.length !== expectedAuditFindings.length || auditFindingIds.join("|") !== expectedAuditFindings.join("|")) findings.push({ code: "AUD27_FINDING_COVERAGE", detail: `expected unique A27-F01..A27-F20, got ${auditFindingIds.join(",")}` });
  for (const source of Object.values(manifest.source_documents)) {
    const path = pathForSource(source.path);
    if (!existsSync(path)) {
      findings.push({ code: "SOURCE_MISSING", detail: `semantic source is missing: ${source.path}` });
      continue;
    }
    const actual = sha256(readFileSync(path));
    if (actual !== source.sha256) findings.push({ code: "SOURCE_HASH_DRIFT", detail: `${source.path} expected ${source.sha256}, got ${actual}` });
  }
  return findings;
}

export function validateAud27Semantics(manifest: Manifest, backlog: Backlog): SemanticFinding[] {
  const findings = validateManifestShape(manifest);
  const backlogById = new Map(backlog.items.map((item) => [item.id, item]));
  const manifestTasks = new Map(manifest.aud26_task_catalog.map((task) => [task.id, task]));
  for (const expectedTask of EXPECTED_TASKS) {
    const canonical = manifestTasks.get(expectedTask);
    const current = backlogById.get(expectedTask);
    if (!canonical || !current) {
      findings.push({ code: "TASK_MISSING", detail: `${expectedTask} is missing from manifest or backlog` });
      continue;
    }
    if (current.semantic_subject !== canonical.semantic_subject) {
      findings.push({ code: "SEMANTIC_SUBJECT_MISMATCH", detail: `${expectedTask} expected ${canonical.semantic_subject}, got ${current.semantic_subject ?? "(missing)"}` });
    }
    if (current.title !== canonical.title) {
      findings.push({ code: "TASK_TITLE_MISMATCH", detail: `${expectedTask} expected ${canonical.title}, got ${current.title ?? "(missing)"}` });
    }
    const expectedFindings = sortedUnique(canonical.findings);
    const currentFindings = sortedUnique(current.findings ?? []);
    if (expectedFindings.join("|") !== currentFindings.join("|")) {
      findings.push({ code: "FINDING_SET_MISMATCH", detail: `${expectedTask} expected ${expectedFindings.join(",")}, got ${currentFindings.join(",")}` });
    }
  }
  for (const finding of manifest.finding_catalog) {
    const references = manifest.aud26_task_catalog.filter((task) => task.findings.includes(finding.id));
    if (references.length === 0) findings.push({ code: "ORPHAN_FINDING", detail: `${finding.id} has no canonical task` });
    for (const task of references) {
      if (!task.aggregate && !finding.canonical_tasks.includes(task.id)) findings.push({ code: "TASK_FINDING_RELATIONSHIP", detail: `${task.id} declares ${finding.id}, but the finding does not declare the task` });
    }
    for (const taskId of finding.canonical_tasks) {
      if (!references.some((task) => task.id === taskId)) findings.push({ code: "TASK_FINDING_RELATIONSHIP", detail: `${finding.id} declares ${taskId}, but the task does not declare the finding` });
    }
  }
  const aud27Items = backlog.items.filter((item) => item.id.startsWith("AUD27-")) as Array<BacklogItem & { observed?: unknown; remaining?: unknown; evidence_state?: string; blocker_type?: string | null; blocker_owner?: string | null }>;
  for (const item of aud27Items) {
    if (item.observed === undefined || item.observed === null || item.observed === "") findings.push({ code: "MISSING_OBSERVED_STATE", detail: `${item.id} has no observed state` });
    if (item.remaining === undefined || item.remaining === null) findings.push({ code: "MISSING_REMAINING_STATE", detail: `${item.id} has no remaining state` });
    if (!item.evidence_state) findings.push({ code: "MISSING_EVIDENCE_STATE", detail: `${item.id} has no evidence_state` });
    if (item.status?.startsWith("BLOCKED_") && (!item.blocker_type || !item.blocker_owner)) findings.push({ code: "BLOCKER_OWNER_OR_TYPE_MISSING", detail: `${item.id} is blocked without a typed owner` });
  }
  return findings;
}

export function knownBadSemanticFixtures(manifest: Manifest, backlog: Backlog): Array<{ id: string; rejected: boolean; findings: SemanticFinding[] }> {
  return manifest.aud26_task_catalog
    .filter((task) => ["CVG-AUD26-022", "CVG-AUD26-023", "CVG-AUD26-024", "CVG-AUD26-025", "CVG-AUD26-029"].includes(task.id))
    .map((task) => {
      const mutated: Backlog = { items: backlog.items.map((item) => item.id === task.id ? { ...item, semantic_subject: "known-bad-mutant", findings: ["F39"] } : item) };
      const result = validateAud27Semantics(manifest, mutated).filter((finding) => finding.detail.startsWith(task.id));
      return { id: `NEG-${task.id}`, rejected: result.length > 0, findings: result };
    });
}

export function runAud27SemanticVerification(): void {
  const manifest = readJson<Manifest>(MANIFEST_PATH);
  const backlog = readJson<Backlog>(BACKLOG_PATH);
  const findings = validateAud27Semantics(manifest, backlog);
  const fixtures = knownBadSemanticFixtures(manifest, backlog);
  const rejected = fixtures.filter((fixture) => fixture.rejected).length;
  if (fixtures.length !== 5 || rejected !== fixtures.length) findings.push({ code: "KNOWN_BAD_ACCEPTED", detail: `known-bad semantic fixtures rejected ${rejected}/${fixtures.length}` });
  if (findings.length > 0) {
    for (const finding of findings) console.error(`${finding.code}: ${finding.detail}`);
    throw new Error(`AUD27 semantic verification failed with ${findings.length} finding(s)`);
  }
  console.log(`AUD27_SEMANTICS_VERIFIED findings=39 aud26_tasks=36 known_bad_rejected=${rejected}/5`);
}

if (process.argv[1]?.endsWith("verify-aud27-semantics.ts")) runAud27SemanticVerification();
