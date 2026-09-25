import { readdirSync } from "node:fs";
import { CVG_LATEST_MIGRATION, CVG_REQUIRED_MIGRATION_MARKERS } from "@cvg/persistence";

/**
 * CVG-AUD20-004: the readiness contract must come from a canonical source.
 * This verifier fails when db/migrations has a newer file than the constant
 * assertSchema requires (a database could otherwise be ready without it), or
 * when a required marker is missing from the directory.
 */
const versions = readdirSync("db/migrations").filter((file) => file.endsWith(".sql")).map((file) => file.replace(/\.sql$/, "")).sort();
const failures: string[] = [];
const latest = versions.at(-1);
if (latest !== CVG_LATEST_MIGRATION) failures.push(`db/migrations latest is ${latest} but CVG_LATEST_MIGRATION is ${CVG_LATEST_MIGRATION}`);
for (const marker of CVG_REQUIRED_MIGRATION_MARKERS) {
  if (!versions.includes(marker)) failures.push(`required migration marker ${marker} is missing from db/migrations`);
}
if (failures.length > 0) {
  process.stderr.write(`SCHEMA_MANIFEST_INVALID ${JSON.stringify(failures)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`SCHEMA_MANIFEST_VERIFIED latest=${latest} markers=${CVG_REQUIRED_MIGRATION_MARKERS.length}\n`);
}
