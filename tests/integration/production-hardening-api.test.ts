import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorEnvelopeSchema } from "@cvg/contracts";
import { CvgStore } from "@cvg/domain";
import { createRuntime } from "../../apps/api/src/app.ts";

test("production hardening: HTTP input failures preserve client status and error contracts", async (t) => {
  const runtime = await createRuntime({
    store: new CvgStore({ bootstrapPassword: "synthetic-hardening-password" }),
    config: {
      nodeEnv: "test", host: "127.0.0.1", storageMode: "memory", demoMode: true,
      secretProvider: "none", agentRuntimeMode: "disabled", authMfaMode: "disabled"
    }
  });
  t.after(() => runtime.app.close());
  const address = await runtime.app.listen({ host: "127.0.0.1", port: 0 });
  const cases = [
    { name: "malformed JSON", body: '{"privateMarker":"synthetic-private-input",', contentType: "application/json", status: 400 },
    { name: "empty JSON", body: "", contentType: "application/json", status: 400 },
    { name: "unsupported media type", body: "synthetic-private-input", contentType: "application/xml", status: 415 },
    { name: "oversized body", body: JSON.stringify({ privateMarker: "x".repeat(256 * 1024) }), contentType: "application/json", status: 413 },
    { name: "invalid login schema", body: "{}", contentType: "application/json", status: 400 }
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const response = await fetch(`${address}/api/v1/auth/login`, {
        method: "POST", headers: { "content-type": scenario.contentType }, body: scenario.body,
        signal: AbortSignal.timeout(5_000)
      });
      const body = await response.text();
      assert.equal(response.status, scenario.status, body);
      const parsed = apiErrorEnvelopeSchema.parse(JSON.parse(body));
      assert.equal(parsed.error.code, "INVALID_INPUT");
      assert.equal(body.includes("synthetic-private-input"), false);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  }
  await t.test("incorrect content length remains a client error", async () => {
    const response = await runtime.app.inject({
      method: "POST", url: "/api/v1/auth/login", payload: "{}",
      headers: { "content-type": "application/json", "content-length": "1" }
    });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(apiErrorEnvelopeSchema.parse(response.json()).error.code, "INVALID_INPUT");
  });
  await t.test("protected route still requires a session", async () => {
    const response = await runtime.app.inject({ method: "GET", url: "/api/v1/patients" });
    assert.equal(response.statusCode, 401);
    assert.equal(apiErrorEnvelopeSchema.parse(response.json()).error.code, "UNAUTHENTICATED");
  });
  await t.test("unconfigured inbox fails closed without a durable side effect", async () => {
    const response = await runtime.app.inject({ method: "POST", url: "/api/v1/integrations/synthetic/events", payload: {} });
    assert.equal(response.statusCode, 503);
    assert.equal(apiErrorEnvelopeSchema.parse(response.json()).error.code, "CAPABILITY_DISABLED");
  });
});
