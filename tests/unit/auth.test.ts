import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { digestRecoveryCode, generateRecoveryCodes, isPasswordCompliant, passwordPolicyIssues, verifyTotpCode } from "@cvg/auth";

function totpCode(secret: string, atMs: number): string {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    buffer = (buffer << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

test("TOTP accepts the current time step and rejects malformed or stale codes", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const atMs = 0;
  assert.equal(totpCode(secret, atMs), "282760");
  assert.equal(verifyTotpCode(secret, "282760", atMs), true);
  assert.equal(verifyTotpCode(secret, "000000", atMs), false);
  assert.equal(verifyTotpCode("not-a-secret", "282760", atMs), false);
});

test("password policy is explicit and recovery codes are one-way values", () => {
  const weak = passwordPolicyIssues("short", undefined, { identifier: "admin@example.test" });
  assert.ok(weak.length >= 4);
  assert.equal(isPasswordCompliant("Strong-Password-123!", undefined, { identifier: "admin@example.test" }), true);
  assert.equal(isPasswordCompliant("Admin@example.test-123!", undefined, { identifier: "admin@example.test" }), false);
  const codes = generateRecoveryCodes(8);
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  assert.ok(codes.every((code) => /^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}$/.test(code)));
  assert.notEqual(digestRecoveryCode(codes[0]!), codes[0]);
  assert.equal(digestRecoveryCode(codes[0]!), digestRecoveryCode(codes[0]!.toLowerCase()));
});
