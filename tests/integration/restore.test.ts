import test from "node:test";
import assert from "node:assert/strict";
import { CvgStore } from "@cvg/domain";

test("restore fixture never reactivates old authority", () => {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  store.createSession(store.bootstrapCredentials.userId, "digest", "csrf", 60);
  const snapshot = store.snapshot();
  store.restore(snapshot);
  assert.equal(store.healthStatus, "QUARANTINED");
  assert.equal(store.findSession("digest"), undefined);
  assert.equal(store.quarantined.at(-1)?.kind, "RESTORE");
});
