import test from "node:test";
import assert from "node:assert/strict";
import { IntegrationInboxApplicationService } from "../../apps/api/src/application/integration-service.ts";
import type { DurableInboxInput, DurableInboxReceipt, DurableOutboxInput } from "@cvg/persistence";

function inboxInput(overrides: Partial<DurableInboxInput> = {}): DurableInboxInput {
  return {
    id: "inbox-1" as DurableInboxInput["id"],
    organizationId: "org-1" as DurableInboxInput["organizationId"],
    consumer: "cvg-api",
    provider: "messaging.synthetic",
    externalEventId: "evt-1",
    eventType: "message.delivered",
    schemaVersion: 1,
    signatureAlgorithm: "HMAC-SHA256",
    signatureKeyRef: "kref-synthetic-1",
    signature: "a".repeat(64),
    rawBody: '{"synthetic":true}',
    payload: { synthetic: true },
    ...overrides
  };
}

test("integration inbox service admits the callback through the policy before the repository", async () => {
  const seen: Array<{ input: DurableInboxInput; outbox: DurableOutboxInput[] }> = [];
  const receipt = { status: "PROCESSED" } as unknown as DurableInboxReceipt;
  const service = new IntegrationInboxApplicationService({
    processInboxEvent: async (input, outboxRecords) => {
      seen.push({ input, outbox: outboxRecords ?? [] });
      return receipt;
    }
  });
  const result = await service.receive(inboxInput());
  assert.equal(result, receipt);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.input.provider, "messaging.synthetic");
  assert.deepEqual(seen[0]!.outbox, []);
});

test("integration inbox service fails closed before the repository on a rejected signature envelope", async () => {
  let repositoryCalls = 0;
  const service = new IntegrationInboxApplicationService({
    processInboxEvent: async () => {
      repositoryCalls += 1;
      return { status: "PROCESSED" } as unknown as DurableInboxReceipt;
    }
  });
  await assert.rejects(() => service.receive(inboxInput({ signature: "not-hex" })), /assinatura do callback é inválida/);
  await assert.rejects(() => service.receive(inboxInput({ signatureAlgorithm: "MD5" as DurableInboxInput["signatureAlgorithm"] })), /algoritmo de assinatura/);
  await assert.rejects(() => service.receive(inboxInput({ provider: "UPPER not allowed" })), /provider do callback/);
  await assert.rejects(() => service.receive(inboxInput({ rawBody: "" })), /corpo bruto assinado/);
  assert.equal(repositoryCalls, 0);
});
