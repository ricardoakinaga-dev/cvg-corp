import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { containsSecretMaterial, inspectUntrustedContent } from "@cvg/agent-context";

const metadata = {
  id: "review-probe", trust: "USER_SUPPLIED" as const,
  provenance: { source: "synthetic-fixture", owner: "test", version: null, digest: "a".repeat(64), retrievedAt: null }
};
const marker = "synthetic-review-Q7n9!";

function assertSignal(content: string, expected: boolean): void {
  assert.equal(containsSecretMaterial(content), expected, "admission decision");
  const findings = inspectUntrustedContent(content, metadata);
  assert.equal(findings.some((finding) => finding.code === "SECRET_MATERIAL"), expected, "context decision");
  assert.equal(JSON.stringify(findings).includes(marker), false, "findings must not repeat the credential");
}

for (const description of [
  "Use a senha temporária para entrar.",
  "Minha senha é alfanumérica.",
  "My password is missing.",
  "Please use password protection for this file.",
  "Use a senha informada no formulário.",
  "Minha senha é temporária: como alterar?",
  "My password is missing: how can I reset it?",
  "Use a senha definida no cadastro."
]) {
  test(`ordinary password prose is preserved: ${description}`, () => {
    assertSignal(description, false);
    assertSignal(description.toUpperCase(), false);
    assertSignal(`${description} Minha senha é ${marker}`, true);
    assertSignal(`password is ${marker}. ${description}`, true);
    assertSignal(`${description}\nsegredo: ${marker}`, true);
    assertSignal(description, false);
  });
}

test("description exceptions apply only to unquoted prose candidates", () => {
  for (const word of ["temporária", "alfanumérica", "missing", "protection", "informada"]) {
    assertSignal(`password=${word}`, true);
    assertSignal(`my password is "${word}"`, true);
    assertSignal(`use a senha '${word}`, true);
  }
});

test("descriptive punctuation preserves mixed-clause credential detection", () => {
  for (const word of ["temporária", "alfanumérica", "missing", "protection", "informada", "definida"]) {
    for (const punctuation of [":", ":?!", "...", "?!"]) {
      const description = `My password is ${word}${punctuation} How can I reset it?`;
      assertSignal(description, false);
      assertSignal(`${description} password is ${marker}`, true);
      assertSignal(`senha é ${marker}. ${description}`, true);
      assertSignal(`password is "${word}${punctuation}"`, true);
      assertSignal(`password=${word}${punctuation}`, true);
    }
  }
});

test("URL recognition preserves custom schemes and credentials after near-misses", () => {
  for (const scheme of ["https", "postgresql", "git+ssh", "custom.v1", "a-".repeat(16_384) + "z"]) {
    assertSignal(`${scheme}://user:${marker}@localhost/path`, true);
  }
  for (const content of [
    "://user:synthetic-value@localhost",
    "scheme ://user:synthetic-value@localhost",
    "https://host/path@value",
    "https://user@host/path",
    "https://host:443/path",
    "https://host:443?query=value"
  ]) assertSignal(content, false);
  assertSignal(`${"a-".repeat(16_384)} https://user:${marker}@localhost`, true);
  assertSignal(`${"a://user:nothing ".repeat(2_000)} https://user:${marker}@localhost`, true);
  assertSignal(`://user:synthetic-value@host https://user:${marker}@host`, true);
});

test("scheme-like near-misses have bounded CPU use and scaling", (t) => {
  // A subprocess timeout also contains a synchronous-regex regression. CPU
  // medians avoid charging scheduler delays from concurrent repository tests.
  const output = execFileSync(process.execPath, [
    "--import", "tsx", fileURLToPath(new URL("../fixtures/secret-detector-scaling.ts", import.meta.url))
  ], { encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1_024 });
  const samples = JSON.parse(output) as { characters: number; pairedCpuMs: number; pairedWallMs: number }[];
  assert.deepEqual(samples.map((sample) => sample.characters), [4_096, 8_192, 16_384, 32_768]);
  t.diagnostic(output);
  const small = samples[1]!;
  const large = samples[3]!;
  assert.ok(large.pairedCpuMs < 250, "both 32 KiB scans must fit the generous CPU guardrail");
  assert.ok(large.pairedCpuMs <= Math.max(100, small.pairedCpuMs * 8), "4x input must not reproduce quadratic growth");
});
