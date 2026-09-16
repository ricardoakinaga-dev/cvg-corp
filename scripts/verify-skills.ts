import { readFileSync } from "node:fs";
import { SKILL_SCHEMA_VERSION } from "@cvg/agent-skills";
import { requireTests } from "./lib/node-tests.ts";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("packages/agent-skills/src/index.ts", root), "utf8");
const failures: string[] = [];

if (SKILL_SCHEMA_VERSION !== "cvg-agent-skill/1") failures.push(`unexpected skill schema version: ${SKILL_SCHEMA_VERSION}`);
for (const marker of ["skillDigest", "SKILL_DIGEST_MISMATCH", "SKILL_SCHEMA_UNSUPPORTED", "requiredTools", "requiredCapabilities", "approvalStatus", "QUARANTINED", "parseSkillMarkdown"]) {
  if (!source.includes(marker)) failures.push(`skill runtime is missing ${marker}`);
}
if (!/never grants authority/i.test(source)) failures.push("skill runtime must document that skills never grant authority");

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

const passed = requireTests(["tests/unit/agent-skills.test.ts"], "verify:skills");
process.stdout.write(`SKILL_GATE_VERIFIED schema=${SKILL_SCHEMA_VERSION} focusedTests=${passed}\n`);
