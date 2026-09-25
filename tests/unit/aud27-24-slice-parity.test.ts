import test from "node:test";
import assert from "node:assert/strict";
import type { StoreSnapshot } from "@cvg/domain";
import {
  assertAud27SnapshotCountParity,
  AUD27_NORMALIZED_TABLE_BY_KEY,
  expectedAud27SnapshotRowCounts,
  type Aud27SliceSnapshotKey
} from "../../scripts/aud27-24-slice-parity.ts";

function snapshotWithProviders(providerCount: number): Pick<StoreSnapshot, Aud27SliceSnapshotKey> {
  const snapshot = Object.fromEntries(Object.keys(AUD27_NORMALIZED_TABLE_BY_KEY).map((key) => [key, [] as unknown[]]));
  snapshot.providers = Array.from({ length: providerCount }, (_, index) => ({ id: `provider-${index}` }));
  return snapshot as unknown as Pick<StoreSnapshot, Aud27SliceSnapshotKey>;
}

test("expected normalized row counts cover every AUD27 snapshot collection and table", () => {
  const snapshot = snapshotWithProviders(2);
  const expected = expectedAud27SnapshotRowCounts(snapshot);
  assert.equal(expected.size, 24);
  assert.equal(new Set(Object.values(AUD27_NORMALIZED_TABLE_BY_KEY)).size, 24);
  assert.equal(expected.get("providers"), 2);
  assertAud27SnapshotCountParity(snapshot, expected, "exact snapshot");
});

test("full snapshot parity rejects a missing unchanged seed row", () => {
  const snapshot = snapshotWithProviders(2);
  const actual = new Map(expectedAud27SnapshotRowCounts(snapshot));
  actual.set("providers", 1);
  assert.throws(
    () => assertAud27SnapshotCountParity(snapshot, actual, "missing unchanged provider"),
    /providers expected=2 actual=1/
  );
});

test("full snapshot parity rejects missing or extra normalized tables", () => {
  const snapshot = snapshotWithProviders(1);
  const missing = new Map(expectedAud27SnapshotRowCounts(snapshot));
  missing.delete("products");
  assert.throws(() => assertAud27SnapshotCountParity(snapshot, missing, "missing table"), /products expected=0 actual=missing/);

  const extra = new Map(expectedAud27SnapshotRowCounts(snapshot));
  extra.set("unexpected_table", 1);
  assert.throws(() => assertAud27SnapshotCountParity(snapshot, extra, "extra table"), /unexpected_table expected=unmapped actual=1/);
});
