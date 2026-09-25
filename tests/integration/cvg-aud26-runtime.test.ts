import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "@cvg/api";
import { CvgStore } from "@cvg/domain";

let runtime: Awaited<ReturnType<typeof createRuntime>>;

before(async () => {
  runtime = await createRuntime({
    store: new CvgStore({ bootstrapPassword: "synthetic-password-123" }),
    config: { nodeEnv: "test", storageMode: "memory", demoMode: true, webOrigin: "http://127.0.0.1:5173" }
  });
});

after(async () => {
  await runtime.app.close();
});

test("runtime response contract admits a cataloged JSON route and explicit text metrics", async () => {
  const health = await runtime.app.inject({ method: "GET", url: "/api/v1/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json<{ schemaVersion: number }>().schemaVersion, 1);

  const metrics = await runtime.app.inject({ method: "GET", url: "/internal/metrics" });
  assert.equal(metrics.statusCode, 200);
  assert.match(String(metrics.headers["content-type"] ?? ""), /text\/plain/);
  assert.match(metrics.body, /cvg_api_requests_total/);
});

test("runtime response contract returns a bounded generic error without echoing invalid secrets", async () => {
  const response = await runtime.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ login: "admin@cvg.local", password: "known-secret-not-for-output", unexpected: true })
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json<{ error: { code: string } }>().error.code, "INVALID_INPUT");
  assert.equal(response.body.includes("known-secret-not-for-output"), false);

  const missing = await runtime.app.inject({ method: "GET", url: "/api/v1/not-cataloged" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json<{ error: { code: string } }>().error.code, "NOT_FOUND");
});
