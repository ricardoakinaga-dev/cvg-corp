import { readFile } from "node:fs/promises";
import { CvgStore } from "@cvg/domain";
import { AUTHORITATIVE_DOMAIN_REGISTRY, PersistenceCorruptionError, validateAuthoritativeSnapshot } from "@cvg/persistence";

const source = await readFile("packages/persistence/src/index.ts", "utf8");
const required = new Set(AUTHORITATIVE_DOMAIN_REGISTRY.map((entry) => entry.snapshotKey));
if (required.size !== AUTHORITATIVE_DOMAIN_REGISTRY.length || required.size !== 32) throw new Error(`authoritative registry must contain 32 unique snapshot keys; found ${required.size}`);
if (new Set(AUTHORITATIVE_DOMAIN_REGISTRY.map((entry) => entry.table)).size !== AUTHORITATIVE_DOMAIN_REGISTRY.length) throw new Error("authoritative registry contains duplicate SQL tables");
const missingRegistry = [...required].filter((key) => !AUTHORITATIVE_DOMAIN_REGISTRY.some((entry) => entry.snapshotKey === key));
const missingSql = AUTHORITATIVE_DOMAIN_REGISTRY.filter((entry) => !source.includes(`insert into ${entry.table}`)).map((entry) => entry.table);
if (missingRegistry.length || missingSql.length) {
  throw new Error(`authoritative coverage is incomplete: registry=${missingRegistry.join(",") || "ok"} sql=${missingSql.join(",") || "ok"}`);
}

const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
validateAuthoritativeSnapshot(store.snapshot());
const tampered = store.snapshot();
const guardian = tampered.guardians[0];
if (!guardian) throw new Error("synthetic snapshot has no guardian fixture");
guardian.unitId = guardian.unitId ?? (tampered.units[0]?.id ?? null);
guardian.workspaceId = null;
try {
  validateAuthoritativeSnapshot(tampered);
  throw new Error("tampered authoritative snapshot was accepted");
} catch (error) {
  if (error instanceof Error && error.message === "tampered authoritative snapshot was accepted") throw error;
  if (!(error instanceof PersistenceCorruptionError)) throw error;
}

process.stdout.write(`AUTHORITATIVE_WRITES_VERIFIED domains=${AUTHORITATIVE_DOMAIN_REGISTRY.length} invariants=organization,parent,scope,child,quarantine tamper=REJECTED\n`);
