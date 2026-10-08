import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { ConfigError, loadCvgConfig } from "@cvg/config";
import { EnvironmentSecretProvider } from "@cvg/integrations";
import type { DurableInboxInput } from "@cvg/persistence";
import { createInboxSignatureVerifier } from "../../apps/api/src/integration-callback.ts";

// Synthetic HMAC material only; these values never leave the test process.
const environment = {
  CVG_SECRET_PROVIDER_A_CALLBACK_V1: "synthetic-provider-a-callback-v1",
  CVG_SECRET_PROVIDER_A_CALLBACK_V2: "synthetic-provider-a-callback-v2",
  CVG_SECRET_PROVIDER_B_CALLBACK_V1: "synthetic-provider-b-callback-v1"
};
const secrets = new EnvironmentSecretProvider(environment, "CVG_SECRET_");
const resolve = (reference: string) => secrets.resolve(reference);

function signedInput(provider: string, signatureKeyRef: string, signingSecret: string): DurableInboxInput {
  const payload = { synthetic: true, provider };
  const rawBody = JSON.stringify({ provider, payload });
  return {
    id: randomUUID() as DurableInboxInput["id"], organizationId: randomUUID() as DurableInboxInput["organizationId"],
    consumer: "synthetic-consumer", provider, externalEventId: `event-${randomUUID()}`, eventType: "synthetic.callback",
    schemaVersion: 1, signatureAlgorithm: "HMAC-SHA256", signatureKeyRef,
    signature: createHmac("sha256", signingSecret).update(rawBody, "utf8").digest("hex"), rawBody, payload
  };
}

test("SEC-AI-03: a key bound to one provider cannot authenticate another provider's callback", async () => {
  const verifier = createInboxSignatureVerifier(resolve, ["provider-a=provider-a.callback.v1", "provider-b=provider-b.callback.v1"]);
  // The audit probe: provider-b's body, correctly signed with provider-a's key.
  assert.equal(await verifier(signedInput("provider-b", "provider-a.callback.v1", environment.CVG_SECRET_PROVIDER_A_CALLBACK_V1)), false);
  assert.equal(await verifier(signedInput("provider-a", "provider-a.callback.v1", environment.CVG_SECRET_PROVIDER_A_CALLBACK_V1)), true);
  assert.equal(await verifier(signedInput("provider-b", "provider-b.callback.v1", environment.CVG_SECRET_PROVIDER_B_CALLBACK_V1)), true);
});

test("SEC-AI-03: rotation is allowed only within the provider's own bindings, and unbound keys are never resolved", async () => {
  const resolved: string[] = [];
  const verifier = createInboxSignatureVerifier(async (reference) => { resolved.push(reference); return resolve(reference); }, ["provider-a=provider-a.callback.v1", "provider-a=provider-a.callback.v2"]);
  assert.equal(await verifier(signedInput("provider-a", "provider-a.callback.v2", environment.CVG_SECRET_PROVIDER_A_CALLBACK_V2)), true);
  assert.equal(await verifier(signedInput("provider-a", "provider-b.callback.v1", environment.CVG_SECRET_PROVIDER_B_CALLBACK_V1)), false);
  assert.equal(await verifier(signedInput("provider-b", "provider-a.callback.v1", environment.CVG_SECRET_PROVIDER_A_CALLBACK_V1)), false);
  assert.deepEqual(resolved, ["provider-a.callback.v2"]);
  // A bound key still needs the matching signature and raw body.
  assert.equal(await verifier({ ...signedInput("provider-a", "provider-a.callback.v1", "wrong-secret") }), false);
  assert.equal(await verifier({ ...signedInput("provider-a", "provider-a.callback.v1", environment.CVG_SECRET_PROVIDER_A_CALLBACK_V1), rawBody: "" }), false);
  assert.equal(await createInboxSignatureVerifier(resolve, [])(signedInput("provider-a", "provider-a.callback.v1", environment.CVG_SECRET_PROVIDER_A_CALLBACK_V1)), false);
});

test("callback key bindings load from configuration and reject malformed pairs", () => {
  const config = loadCvgConfig({ NODE_ENV: "test", CVG_INTEGRATION_CALLBACK_KEYS: " provider-a=provider-a.callback.v1, provider-a=provider-a.callback.v2 ,," });
  assert.deepEqual(config.integrationCallbackKeyRefs, ["provider-a=provider-a.callback.v1", "provider-a=provider-a.callback.v2"]);
  assert.deepEqual(loadCvgConfig({ NODE_ENV: "test" }).integrationCallbackKeyRefs, []);
  for (const malformed of ["provider-a", "=key", "provider a=key", "provider-a=key=extra"]) {
    assert.throws(() => loadCvgConfig({ NODE_ENV: "test", CVG_INTEGRATION_CALLBACK_KEYS: malformed }), ConfigError, malformed);
  }
});
