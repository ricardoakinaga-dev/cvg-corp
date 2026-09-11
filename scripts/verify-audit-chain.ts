import { readFile } from "node:fs/promises";
import { auditRecordHash, verifyAuditChain } from "@cvg/domain";
import type { AuditRecord } from "@cvg/contracts";

// Keep the executable gate's historical module surface stable while the pure
// verifier is shared by the recovery boundary in @cvg/domain.
export { verifyAuditChain };

function fixture(): AuditRecord[] {
  const organizationId =
    "00000000-0000-4000-8000-000000000001" as AuditRecord["organizationId"];
  const actorId =
    "00000000-0000-4000-8000-000000000002" as AuditRecord["actorId"];
  const make = (
    id: string,
    action: string,
    previousHash: string | null,
  ): AuditRecord => {
    const unsigned = {
      id: id as AuditRecord["id"],
      organizationId,
      actorId,
      unitId: null,
      workspaceId: null,
      action,
      resourceType: "Verification",
      resourceId: null,
      result: "ALLOWED" as const,
      reason: null,
      correlationId: `audit-chain-${id}`,
      metadata: { source: "local-fixture" },
      chainVersion: 2 as const,
      previousHash,
      recordHash: "",
      createdAt: "2026-09-10T00:00:00.000Z",
    } satisfies AuditRecord;
    return { ...unsigned, recordHash: auditRecordHash(unsigned) };
  };
  const first = make(
    "00000000-0000-4000-8000-000000000011",
    "audit.chain.fixture.created",
    null,
  );
  return [
    first,
    make(
      "00000000-0000-4000-8000-000000000012",
      "audit.chain.fixture.verified",
      first.recordHash,
    ),
  ];
}

async function loadRecords(): Promise<AuditRecord[]> {
  const file = process.argv[2];
  if (!file) return fixture();
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed))
    throw new Error("audit chain input must be an array");
  return parsed as AuditRecord[];
}

async function main(): Promise<void> {
  try {
    const records = await loadRecords();
    const verification = verifyAuditChain(records);
    // A mutation must be rejected as part of the executable gate, even when the
    // default fixture is used. This guards the verifier itself against a false
    // positive implementation.
    if (!process.argv[2]) {
      const tampered = structuredClone(records);
      const first = tampered[0];
      if (!first) throw new Error("audit chain fixture is empty");
      first.metadata = { ...first.metadata, tampered: true };
      try {
        verifyAuditChain(tampered);
        throw new Error("tampered audit chain was accepted");
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "tampered audit chain was accepted"
        )
          throw error;
      }
      process.stdout.write(
        `AUDIT_CHAIN_VERIFIED records=${verification.records} organizations=${verification.organizations} fixtureDigest=${verification.digest} tamper=REJECTED\n`,
      );
    } else {
      process.stdout.write(
        `AUDIT_CHAIN_VERIFIED records=${verification.records} organizations=${verification.organizations} digest=${verification.digest}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `AUDIT_CHAIN_FAILED ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

const invokedDirectly = Boolean(
  process.argv[1]?.endsWith("/verify-audit-chain.ts") ||
  process.argv[1]?.endsWith("/verify-audit-chain.js"),
);
if (invokedDirectly) await main();
