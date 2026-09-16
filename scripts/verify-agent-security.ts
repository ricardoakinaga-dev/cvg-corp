import { requireTests } from "./lib/node-tests.ts";

/**
 * Adversarial gate for the embedded harness.  The attacks live in a focused
 * node:test suite so each one is independently rejectable.
 */
import { readFileSync } from "node:fs";
const expectedAttacks = 10;
const suite = readFileSync("tests/unit/agent-security.test.ts", "utf8");
if (/assert\.rejects\([\s\S]{0,400}?\)\s*\.catch\(/.test(suite)) {
  process.stderr.write("agent security suite contains a swallowed assertion (.catch after assert.rejects)\n");
  process.exit(1);
}
if ((suite.match(/assert\.(equal|deepEqual|throws|rejects)\(/g) ?? []).length < expectedAttacks) {
  process.stderr.write("agent security suite has fewer assertions than adversarial tests\n");
  process.exit(1);
}
const passed = requireTests(["tests/unit/agent-security.test.ts"], "verify:agent-security");
if (passed < expectedAttacks) {
  process.stderr.write(`expected at least ${expectedAttacks} adversarial tests; observed ${passed}\n`);
  process.exit(1);
}
process.stdout.write(`AGENT_SECURITY_VERIFIED attacks=${passed} scope=injection,plugin,skill,approval,fencing,tenant,secrets,gateway\n`);
