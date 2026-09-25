import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface EvidenceCompletenessItem {
  readonly id: string;
  readonly status?: string;
  readonly evidence_refs?: readonly string[];
}

export interface EvidenceCompletenessRecord {
  readonly id?: string;
  readonly evidence_kind?: string;
  readonly result?: string;
  readonly freshness?: string;
}

export interface EvidenceCompletenessFinding {
  readonly code: "DONE_SUBJECT_REBIND_ONLY" | "PARTIAL_EVIDENCE_MISSING";
  readonly itemId: string;
  readonly detail: string;
}

export interface EvidenceCompletenessResult {
  readonly doneCount: number;
  readonly partialCount: number;
  readonly doneSubjectRebindOnly: readonly string[];
  readonly partialEvidenceMissing: readonly string[];
  readonly findings: readonly EvidenceCompletenessFinding[];
}

function referenceId(reference: string): string | undefined {
  const trimmed = reference.trim();
  if (!trimmed) return undefined;
  const hashIndex = trimmed.lastIndexOf("#");
  return hashIndex >= 0 ? trimmed.slice(hashIndex + 1) || undefined : trimmed;
}

function isSubjectRebindOnly(record: EvidenceCompletenessRecord): boolean {
  return [record.evidence_kind, record.result]
    .filter((value): value is string => typeof value === "string")
    .some((value) => /\bSUBJECT_REBIND\b/i.test(value));
}

export function validateEvidenceCompleteness(
  items: readonly EvidenceCompletenessItem[],
  records: readonly EvidenceCompletenessRecord[],
): EvidenceCompletenessResult {
  const recordsById = new Map(records.flatMap((record) => record.id ? [[record.id, record] as const] : []));
  const findings: EvidenceCompletenessFinding[] = [];
  const doneSubjectRebindOnly: string[] = [];
  const partialEvidenceMissing: string[] = [];

  for (const item of items) {
    const refs = Array.isArray(item.evidence_refs) ? item.evidence_refs.filter((ref) => typeof ref === "string" && ref.trim().length > 0) : [];
    if (item.status === "DONE" && refs.length > 0) {
      const ids = refs.map(referenceId);
      const resolved = ids.map((id) => id ? recordsById.get(id) : undefined);
      const allRefsResolve = resolved.every((record): record is EvidenceCompletenessRecord => record !== undefined);
      if (allRefsResolve && resolved.length > 0 && resolved.every(isSubjectRebindOnly)) {
        doneSubjectRebindOnly.push(item.id);
        findings.push({
          code: "DONE_SUBJECT_REBIND_ONLY",
          itemId: item.id,
          detail: `${item.id} is DONE but every referenced receipt is SUBJECT_REBIND; historical rebind is not execution proof`,
        });
      }
    }
    if (item.status === "PARTIAL" && refs.length === 0) {
      partialEvidenceMissing.push(item.id);
      findings.push({
        code: "PARTIAL_EVIDENCE_MISSING",
        itemId: item.id,
        detail: `${item.id} is PARTIAL with observable current state but no typed evidence_refs`,
      });
    }
  }

  return {
    doneCount: items.filter((item) => item.status === "DONE").length,
    partialCount: items.filter((item) => item.status === "PARTIAL").length,
    doneSubjectRebindOnly,
    partialEvidenceMissing,
    findings,
  };
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function loadJsonl(path: string): EvidenceCompletenessRecord[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvidenceCompletenessRecord);
}

interface BacklogDocument {
  readonly items?: readonly EvidenceCompletenessItem[];
}

function main(): void {
  const repository = resolve(process.env.CVG_REPO_ROOT?.trim() || process.cwd());
  const backlogPath = resolve(repository, ".agent/backlog.json");
  const verificationPath = resolve(repository, ".agent/verification.jsonl");
  if (!existsSync(backlogPath) || !existsSync(verificationPath)) {
    process.stderr.write(`AUD27_EVIDENCE_COMPLETENESS_FAIL missing control-plane files backlog=${backlogPath} verification=${verificationPath}\n`);
    process.exitCode = 1;
    return;
  }

  const backlog = loadJson<BacklogDocument>(backlogPath);
  const result = validateEvidenceCompleteness(backlog.items ?? [], loadJsonl(verificationPath));
  const status = result.findings.length === 0 ? "PASS" : "BLOCKED";
  process.stdout.write(`AUD27_EVIDENCE_COMPLETENESS_${status} done=${result.doneCount} partial=${result.partialCount} done_subject_rebind_only=${result.doneSubjectRebindOnly.length} partial_missing_refs=${result.partialEvidenceMissing.length}\n`);
  for (const finding of result.findings) process.stdout.write(`${finding.code} item=${finding.itemId} detail=${finding.detail}\n`);
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
