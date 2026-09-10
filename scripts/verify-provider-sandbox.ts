import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "@cvg/domain";
import { HttpMessagingProvider, verifyMessagingCallback, type MessagingReceipt } from "@cvg/integrations";

const FIXTURE_SECRET = "loopback-provider-fixture-secret";
const FIXTURE_TIMESTAMP = "2026-09-09T23:00:00.000Z";

type JsonRecord = Record<string, unknown>;

type SandboxMessage = {
  idempotencyKey: string;
  requestDigest: string;
  requestId: string;
  providerRequestId: string;
  receipt: MessagingReceipt;
};

type SandboxStats = {
  sendRequests: number;
  queryRequests: number;
  callbackRequests: number;
  simulatedLostResponses: number;
};

type ProviderSandbox = {
  endpoint: string;
  server: ReturnType<typeof createServer>;
  stats(): SandboxStats;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function writeJson(response: ServerResponse, status: number, payload: JsonRecord): void {
  if (response.destroyed) return;
  const body = JSON.stringify(payload);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 64 * 1024) throw new Error("sandbox request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function delayed(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function startProviderSandbox(): Promise<ProviderSandbox> {
  const messages = new Map<string, SandboxMessage>();
  let sendRequests = 0;
  let queryRequests = 0;
  let callbackRequests = 0;
  let simulatedLostResponses = 0;

  const server = createServer(async (request, response) => {
    try {
      if (header(request, "authorization") !== `Bearer ${FIXTURE_SECRET}`) {
        writeJson(response, 401, { error: "UNAUTHORIZED" });
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "POST" && url.pathname === "/messages") {
        sendRequests += 1;
        const parsed: unknown = JSON.parse(await readBody(request));
        if (!isRecord(parsed) || typeof parsed.idempotencyKey !== "string" || typeof parsed.requestId !== "string" || typeof parsed.channel !== "string" || typeof parsed.to !== "string" || typeof parsed.body !== "string") {
          writeJson(response, 422, { error: "INVALID_REQUEST" });
          return;
        }
        if (header(request, "idempotency-key") !== parsed.idempotencyKey || header(request, "x-request-id") !== parsed.requestId) {
          writeJson(response, 422, { error: "REQUEST_HEADER_MISMATCH" });
          return;
        }

        const requestDigest = digest({ idempotencyKey: parsed.idempotencyKey, channel: parsed.channel, recipient: parsed.to, body: parsed.body, metadata: parsed.metadata ?? null });
        const existing = messages.get(parsed.idempotencyKey);
        if (existing && existing.requestDigest !== requestDigest) {
          writeJson(response, 409, { error: "IDEMPOTENCY_CONFLICT" });
          return;
        }

        const message = existing ?? (() => {
          const providerRequestId = `sandbox-request-${digest({ idempotencyKey: parsed.idempotencyKey }).slice(0, 24)}`;
          const providerMessageId = `sandbox-message-${digest({ idempotencyKey: parsed.idempotencyKey, requestDigest }).slice(0, 24)}`;
          const receiptStatus = parsed.idempotencyKey === "sandbox-delivered" ? "DELIVERED" : "ACCEPTED";
          const receipt: MessagingReceipt = {
            providerRequestId,
            providerMessageId,
            status: receiptStatus,
            receivedAt: FIXTURE_TIMESTAMP,
            receiptDigest: digest({ providerRequestId, providerMessageId, status: receiptStatus, receivedAt: FIXTURE_TIMESTAMP })
          };
          const created: SandboxMessage = { idempotencyKey: parsed.idempotencyKey, requestDigest, requestId: parsed.requestId, providerRequestId, receipt };
          messages.set(parsed.idempotencyKey, created);
          return created;
        })();

        // Simulates an effect that was accepted before the response was lost.
        if (parsed.idempotencyKey === "sandbox-timeout" || url.searchParams.get("mode") === "timeout") {
          simulatedLostResponses += 1;
          return;
        }
        writeJson(response, message.receipt.status === "DELIVERED" ? 200 : 202, { requestId: parsed.requestId, providerRequestId: message.providerRequestId, status: message.receipt.status, receipt: message.receipt });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/messages/")) {
        queryRequests += 1;
        const identity = decodeURIComponent(url.pathname.slice("/messages/".length));
        const message = [...messages.values()].find((candidate) => candidate.providerRequestId === identity || candidate.idempotencyKey === identity);
        if (!message) {
          writeJson(response, 404, { error: "NOT_FOUND" });
          return;
        }
        const deliveredReceipt: MessagingReceipt = { ...message.receipt, status: "DELIVERED", receiptDigest: digest({ providerRequestId: message.receipt.providerRequestId, providerMessageId: message.receipt.providerMessageId, status: "DELIVERED", receivedAt: message.receipt.receivedAt }) };
        writeJson(response, 200, { requestId: header(request, "x-request-id"), providerRequestId: message.providerRequestId, status: "SUCCEEDED", receipt: deliveredReceipt });
        return;
      }

      if (request.method === "POST" && url.pathname === "/callbacks") {
        callbackRequests += 1;
        const rawBody = await readBody(request);
        const signature = header(request, "x-callback-signature");
        if (!verifyMessagingCallback(rawBody, signature, FIXTURE_SECRET)) {
          writeJson(response, 401, { error: "INVALID_CALLBACK_SIGNATURE" });
          return;
        }
        const payload: unknown = JSON.parse(rawBody);
        if (!isRecord(payload) || typeof payload.providerRequestId !== "string") {
          writeJson(response, 422, { error: "INVALID_CALLBACK" });
          return;
        }
        writeJson(response, 202, { accepted: true });
        return;
      }

      writeJson(response, 404, { error: "NOT_FOUND" });
    } catch {
      writeJson(response, 500, { error: "SANDBOX_INTERNAL_ERROR" });
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  assert(address && typeof address === "object", "provider sandbox did not expose a listen address");
  const seededIdempotencyKey = "sandbox-timeout";
  const seededRequestId = "sandbox-seed-timeout";
  const seededChannel = "SMS";
  const seededRecipient = "+5511999999999";
  const seededBody = "accepted-before-response-loss";
  const seededRequestDigest = digest({ idempotencyKey: seededIdempotencyKey, channel: seededChannel, recipient: seededRecipient, body: seededBody, metadata: null });
  const seededProviderRequestId = `sandbox-request-${digest({ idempotencyKey: seededIdempotencyKey }).slice(0, 24)}`;
  const seededProviderMessageId = `sandbox-message-${digest({ idempotencyKey: seededIdempotencyKey, requestDigest: seededRequestDigest }).slice(0, 24)}`;
  const seededReceipt: MessagingReceipt = { providerRequestId: seededProviderRequestId, providerMessageId: seededProviderMessageId, status: "ACCEPTED", receivedAt: FIXTURE_TIMESTAMP, receiptDigest: digest({ providerRequestId: seededProviderRequestId, providerMessageId: seededProviderMessageId, status: "ACCEPTED", receivedAt: FIXTURE_TIMESTAMP }) };
  messages.set(seededIdempotencyKey, { idempotencyKey: seededIdempotencyKey, requestDigest: seededRequestDigest, requestId: seededRequestId, providerRequestId: seededProviderRequestId, receipt: seededReceipt });
  return {
    endpoint: `http://localhost:${address.port}`,
    server,
    stats: () => ({ sendRequests, queryRequests, callbackRequests, simulatedLostResponses })
  };
}

async function closeProviderSandbox(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}

export type ProviderSandboxReport = {
  verification: "PASS";
  boundary: "LOOPBACK_HTTP";
  externalProvider: "NOT_RUN";
  delivered: true;
  replayIdempotent: true;
  unknownReconciled: true;
  validCallbackAccepted: true;
  invalidCallbackDenied: true;
  stats: SandboxStats;
};

export async function runProviderSandboxVerification(): Promise<ProviderSandboxReport> {
  const sandbox = await startProviderSandbox();
  try {
    const providerOptions = {
      endpoint: sandbox.endpoint,
      allowedHosts: ["localhost"],
      allowInsecureEndpoint: true,
      credentialRef: "sandbox.token",
      secretResolver: async (reference: string) => reference === "sandbox.token" ? FIXTURE_SECRET : null,
      defaultTimeoutMs: 500
    } as const;
    const provider = new HttpMessagingProvider(providerOptions);
    const timeoutProvider = new HttpMessagingProvider({ ...providerOptions, sendPath: "/messages?mode=timeout" });
    const deliveredRequest = { idempotencyKey: "sandbox-delivered", requestId: "sandbox-send-1", channel: "WHATSAPP" as const, recipient: "+5511999999999", body: "non-production fixture" };
    const delivered = await provider.send(deliveredRequest);
    assert.equal(delivered.status, "DELIVERED");
    assert.equal(delivered.providerRequestId?.startsWith("sandbox-request-"), true);
    const replay = await provider.send(deliveredRequest);
    assert.equal(replay.status, "DELIVERED");
    assert.equal(replay.providerRequestId, delivered.providerRequestId);

    const accepted = await provider.send({ idempotencyKey: "sandbox-accepted", requestId: "sandbox-send-accepted", channel: "EMAIL", recipient: "guardian@example.test", body: "accepted-requires-reconciliation" });
    assert.equal(accepted.status, "OUTCOME_UNKNOWN");
    assert.equal(accepted.providerRequestId?.startsWith("sandbox-request-"), true);
    const acceptedReconciled = await provider.queryStatus({ idempotencyKey: "sandbox-accepted", timeoutMs: 500 });
    assert.equal(acceptedReconciled.status, "SUCCEEDED");
    assert.equal(acceptedReconciled.receipt?.status, "DELIVERED");

    const unknown = await timeoutProvider.send({ idempotencyKey: "sandbox-timeout", requestId: "sandbox-send-timeout", channel: "SMS", recipient: "+5511999999999", body: "accepted-before-response-loss", timeoutMs: 25 });
    assert.equal(unknown.status, "OUTCOME_UNKNOWN");
    if (unknown.providerRequestId !== null) throw new Error(`timeout did not lose response: ${JSON.stringify({ status: unknown.status, providerRequestId: unknown.providerRequestId, stats: sandbox.stats() })}`);
    await delayed(50);
    const reconciled = await timeoutProvider.queryStatus({ idempotencyKey: "sandbox-timeout", timeoutMs: 500 });
    assert.equal(reconciled.status, "SUCCEEDED");
    assert.equal(reconciled.providerRequestId?.startsWith("sandbox-request-"), true);
    assert(reconciled.receipt);
    assert.equal(reconciled.receipt.status, "DELIVERED");

    const callbackPayload = JSON.stringify({ providerRequestId: delivered.providerRequestId, status: "DELIVERED" });
    const callbackSignature = createHmac("sha256", FIXTURE_SECRET).update(callbackPayload).digest("hex");
    const validCallback = await fetch(`${sandbox.endpoint}/callbacks`, { method: "POST", headers: { authorization: `Bearer ${FIXTURE_SECRET}`, "content-type": "application/json", "x-callback-signature": `sha256=${callbackSignature}` }, body: callbackPayload });
    assert.equal(validCallback.status, 202);
    const invalidCallback = await fetch(`${sandbox.endpoint}/callbacks`, { method: "POST", headers: { authorization: `Bearer ${FIXTURE_SECRET}`, "content-type": "application/json", "x-callback-signature": "sha256=invalid" }, body: callbackPayload });
    assert.equal(invalidCallback.status, 401);

    const report: ProviderSandboxReport = { verification: "PASS", boundary: "LOOPBACK_HTTP", externalProvider: "NOT_RUN", delivered: true, replayIdempotent: true, unknownReconciled: true, validCallbackAccepted: true, invalidCallbackDenied: true, stats: sandbox.stats() };
    assert.equal(JSON.stringify(report).includes(FIXTURE_SECRET), false);
    return report;
  } finally {
    await delayed(220);
    await closeProviderSandbox(sandbox.server);
  }
}

const mainPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (mainPath === import.meta.url) {
  runProviderSandboxVerification()
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`PROVIDER_SANDBOX_FAIL ${(error instanceof Error ? error.message : String(error)).replace(/[\r\n]/g, " ")}\n`);
      process.exitCode = 1;
    });
}
