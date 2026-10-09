import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseVersion, playwrightBrowsersInstalled, runDoctor, versionSatisfies } from "../../scripts/doctor.ts";

test("doctor version helpers accept the pinned toolchain and reject drift", () => {
  assert.deepEqual(parseVersion("v24.20.0"), [24, 20, 0]);
  assert.equal(parseVersion("not-a-version"), null);
  assert.equal(versionSatisfies("24.20.0", "24.20.0", 25), true);
  assert.equal(versionSatisfies("24.19.9", "24.20.0", 25), false);
  assert.equal(versionSatisfies("25.0.0", "24.20.0", 25), false);
  assert.equal(versionSatisfies("11.19.0", "11.19.0", 12), true);
  assert.equal(versionSatisfies("12.0.0", "11.19.0", 12), false);
});

test("doctor detects playwright browser families from the cache directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "cvg-doctor-"));
  mkdirSync(join(directory, "chromium-1234"));
  mkdirSync(join(directory, "firefox-1509"));
  assert.deepEqual(playwrightBrowsersInstalled(directory), { chromium: true, firefox: true, webkit: false });
  rmSync(directory, { recursive: true, force: true });
});

test("doctor reports every required check with a stable verdict shape", () => {
  const checks = runDoctor();
  assert.ok(checks.length >= 8);
  for (const check of checks) {
    assert.equal(typeof check.id, "string");
    assert.equal(typeof check.label, "string");
    assert.equal(typeof check.required, "boolean");
    assert.ok(["PASS", "FAIL", "WARN"].includes(check.status));
  }
});
