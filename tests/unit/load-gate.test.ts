import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inspectLoadScript, LOAD_SCRIPT_PATH } from "../../scripts/verify-load.ts";
import { doubleDuration } from "../load/duration.js";

test("load contract declares the required production-like scenarios and fail-closed inputs", async () => {
  const source = await readFile(LOAD_SCRIPT_PATH, "utf8");
  assert.deepEqual(inspectLoadScript(source), []);
});

test("load contract rejects a fixture that omits the burst or worker scenario", () => {
  const missing = inspectLoadScript("users_50 users_100 http_req_duration http_req_failed CVG_LOAD_BASE_URL CVG_LOAD_BEARER_TOKEN deepseek_turn provider_ack");
  assert.deepEqual(missing, ["burst", "worker_backlog", "doubleDuration", "startTime: doubleDuration(duration)"]);
});

test("load burst starts after two complete user phases", () => {
  assert.equal(doubleDuration("30s"), "60s");
  assert.equal(doubleDuration("1m30s"), "180s");
  assert.throws(() => doubleDuration("2"), /invalid duration/);
  assert.throws(() => doubleDuration("0s"), /invalid duration/);
});
