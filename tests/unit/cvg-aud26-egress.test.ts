import test from "node:test";
import assert from "node:assert/strict";
import { EgressPolicyViolation, HttpMessagingProvider, isAllowedEgressAddress, fetchWithEgressPolicy, MessagingProviderError, validateEgressTarget } from "@cvg/integrations";

const publicAddress = "93.184.216.34";

test("egress IP policy rejects private, reserved and alternative IPv4/IPv6 representations", async () => {
  assert.equal(isAllowedEgressAddress(publicAddress), true);
  assert.equal(isAllowedEgressAddress("2001:4860:4860::8888"), true);
  assert.equal(isAllowedEgressAddress("2001:4860:4860:0:0:0:0:8888"), true);
  for (const address of ["127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.1.1", "192.168.1.1", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "::ffff:7f00:1"]) {
    assert.equal(isAllowedEgressAddress(address), false, address);
  }
  await assert.rejects(
    () => validateEgressTarget("https://provider.example.test", { allowedHosts: ["provider.example.test"], resolveHostname: async () => [publicAddress, "0:0:0:0:0:ffff:7f00:1"] }),
    (error: unknown) => error instanceof EgressPolicyViolation && error.phase === "INITIAL"
  );
});

test("egress blocks IPv4 translation/tunnel ranges and operator-configured network-specific prefixes", async () => {
  for (const address of [
    "64:ff9b::a9fe:a9fe", // RFC 6052 well-known translation to 169.254.169.254.
    "64:ff9b:1:a9fe:a9fe::", // RFC 8215 local-use translation space.
    "2001::c000:201", // Teredo.
    "2002:c0a8:0101::", // 6to4 embedding of 192.168.1.1.
    "100::1" // IPv6 discard-only space.
  ]) {
    assert.equal(isAllowedEgressAddress(address), false, address);
  }

  let dispatched = false;
  const fetcher = async () => {
    dispatched = true;
    return { status: 200, ok: true, headers: {}, json: async () => ({ ok: true }) };
  };
  await assert.rejects(
    () => fetchWithEgressPolicy(fetcher, "https://provider.example.test", {}, {
      allowedHosts: ["provider.example.test"],
      resolveHostname: async () => [publicAddress, "64:ff9b::a9fe:a9fe"]
    }),
    (error: unknown) => error instanceof EgressPolicyViolation && error.phase === "INITIAL"
  );
  assert.equal(dispatched, false, "translation DNS answer must be rejected before fetch dispatch");

  const networkSpecificTranslation = "2001:4860:100::a9fe:a9fe";
  assert.equal(isAllowedEgressAddress(networkSpecificTranslation), true);
  await assert.rejects(
    () => validateEgressTarget("https://provider.example.test", {
      blockedIpv6Prefixes: ["2001:4860:100::/48"],
      resolveHostname: async () => [networkSpecificTranslation]
    }),
    (error: unknown) => error instanceof EgressPolicyViolation && error.phase === "INITIAL"
  );
  const mutableBlockedPrefixes = ["2001:4860:100::/48"];
  await assert.rejects(
    () => validateEgressTarget("https://provider.example.test", {
      blockedIpv6Prefixes: mutableBlockedPrefixes,
      resolveHostname: async () => {
        mutableBlockedPrefixes.length = 0;
        return [networkSpecificTranslation];
      }
    }),
    (error: unknown) => error instanceof EgressPolicyViolation && error.phase === "INITIAL"
  );
  await assert.rejects(
    () => validateEgressTarget("https://provider.example.test", {
      blockedIpv6Prefixes: ["not-an-ipv6-prefix"],
      resolveHostname: async () => [publicAddress]
    }),
    (error: unknown) => error instanceof EgressPolicyViolation && error.reason === "blocked IPv6 prefix policy is invalid"
  );
});

test("egress validates every redirect and never replays a POST", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string, _init?: RequestInit) => {
    calls.push(url);
    if (calls.length === 1) return { status: 302, ok: false, headers: { location: "https://redirect.example.test/next" } };
    return { status: 200, ok: true, headers: {}, json: async () => ({ ok: true }) };
  };
  await assert.rejects(
    () => fetchWithEgressPolicy(fetcher, "https://provider.example.test/start", { method: "POST", headers: { authorization: "Bearer secret", cookie: "session=secret" } }, { allowedHosts: ["provider.example.test", "redirect.example.test"], maxRedirects: 1, resolveHostname: async () => [publicAddress] }),
    (error: unknown) => error instanceof EgressPolicyViolation && error.phase === "REDIRECT"
  );
  assert.deepEqual(calls, ["https://provider.example.test/start"]);
});

test("egress re-resolves a read redirect and strips sensitive headers on the next hop", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (calls.length === 1) return { status: 302, ok: false, headers: { location: "https://redirect.example.test/next" } };
    return { status: 200, ok: true, headers: {}, json: async () => ({ ok: true }) };
  };
  const result = await fetchWithEgressPolicy(fetcher, "https://provider.example.test/start", { method: "GET", headers: { authorization: "Bearer secret", cookie: "session=secret" } }, { allowedHosts: ["provider.example.test", "redirect.example.test"], maxRedirects: 1, resolveHostname: async () => [publicAddress] });
  assert.equal(result.response.status, 200);
  assert.deepEqual(calls.map((call) => call.url), ["https://provider.example.test/start", "https://redirect.example.test/next"]);
  const redirectedHeaders = new Headers(calls[1]?.init?.headers);
  assert.equal(redirectedHeaders.get("authorization"), null);
  assert.equal(redirectedHeaders.get("cookie"), null);
});

test("messaging adapter cancels an oversized chunked response before full buffering", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("{\"requestId\":\"request-chunked\",\"providerRequestId\":\"provider-chunked\",\"body\":\""));
      controller.enqueue(encoder.encode("x".repeat(128)));
    },
    cancel() {
      cancelled = true;
    }
  });
  const provider = new HttpMessagingProvider({
    endpoint: "https://provider.example.test",
    credentialRef: "messaging.token",
    secretResolver: async () => "fixture-secret",
    maxResponseBodyBytes: 64,
    fetch: async () => ({ status: 200, ok: true, headers: {}, body })
  });
  const result = await provider.send({ idempotencyKey: "chunked-limit", channel: "SMS", recipient: "+5511999999999", body: "fixture" });
  assert.equal(result.status, "OUTCOME_UNKNOWN");
  assert.equal(cancelled, true);
});

test("messaging adapter rejects DNS answers that include a private address before dispatch", async () => {
  let dispatched = false;
  const provider = new HttpMessagingProvider({
    endpoint: "https://provider.example.test",
    credentialRef: "messaging.token",
    secretResolver: async () => "fixture-secret",
    resolveHostname: async () => [publicAddress, "127.0.0.1"],
    fetch: async () => {
      dispatched = true;
      return { status: 200, ok: true, headers: {}, json: async () => ({}) };
    }
  });
  await assert.rejects(
    () => provider.send({ idempotencyKey: "dns-rebinding", channel: "SMS", recipient: "+5511999999999", body: "fixture" }),
    (error: unknown) => error instanceof MessagingProviderError && error.failure === "CONFIGURATION"
  );
  assert.equal(dispatched, false);
});

test("messaging adapter applies configured network-specific IPv6 deny prefixes", async () => {
  let dispatched = false;
  const provider = new HttpMessagingProvider({
    endpoint: "https://provider.example.test",
    credentialRef: "messaging.token",
    secretResolver: async () => "fixture-secret",
    blockedIpv6Prefixes: ["2001:4860:100::/48"],
    resolveHostname: async () => ["2001:4860:100::a9fe:a9fe"],
    fetch: async () => {
      dispatched = true;
      return { status: 200, ok: true, headers: {}, json: async () => ({}) };
    }
  });
  await assert.rejects(
    () => provider.send({ idempotencyKey: "network-specific-nat64", channel: "SMS", recipient: "+5511999999999", body: "fixture" }),
    (error: unknown) => error instanceof MessagingProviderError && error.failure === "CONFIGURATION"
  );
  assert.equal(dispatched, false);
});
