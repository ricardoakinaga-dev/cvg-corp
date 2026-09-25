import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDocumentIntegrity } from "../../scripts/docs-integrity.ts";

test("accepts live links and heading anchors", () => {
  const docs = new Map([
    ["docs/README.md", "[Guide](guide.md#current-state)"],
    ["docs/guide.md", "# Current State"]
  ]);
  assert.deepEqual(validateDocumentIntegrity(docs, (path) => docs.has(path)), []);
});

test("rejects deleted links and unresolved anchors", () => {
  const docs = new Map([
    ["docs/README.md", "[Deleted](gone.md) and [missing section](guide.md#gone)"],
    ["docs/guide.md", "# Current State"]
  ]);
  const findings = validateDocumentIntegrity(docs, (path) => docs.has(path));
  assert.deepEqual(findings.map((finding) => finding.code).sort(), ["BROKEN_ANCHOR", "BROKEN_LINK"]);
});

test("rejects duplicate ADR numbers and filename-heading mismatches", () => {
  const docs = new Map([
    ["docs/adr/036-first.md", "# ADR 036 — First"],
    ["docs/adr/036-second.md", "# ADR 036 — Second"],
    ["docs/adr/039-mismatch.md", "# ADR 040 — Mismatch"]
  ]);
  const findings = validateDocumentIntegrity(docs, (path) => docs.has(path));
  assert.deepEqual(findings.map((finding) => finding.code).sort(), ["ADR_FILENAME_NUMBER_MISMATCH", "DUPLICATE_ADR_NUMBER"]);
});

test("documentation CLI exits non-zero for a deleted-file link and duplicate ADR", () => {
  const root = mkdtempSync(join(tmpdir(), "cvg-docs-integrity-"));
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const scriptPath = fileURLToPath(new URL("../../scripts/docs-integrity.ts", import.meta.url));
  try {
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    writeFileSync(join(root, "docs/README.md"), "[Removed](gone.md)\n", "utf8");
    writeFileSync(join(root, "docs/adr/001-first.md"), "# ADR 001 — First\n", "utf8");
    writeFileSync(join(root, "docs/adr/001-duplicate.md"), "# ADR 001 — Duplicate\n", "utf8");

    const result = spawnSync(process.execPath, ["--import", "tsx", scriptPath], {
      cwd: repositoryRoot,
      env: { ...process.env, CVG_REPO_ROOT: root },
      encoding: "utf8",
      timeout: 15_000
    });

    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /DOCS_INTEGRITY_FAIL .*findings=2/);
    assert.match(result.stdout, /BROKEN_LINK file=docs\/README\.md detail=missing target gone\.md/);
    assert.match(result.stdout, /DUPLICATE_ADR_NUMBER/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("requires focused contributor checks and safe database preconditions", () => {
  const valid = "## Focused checks by area\nnpm run verify:control-plane\ntests/unit/api-response-contract.test.ts\nnpm test\nexplicitly identified disposable PostgreSQL database\nshared or production database\nnpm run test:e2e\nnpm run typecheck";
  assert.deepEqual(validateDocumentIntegrity(new Map([["CONTRIBUTING.md", valid]]), () => true), []);
  const findings = validateDocumentIntegrity(new Map([["CONTRIBUTING.md", "## Local checks\nnpm test"]]), () => true);
  assert.ok(findings.some((finding) => finding.code === "CONTRIBUTING_GUIDANCE_MISSING"));
});
