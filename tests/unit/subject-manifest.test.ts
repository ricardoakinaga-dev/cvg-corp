import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSubjectManifest, subjectFingerprint, subjectPathIsExcluded, validateSubjectManifest } from "../../scripts/subject-manifest.ts";

const defaultEvidenceRoot = "cvg-aud27-evidence";

test("subject manifest binds tracked deletions before and after staging", () => {
  const root = mkdtempSync(join(tmpdir(), "cvg-subject-deletion-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  try {
    writeFileSync(join(root, "obsolete.ts"), "export const obsolete = true;\n");
    git("init", "--quiet");
    git("add", "obsolete.ts");
    git("-c", "user.email=subject-test@example.invalid", "-c", "user.name=Subject Test", "commit", "--quiet", "-m", "fixture");
    const baseline = buildSubjectManifest(root);
    rmSync(join(root, "obsolete.ts"));
    const deleted = buildSubjectManifest(root);
    assert.notEqual(deleted.fingerprint, baseline.fingerprint);
    assert.equal(deleted.manifest.trackedFiles.length, 0);
    assert.match(deleted.manifest.unstagedDiff, /deleted file mode/);
    assert.deepEqual(validateSubjectManifest(deleted, root), []);
    assert.ok(validateSubjectManifest(baseline, root).some((error) => error.includes("current candidate")));
    git("add", "--update");
    const staged = buildSubjectManifest(root);
    assert.notEqual(staged.fingerprint, deleted.fingerprint);
    assert.match(staged.manifest.stagedDiff, /deleted file mode/);
    assert.deepEqual(validateSubjectManifest(staged, root), []);
    writeFileSync(join(root, "obsolete.ts"), "export const replacement = true;\n");
    assert.notEqual(buildSubjectManifest(root).fingerprint, staged.fingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("subject manifest is recalculated from the current candidate", () => {
  const result = buildSubjectManifest();
  assert.match(result.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(validateSubjectManifest(result).length, 0);
  assert.equal(result.manifest.sourceSha.length, 40);
  if (!process.env.CVG_EVIDENCE_ROOT?.trim()) assert.match(result.manifest.evidenceRoot ?? "", new RegExp(`${defaultEvidenceRoot}$`));
  assert.ok(result.manifest.trackedFiles.length > 0);
  assert.ok(result.manifest.configurationFiles.some(({ path }) => path === "package-lock.json"));
  assert.ok([...result.manifest.trackedFiles, ...result.manifest.untrackedFiles].some(({ path }) => path === "scripts/subject-manifest.ts"));
  assert.equal(subjectPathIsExcluded(".agent/state.json"), true);
  assert.equal(subjectPathIsExcluded("artifacts/operational-proof/evidence-snapshot.json"), true);
  assert.equal(subjectPathIsExcluded(".gauntlet/.writer.lock"), true);
  assert.equal(subjectPathIsExcluded(".opencode/state.json"), true);
  assert.equal(subjectPathIsExcluded("packages/persistence/src/index.ts"), false);
});

test("subject fingerprint is independent of checkout and external evidence roots", () => {
  const result = buildSubjectManifest();
  const relocated = {
    ...result.manifest,
    candidateRoot: "/another/checkout",
    evidenceRoot: "/another/evidence-root"
  };
  assert.equal(subjectFingerprint(relocated), result.fingerprint);
});

test("subject known-bad mutation is rejected by independent recalculation", () => {
  const result = buildSubjectManifest();
  const mutant = { ...result, fingerprint: "sha256:" + "0".repeat(64) };
  assert.ok(validateSubjectManifest(mutant).some((error) => error.includes("fingerprint")));
});

test("Gauntlet metadata writes do not change the subject fingerprint, but source edits do", () => {
  const root = mkdtempSync(join(tmpdir(), "cvg-subject-manifest-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, ".gauntlet"), { recursive: true });
    writeFileSync(join(root, "src", "index.ts"), "export const value = 1;\n");
    execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "subject-manifest@example.invalid"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Subject Manifest Test"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "src/index.ts"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "--quiet", "-m", "baseline"], { cwd: root, stdio: "ignore" });

    const baseline = buildSubjectManifest(root).fingerprint;
    writeFileSync(join(root, ".gauntlet", ".writer.lock"), '{"pid":123,"timestamp":"2026-09-24T00:00:00Z"}\n');
    assert.equal(buildSubjectManifest(root).fingerprint, baseline);

    writeFileSync(join(root, "src", "index.ts"), "export const value = 2;\n");
    assert.notEqual(buildSubjectManifest(root).fingerprint, baseline);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
