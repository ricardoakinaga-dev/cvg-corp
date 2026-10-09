import test from "node:test";
import assert from "node:assert/strict";
import { validateEvidenceCompleteness } from "../../scripts/verify-aud27-evidence-completeness.ts";

test("rejects DONE items backed only by a subject rebind receipt", () => {
  const result = validateEvidenceCompleteness(
    [{ id: "CVG-AUD26-001", status: "DONE", evidence_refs: ["VER-001"] }],
    [{ id: "VER-001", evidence_kind: "SUBJECT_REBIND", result: "PASS" }],
  );
  assert.deepEqual(result.doneSubjectRebindOnly, ["CVG-AUD26-001"]);
  assert.equal(result.findings[0]?.code, "DONE_SUBJECT_REBIND_ONLY");
});

test("rejects a partial item without typed evidence references", () => {
  const result = validateEvidenceCompleteness(
    [{ id: "CVG-AUD26-017", status: "PARTIAL", evidence_refs: [] }],
    [],
  );
  assert.deepEqual(result.partialEvidenceMissing, ["CVG-AUD26-017"]);
  assert.equal(result.findings[0]?.code, "PARTIAL_EVIDENCE_MISSING");
});

test("accepts a current execution receipt and path-qualified references", () => {
  const result = validateEvidenceCompleteness(
    [
      { id: "CVG-AUD27-006", status: "PARTIAL", evidence_refs: [".agent/verification.jsonl#VER-006"] },
      { id: "CVG-AUD26-001", status: "DONE", evidence_refs: ["VER-001", ".gauntlet/critique.md"] },
    ],
    [
      { id: "VER-006", evidence_kind: "CURRENT_EVIDENCE_COMPLETENESS_PARTIAL", result: "PARTIAL", freshness: "CURRENT" },
      { id: "VER-001", evidence_kind: "CURRENT_EXECUTION", result: "PASS", freshness: "CURRENT" },
    ],
  );
  assert.deepEqual(result.findings, []);
});
