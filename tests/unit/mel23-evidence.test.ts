import test from "node:test";
import assert from "node:assert/strict";
import { isCanonicalTaskStatus, MEL23_EVIDENCE_REPORT_PATH, MEL23_EVIDENCE_STATES, MEL23_RECEIPT_RESULTS, MEL23_TASK_STATUSES, resolveMel23EvidenceReportDestination, validateMel23Catalogue, validateMel23EvidenceMatrix, validateStatusVocabularyDocument } from "../../scripts/verify-mel23-evidence.ts";
import { MEL23_CONTROL_PLANE_CAPTURE_PATH, validateControlPlaneCapture, type ControlPlaneCapture } from "../../scripts/capture-mel23-control-plane.ts";

const requirement = { id: "MEL23-001", milestone: "M0", target: "control plane", aud27_ids: ["AUD27-001"], primary_aud27_id: "AUD27-001", coverage: "DIRECT", new_aud27_task: false } as const;
const task = { id: "AUD27-001", status: "IN_PROGRESS", evidence_state: "IMPLEMENTED_UNVERIFIED", evidence_refs: ["VER-001"], next_action: { target: "scripts/verify-control-plane.ts" } } as const;
const receipt = {
  id: "VER-001", timestamp: "2026-09-23T16:00:00-03:00", task: "AUD27-001", evidence_kind: "CURRENT_EXECUTION",
  environment: "workspace local; synthetic-only", result: "PASS", exit_status: 0,
  command_results: [{ command: "npm run verify:control-plane", exit_status: 0 }],
  evidence_artifacts: ["artifacts/operational-proof/control-plane.log#sha256=deadbeef"],
  observed_subject_fingerprint: `sha256:${"a".repeat(64)}`, candidate_fingerprint: null, freshness: "CURRENT", mel23_ids: ["MEL23-001"]
} as const;

test("links a MEL23 requirement to its task, test, receipt, environment, result, and observed fingerprint", () => {
  const report = validateMel23EvidenceMatrix([requirement], [task], [receipt]);
  assert.equal(report.summary.qualified, 1);
  assert.equal(report.rows[0]?.receipt_id, "VER-001");
  assert.equal(report.rows[0]?.test_commands[0], "npm run verify:control-plane");
  assert.equal(report.rows[0]?.fingerprint, receipt.observed_subject_fingerprint);
  assert.deepEqual(report.rows[0]?.evidence_artifacts, receipt.evidence_artifacts);
  assert.ok(report.rows[0]?.aud27[0]?.implementation_targets.includes("scripts/verify-control-plane.ts"));
});

test("keeps a passing MEL23 criterion distinct from its partially complete AUD27 parent", () => {
  const partialParentReceipt = {
    ...receipt,
    result: "IMPLEMENTED_LOCAL",
    criterion_results: { "MEL23-001": "PASS" as const }
  };
  const report = validateMel23EvidenceMatrix([requirement], [task], [partialParentReceipt]);
  assert.equal(report.rows[0]?.result, "PASS");
  assert.equal(report.rows[0]?.receipt_result, "IMPLEMENTED_LOCAL");
  assert.equal(report.summary.qualified, 1);
});

test("fails closed when focal evidence fields are missing or use an ambiguous result alias", () => {
  const incomplete = { ...receipt, result: "GREEN", environment: "", observed_subject_fingerprint: "missing", command_results: [] };
  const report = validateMel23EvidenceMatrix([requirement], [task], [incomplete]);
  assert.equal(report.summary.qualified, 0);
  assert.ok(report.rows[0]?.issues.includes("test command is missing"));
  assert.ok(report.rows[0]?.issues.includes("environment is missing"));
  assert.ok(report.rows[0]?.issues.includes("receipt result uses a noncanonical alias"));
  assert.ok(report.rows[0]?.issues.includes("observed subject fingerprint is missing or malformed"));
});

test("rejects ambiguous task status synonyms", () => {
  assert.equal(isCanonicalTaskStatus("BLOCKED_BY_DEPENDENCIES"), true);
  assert.equal(isCanonicalTaskStatus("BLOCKED"), false);
  assert.equal(isCanonicalTaskStatus("DONE-ISH"), false);
});

test("requires the full 50-item crosswalk and rejects duplicate active MEL23 tasks", () => {
  const requirements = Array.from({ length: 50 }, (_, index) => ({
    id: `MEL23-${String(index + 1).padStart(3, "0")}`, milestone: "M0", target: "criterion",
    aud27_ids: ["AUD27-001"], primary_aud27_id: "AUD27-001", coverage: "DIRECT", new_aud27_task: false
  }));
  assert.deepEqual(validateMel23Catalogue(requirements, [task]), []);
  const invalid = validateMel23Catalogue(requirements.map((entry, index) => index === 0 ? { ...entry, new_aud27_task: true } : entry), [task, { id: "MEL23-002", status: "PLANNED" }]);
  assert.ok(invalid.some((issue) => issue.includes("MEL23-001 is not reconciled")));
  assert.ok(invalid.some((issue) => issue.includes("MEL23-002")));
});

test("checks the documented status vocabulary and catches omitted values", () => {
  const vocabulary = [...MEL23_TASK_STATUSES, ...MEL23_EVIDENCE_STATES, ...MEL23_RECEIPT_RESULTS, "PROMOTION_BLOCKED", "PROMOTION_ELIGIBLE", "AAA_NOT_PROVEN"];
  const complete = vocabulary.map((value) => `\`${value}\``).join(" ");
  assert.deepEqual(validateStatusVocabularyDocument(complete), []);
  assert.ok(validateStatusVocabularyDocument(complete.replace("`PARTIAL_LOCAL_REAL`", "")).some((issue) => issue.includes("PARTIAL_LOCAL_REAL")));
});

test("evidence report defaults to a fresh path and refuses to overwrite the registered Gauntlet matrix", () => {
  assert.equal(resolveMel23EvidenceReportDestination("/repo"), `/repo/${MEL23_EVIDENCE_REPORT_PATH}`);
  assert.throws(
    () => resolveMel23EvidenceReportDestination("/repo", "artifacts/operational-proof/mel23-evidence-matrix.json"),
    /refusing to overwrite registered Gauntlet evidence/
  );
});

test("control-plane capture defaults to a fresh path and preserves the registered historical artifact", () => {
  assert.equal(MEL23_CONTROL_PLANE_CAPTURE_PATH, "artifacts/operational-proof/mel23-control-plane-current.json");
  assert.notEqual(MEL23_CONTROL_PLANE_CAPTURE_PATH, "artifacts/operational-proof/mel23-control-plane-final.json");
});

test("requires a real post-append control-plane pass bound to both ledger tails", () => {
  const pointerState = { last_gate_record: "VER-001", last_event_id: "EVT-001" };
  const subject = { sourceSha: "c990914148a8f375082cd12bbdb2ad20cfe1900f", fingerprint: `sha256:${"a".repeat(64)}` };
  const capture: ControlPlaneCapture = {
    schema_version: 1, requirement_id: "MEL23-001", command: "npm run verify:control-plane",
    exit_status: 0, result: "PASS", executed_at: "2026-09-23T19:00:00.000Z", environment: "local synthetic workspace",
    source_sha: subject.sourceSha, observed_subject_fingerprint: subject.fingerprint,
    last_gate_record: "VER-001", verification_tail: "VER-001", last_event_id: "EVT-001", event_tail: "EVT-001", output: "CONTROL_PLANE_VERIFIED"
  };
  assert.deepEqual(validateControlPlaneCapture(capture, pointerState, "VER-001", "EVT-001", subject), []);
  const stale = { ...capture, last_event_id: "EVT-OLD", exit_status: 1 as const, result: "BLOCKED" as const };
  assert.ok(validateControlPlaneCapture(stale, pointerState, "VER-001", "EVT-001", subject).length > 0);
});
