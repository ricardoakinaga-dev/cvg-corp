import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindCriticVerdict, buildSealedPacket, packetDigestOf, runTamperRehearsal, verifySealedPacket } from "../../scripts/sealed-critic-packet.ts";

test("sealed critic packet is digest-bound and detects mutation", () => {
  const root = process.cwd();
  const output = mkdtempSync(join(tmpdir(), "cvg-sealed-packet-"));
  try {
    const packet = buildSealedPacket(root, output, ["package.json", "LICENSE"]);
    assert.equal(packet.kind, "cvg-sealed-critic-packet");
    assert.equal(packet.evidence.length, 2);
    assert.equal(readFileSync(join(output, "packet.digest"), "utf8").trim(), packetDigestOf(packet));
    assert.deepEqual(verifySealedPacket(root, output), []);
    const rehearsal = runTamperRehearsal(root, output);
    assert.equal(rehearsal.detected, true, rehearsal.detail);
    const verdictPath = join(output, "verdict.json");
    writeFileSync(verdictPath, `${JSON.stringify({ reviewer: "synthetic-reviewer", independenceLevel: "I2", verdict: "PASS", packetDigest: packetDigestOf(packet), findings: [] })}\n`);
    assert.deepEqual(bindCriticVerdict(output, verdictPath), []);
    writeFileSync(verdictPath, `${JSON.stringify({ reviewer: "synthetic-reviewer", independenceLevel: "I2", verdict: "PASS", packetDigest: "sha256:" + "0".repeat(64), findings: [] })}\n`);
    assert.ok(bindCriticVerdict(output, verdictPath).some((error) => error.includes("not bound")));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("sealed packet emission rejects outputs inside the checkout and invalid evidence", () => {
  const root = process.cwd();
  assert.throws(() => buildSealedPacket(root, join(root, "artifacts", "sealed"), ["package.json"]), /outside the candidate checkout/);
  const output = mkdtempSync(join(tmpdir(), "cvg-sealed-invalid-"));
  try {
    assert.throws(() => buildSealedPacket(root, output, []), /at least one evidence path/);
    assert.throws(() => buildSealedPacket(root, output, ["does-not-exist.json"]), /not a regular file/);
    assert.throws(() => buildSealedPacket(root, output, ["docs"]), /not a regular file/);
    assert.throws(() => buildSealedPacket(root, output, ["../outside.json"]), /not a regular file/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("sealed packet verification names each broken invariant", () => {
  const root = process.cwd();
  const empty = mkdtempSync(join(tmpdir(), "cvg-sealed-empty-"));
  const output = mkdtempSync(join(tmpdir(), "cvg-sealed-verify-"));
  try {
    assert.deepEqual(verifySealedPacket(root, empty), ["sealed packet is missing packet.json or packet.digest"]);
    buildSealedPacket(root, output, ["package.json"]);
    // invalid JSON
    const packetBytes = readFileSync(join(output, "packet.json"), "utf8");
    writeFileSync(join(output, "packet.json"), "{not json");
    assert.ok(verifySealedPacket(root, output)[0]!.includes("JSON is invalid"));
    // wrong kind + digest mismatch
    const mutated = JSON.parse(packetBytes) as Record<string, unknown>;
    mutated.kind = "unexpected-kind";
    writeFileSync(join(output, "packet.json"), JSON.stringify(mutated));
    const kindErrors = verifySealedPacket(root, output);
    assert.ok(kindErrors.some((error) => error.includes("kind or schema version")));
    assert.ok(kindErrors.some((error) => error.includes("digest does not match")));
    // restore packet, remove the evidence copy
    writeFileSync(join(output, "packet.json"), packetBytes);
    rmSync(join(output, "evidence", "package.json"));
    assert.ok(verifySealedPacket(root, output).some((error) => error.includes("copy is missing")));
    // rehearsal refuses to run on an unclean packet
    const rehearsal = runTamperRehearsal(root, output);
    assert.equal(rehearsal.detected, false);
    assert.ok(rehearsal.detail.includes("not clean"));
  } finally {
    rmSync(empty, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});

test("critic verdict binding rejects each malformed field before accepting", () => {
  const root = process.cwd();
  const missingDigestDir = mkdtempSync(join(tmpdir(), "cvg-sealed-nodigest-"));
  const output = mkdtempSync(join(tmpdir(), "cvg-sealed-bind-"));
  try {
    assert.deepEqual(bindCriticVerdict(missingDigestDir, join(missingDigestDir, "verdict.json")), ["sealed packet digest is missing"]);
    const packet = buildSealedPacket(root, output, ["package.json"]);
    const verdictPath = join(output, "verdict.json");
    writeFileSync(verdictPath, "{not json");
    assert.ok(bindCriticVerdict(output, verdictPath)[0]!.includes("JSON is invalid"));
    writeFileSync(verdictPath, JSON.stringify({ reviewer: " ", independenceLevel: "I9", verdict: "MAYBE", packetDigest: packetDigestOf(packet), findings: "none" }));
    const errors = bindCriticVerdict(output, verdictPath);
    assert.ok(errors.some((error) => error.includes("reviewer identity")));
    assert.ok(errors.some((error) => error.includes("I0-I3")));
    assert.ok(errors.some((error) => error.includes("PASS or FAIL")));
    assert.ok(errors.some((error) => error.includes("findings must be an array")));
  } finally {
    rmSync(missingDigestDir, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
});
