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
