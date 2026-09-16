import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { AUTHORITATIVE_COMMAND_REGISTRY, AUTHORITATIVE_DOMAIN_REGISTRY, authoritativeCoverage, SNAPSHOT_PRIMARY_ENTITIES } from "@cvg/persistence";

test("command-owned authoritative writes are fully inventoried with owner and invariants", async () => {
  const coverage = authoritativeCoverage();
  assert.equal(coverage.snapshotKeys.length, 32);
  assert.equal(coverage.uncovered.length, 0);
  assert.equal(coverage.commandOwned.length, 8);
  assert.equal(coverage.snapshotPrimary.length, 24);
  assert.equal(new Set(AUTHORITATIVE_COMMAND_REGISTRY.map((entry) => entry.operation)).size, AUTHORITATIVE_COMMAND_REGISTRY.length);
  assert.equal(new Set(AUTHORITATIVE_COMMAND_REGISTRY.map((entry) => entry.inputField)).size, AUTHORITATIVE_COMMAND_REGISTRY.length);
  const source = await readFile("packages/persistence/src/index.ts", "utf8");
  for (const entry of AUTHORITATIVE_COMMAND_REGISTRY) {
    assert.ok(source.includes(`${entry.inputField}?:`), `missing commit field ${entry.inputField}`);
    assert.ok(entry.owner.length > 0 && entry.invariants.length > 0, `command ${entry.operation} lacks owner/invariants`);
    const collection = AUTHORITATIVE_DOMAIN_REGISTRY.find((candidate) => candidate.snapshotKey === entry.snapshotKey);
    assert.equal(collection?.table, entry.table);
  }
  const migrations = (await Promise.all((await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).map((file) => readFile(`db/migrations/${file}`, "utf8")))).join("\n");
  for (const entry of AUTHORITATIVE_COMMAND_REGISTRY) assert.match(migrations, new RegExp(`create table(?: if not exists)? ${entry.table}\\b`, "i"));
  for (const entry of SNAPSHOT_PRIMARY_ENTITIES) assert.ok(coverage.snapshotKeys.includes(entry.snapshotKey));
  assert.equal(coverage.commandOwned.filter((key) => coverage.snapshotPrimary.includes(key)).length, 0);
});
