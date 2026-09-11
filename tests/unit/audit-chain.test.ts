import test from "node:test";
import assert from "node:assert/strict";
import { auditRecordHash } from "@cvg/domain";
import { id, type AuditRecord } from "@cvg/contracts";
import { verifyAuditChain } from "../../scripts/verify-audit-chain.ts";

function chain(length = 3): AuditRecord[] {
  const organizationId = id("00000000-0000-4000-8000-000000000001");
  const actorId = id("00000000-0000-4000-8000-000000000002");
  let previousHash: string | null = null;
  return Array.from({ length }, (_, index) => {
    const unsigned = {
      id: id(`00000000-0000-4000-8000-${String(index + 11).padStart(12, "0")}`),
      organizationId,
      actorId,
      unitId: null,
      workspaceId: null,
      action: `audit.fixture.${index}`,
      resourceType: "Verification",
      resourceId: null,
      result: "ALLOWED" as const,
      reason: null,
      correlationId: `audit-chain-${index}`,
      metadata: { source: "unit-test" },
      chainVersion: 2 as const,
      previousHash,
      recordHash: "",
      createdAt: `2026-09-10T00:00:0${index}.000Z`,
    } satisfies AuditRecord;
    const record = { ...unsigned, recordHash: auditRecordHash(unsigned) };
    previousHash = record.recordHash;
    return record;
  });
}

test("audit-chain verification reconstructs a valid chain from database order", () => {
  const records = chain();
  const ordered = verifyAuditChain([records[2]!, records[0]!, records[1]!]);
  const canonical = verifyAuditChain(records);
  assert.equal(ordered.records, 3);
  assert.equal(ordered.organizations, 1);
  assert.equal(ordered.digest, canonical.digest);
});

test("audit-chain verification rejects gaps, branches and multiple heads", () => {
  const records = chain();
  const missing = [records[0]!, records[2]!];
  assert.throws(() => verifyAuditChain(missing), /missing previous hash/);

  const branchedUnsigned = {
    ...records[1]!,
    id: id("00000000-0000-4000-8000-000000000099"),
    action: "audit.fixture.branch",
    recordHash: "",
  };
  const branched = {
    ...branchedUnsigned,
    recordHash: auditRecordHash(branchedUnsigned),
  };
  assert.throws(
    () => verifyAuditChain([records[0]!, records[1]!, branched]),
    /chain branch/,
  );

  const secondHeadUnsigned = {
    ...records[0]!,
    id: id("00000000-0000-4000-8000-000000000098"),
    action: "audit.fixture.head",
    recordHash: "",
  };
  const secondHead = {
    ...secondHeadUnsigned,
    recordHash: auditRecordHash(secondHeadUnsigned),
  };
  assert.throws(
    () => verifyAuditChain([records[0]!, secondHead]),
    /2 audit chain heads/,
  );
});
