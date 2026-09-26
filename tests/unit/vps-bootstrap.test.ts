import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingEnvKeys, parseEnvFile, PRODUCTION_REQUIRED_KEYS, runVpsChecks, type VpsCheck } from "../../scripts/vps-bootstrap.ts";

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

function checkById(checks: VpsCheck[], id: string): VpsCheck {
  const check = checks.find((candidate) => candidate.id === id);
  assert.ok(check, `check ${id} must be reported`);
  return check;
}

function envFileWith(directory: string, overrides: Record<string, string>): string {
  const values: Record<string, string> = {};
  for (const key of PRODUCTION_REQUIRED_KEYS) values[key] = `synthetic-${key.toLowerCase()}`;
  Object.assign(values, overrides);
  const envPath = join(directory, "vps.env");
  writeFileSync(envPath, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"));
  return envPath;
}

test("vps checks fail closed with a remedy when the external env file is absent", () => {
  const checks = runVpsChecks(join(tmpdir(), "cvg-vps-missing", "does-not-exist.env"));
  assert.equal(checks.length, 1);
  assert.equal(checks[0]!.id, "env-file");
  assert.equal(checks[0]!.status, "FAIL");
  assert.ok(checks[0]!.remedy);
});

test("vps checks validate TLS material, release identity and report every runtime dependency", () => {
  const workDirectory = mkdtempSync(join(tmpdir(), "cvg-vps-check-"));
  try {
    const tlsDir = join(workDirectory, "tls");
    mkdirSync(tlsDir, { recursive: true });
    writeFileSync(join(tlsDir, "fullchain.pem"), "synthetic-certificate");
    writeFileSync(join(tlsDir, "privkey.pem"), "synthetic-key");
    const envPath = envFileWith(workDirectory, {
      CVG_TLS_DIR: tlsDir,
      CVG_RELEASE_SHA: "a".repeat(40),
      CVG_RELEASE_ARTIFACT_DIGEST: `sha256:${"b".repeat(64)}`
    });
    const checks = runVpsChecks(envPath);
    assert.equal(checkById(checks, "env-keys").status, "PASS");
    assert.equal(checkById(checks, "tls-material").status, "PASS");
    assert.equal(checkById(checks, "release-sha").status, "PASS");
    assert.equal(checkById(checks, "release-digest").status, "PASS");
    // Docker/compose/buildx availability depends on the host; the check must
    // exist either way and never throw.
    for (const id of ["docker", "compose", "buildx"]) assert.ok(["PASS", "FAIL"].includes(checkById(checks, id).status));
    for (const secret of ["cvg-deepseek-bearer", "cvg-deepseek-context", "cvg-recovery-key", "cvg-messaging-credential"]) {
      assert.ok(["PASS", "WARN"].includes(checkById(checks, `docker-secret:${secret}`).status));
    }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
});

test("vps checks reject a relative TLS dir and malformed release identity", () => {
  const workDirectory = mkdtempSync(join(tmpdir(), "cvg-vps-reject-"));
  try {
    const envPath = envFileWith(workDirectory, {
      CVG_TLS_DIR: "relative/tls",
      CVG_RELEASE_SHA: "not-a-sha",
      CVG_RELEASE_ARTIFACT_DIGEST: "latest"
    });
    const checks = runVpsChecks(envPath);
    assert.equal(checkById(checks, "tls-material").status, "FAIL");
    assert.equal(checkById(checks, "release-sha").status, "FAIL");
    assert.equal(checkById(checks, "release-digest").status, "FAIL");
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
});

test("vps checks fail TLS material when the certificate files are missing under an absolute dir", () => {
  const workDirectory = mkdtempSync(join(tmpdir(), "cvg-vps-tls-"));
  try {
    const envPath = envFileWith(workDirectory, { CVG_TLS_DIR: join(workDirectory, "empty-tls") });
    const checks = runVpsChecks(envPath);
    assert.equal(checkById(checks, "tls-material").status, "FAIL");
    assert.ok(checkById(checks, "tls-material").detail.includes("fullchain.pem"));
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
});
