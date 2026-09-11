import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requireExternalEvidenceRoot } from "../../scripts/evidence-boundary.ts";

test("external evidence roots cannot be inside or symlinked into the source worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "cvg-evidence-boundary-"));
  const source = join(root, "source");
  const inside = join(source, "artifacts");
  const outside = join(root, "external");
  await mkdir(inside, { recursive: true });
  await mkdir(outside, { recursive: true });
  const alias = join(source, "external-alias");
  await symlink(outside, alias);
  await assert.rejects(() => requireExternalEvidenceRoot(inside, source), /outside the source worktree/);
  await assert.rejects(() => requireExternalEvidenceRoot(alias, source), /regular directory/);
  assert.equal(await requireExternalEvidenceRoot(outside, source), outside);
});
