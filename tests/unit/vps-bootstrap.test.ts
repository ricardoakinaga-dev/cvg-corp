import test from "node:test";
import assert from "node:assert/strict";
import { missingEnvKeys, parseEnvFile, PRODUCTION_REQUIRED_KEYS } from "../../scripts/vps-bootstrap.ts";

test("vps env parser ignores comments and preserves values", () => {
  const values = parseEnvFile("# comment\nDATABASE_URL=postgresql://user:pass@host/db\n\nCVG_RELEASE_SHA=abc123\nSPACED = value with spaces \n");
  assert.equal(values.DATABASE_URL, "postgresql://user:pass@host/db");
  assert.equal(values.CVG_RELEASE_SHA, "abc123");
  assert.equal(values.SPACED, "value with spaces");
});

test("vps required-key validation reports every missing or empty production input", () => {
  const values = parseEnvFile("CVG_RELEASE_SHA=\nDATABASE_URL=postgresql://x\n");
  const missing = missingEnvKeys(values);
  assert.ok(missing.includes("CVG_RELEASE_SHA"));
  assert.ok(missing.includes("POSTGRES_PASSWORD"));
  assert.ok(!missing.includes("DATABASE_URL"));
  assert.equal(missing.length, PRODUCTION_REQUIRED_KEYS.length - 1);
});
