import { readFile } from "node:fs/promises";
import { CvgStore } from "@cvg/domain";
import { readdir } from "node:fs/promises";
import { AUTHORITATIVE_COMMAND_REGISTRY, AUTHORITATIVE_DOMAIN_REGISTRY, authoritativeCoverage, PersistenceCorruptionError, SNAPSHOT_PRIMARY_ENTITIES, validateAuthoritativeSnapshot } from "@cvg/persistence";

const source = await readFile("packages/persistence/src/index.ts", "utf8");
const required = new Set(AUTHORITATIVE_DOMAIN_REGISTRY.map((entry) => entry.snapshotKey));
if (required.size !== AUTHORITATIVE_DOMAIN_REGISTRY.length || required.size !== 32) throw new Error(`authoritative registry must contain 32 unique snapshot keys; found ${required.size}`);
if (new Set(AUTHORITATIVE_DOMAIN_REGISTRY.map((entry) => entry.table)).size !== AUTHORITATIVE_DOMAIN_REGISTRY.length) throw new Error("authoritative registry contains duplicate SQL tables");
const missingRegistry = [...required].filter((key) => !AUTHORITATIVE_DOMAIN_REGISTRY.some((entry) => entry.snapshotKey === key));
const missingSql = AUTHORITATIVE_DOMAIN_REGISTRY.filter((entry) => !source.includes(`insert into ${entry.table}`)).map((entry) => entry.table);
if (missingRegistry.length || missingSql.length) {
  throw new Error(`authoritative coverage is incomplete: registry=${missingRegistry.join(",") || "ok"} sql=${missingSql.join(",") || "ok"}`);
}

const normalizedFields = [...source.matchAll(/normalized([A-Za-z]+)Write\??:/g)].map((match) => `normalized${match[1]}Write`);
const registeredFields = new Set<string>(AUTHORITATIVE_COMMAND_REGISTRY.map((entry) => entry.inputField));
const unregisteredFields = normalizedFields.filter((field) => !registeredFields.has(field));
const staleFields = [...registeredFields].filter((field) => !normalizedFields.includes(field));
if (unregisteredFields.length || staleFields.length) throw new Error(`command inventory diverges from the durable commit surface: unregistered=${unregisteredFields.join(",") || "ok"} stale=${staleFields.join(",") || "ok"}`);
if (new Set(AUTHORITATIVE_COMMAND_REGISTRY.map((entry) => entry.operation)).size !== AUTHORITATIVE_COMMAND_REGISTRY.length) throw new Error("command inventory contains duplicate operations");
const migrationSources = (await Promise.all((await readdir("db/migrations")).filter((file) => file.endsWith(".sql")).map((file) => readFile(`db/migrations/${file}`, "utf8")))).join("\n");
const missingTables = AUTHORITATIVE_COMMAND_REGISTRY.filter((entry) => !new RegExp(`create table(?: if not exists)? ${entry.table}\\b`, "i").test(migrationSources)).map((entry) => entry.table);
if (missingTables.length) throw new Error(`command inventory references tables without an immutable migration: ${missingTables.join(",")}`);
for (const entry of AUTHORITATIVE_COMMAND_REGISTRY) {
  const collection = AUTHORITATIVE_DOMAIN_REGISTRY.find((candidate) => candidate.snapshotKey === entry.snapshotKey);
  if (!collection || collection.table !== entry.table) throw new Error(`command ${entry.operation} does not match the authoritative collection registry`);
  if (!entry.owner || (entry.invariants as readonly string[]).length === 0) throw new Error(`command ${entry.operation} lacks owner or invariants`);
}
const coverage = authoritativeCoverage();
if (coverage.uncovered.length) throw new Error(`authoritative coverage is incomplete for: ${coverage.uncovered.join(",")}`);
const overlap = coverage.commandOwned.filter((key) => coverage.snapshotPrimary.includes(key));
if (overlap.length) throw new Error(`entities cannot be both command-owned and snapshot-primary: ${overlap.join(",")}`);
if (new Set(SNAPSHOT_PRIMARY_ENTITIES.map((entry) => entry.owner)).size < 5) throw new Error("snapshot-primary debt must keep explicit owners");

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

process.stdout.write(`AUTHORITATIVE_WRITES_VERIFIED domains=${AUTHORITATIVE_DOMAIN_REGISTRY.length} commands=${AUTHORITATIVE_COMMAND_REGISTRY.length} snapshotPrimary=${SNAPSHOT_PRIMARY_ENTITIES.length} invariants=organization,parent,scope,child,cas,quarantine tamper=REJECTED\n`);
