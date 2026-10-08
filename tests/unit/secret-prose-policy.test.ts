import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { containsSecretMaterial, inspectUntrustedContent } from "@cvg/agent-context";
import { passwordPolicyPrompts } from "../fixtures/secret-material.ts";

const item = {
  id: "prose-policy", trust: "USER_SUPPLIED" as const,
  provenance: { source: "synthetic-test", owner: "test", version: null, digest: "a".repeat(64), retrievedAt: null }
};
const synthetic = "SyntheTic72!";

function check(content: string, expected: boolean): void {
  assert.equal(containsSecretMaterial(content), expected, content);
  const findings = inspectUntrustedContent(content, item);
  assert.equal(findings.some((finding) => finding.code === "SECRET_MATERIAL"), expected, content);
  assert.equal(JSON.stringify(findings).includes(synthetic), false);
}

for (const prompt of passwordPolicyPrompts) {
  test(`password policy is not a credential: ${prompt}`, () => {
    for (const variant of [prompt, prompt.toUpperCase(), prompt.replaceAll(" ", "\t")]) {
      check(variant, false);
      check(`${variant}. Minha senha é ${synthetic}`, true);
      check(`password is ${synthetic}; ${variant}`, true);
      check(`${variant}\nAWS_SECRET_ACCESS_KEY=${synthetic}`, true);
      check(variant, false);
    }
  });
}

test("prose values support possessives, optional colons, spaces and internal mixed case", () => {
  for (const prompt of [
    "a senha dele é Zx9kLm2p", "a senha dela é Zx9kLm2p", "as senhas são irrelevantes; senha deles é Zx9kLm2p",
    "senha delas eh Zx9kLm2p", "my password is: Hunter2!x", "my password is : Hunter2!x",
    "senha é abc 12345", "use a senha abc 12345 para entrar", "password is abc 12345",
    "password is huNterOnly", "senha é alpha_beta", "senha é 123456", "password is alpha@beta",
    'a senha dele é "somente palavras"', 'password is: "important"', "use the password: alpha_beta"
  ]) check(prompt, true);
});

test("unquoted prose is based on value shape rather than a growing vocabulary", () => {
  for (const word of ["importante", "stored", "rotated", "expired", "gerenciada", "configurada", "documentada", "automaticamente", "Important", "Wellmanaged", "STORED", "alfanumérica", "well-protected"]) {
    for (const suffix of ["", ".", "?!", ": como alterar?"]) {
      check(`password is ${word}${suffix}`, false);
    }
    check(`password="${word}"`, true);
    check(`senha é "${word}"`, true);
    check(`use a senha '${word}`, true);
    check(`password=${word}`, true);
  }
  check("password is rotated every 30 days", false);
  check("a senha é gerenciada pelo cofre 24 horas", false);
  check("password island is a name", false);
});

test("an ignored candidate cannot consume the start of another credential clause", () => {
  for (const prompt of [
    `password is stored password is ${synthetic}`,
    `senha é importante senha dele é ${synthetic}`,
    `password is expired; password is: ${synthetic}`,
    `password is stored\nsenha é abc 12345`,
    `password is important. ${"a-".repeat(32_768)} password is ${synthetic}`
  ]) check(prompt, true);
});

test("heuristic limits for unquoted plain words and short values stay explicit", () => {
  // Reducing prose false positives deliberately leaves these ambiguous forms
  // undetected. Quoting/assignment still covers plain words of six characters.
  for (const value of ["hunter", "banana", "Hunter", "hunter wolf", "Ab12!"]) check(`password is ${value}`, false);
  check('password is "hunter wolf"', true);
  check("password=hunter", true);
});

for (const prefix of [
  "password is password is", "password is senha é", "password is: senha dele é",
  "use password use password", "utilize a senha utilize a senha"
]) {
  test(`overlapping prose keeps the later introducer searchable: ${prefix}`, () => {
    for (const variant of [prefix, prefix.toUpperCase(), prefix.replaceAll(" ", "\t")]) {
      check(`${variant} ${synthetic}`, true);
      check(`${variant} ordinary`, false);
      check(`${variant} ordinary; password is ${synthetic}`, true);
      check(`${variant} "ordinary"`, true);
    }
  });
}

test("long punctuation preserves values and later clauses without truncation", () => {
  for (const punctuation of [".", "!", "?", ":"]) {
    const suffix = punctuation.repeat(32_768);
    check(`password is ${synthetic}${suffix}`, true);
    check(`password is ordinary${suffix}`, false);
    check(`password is ${suffix}`, false);
    check(`password is ${".".repeat(32_768)}x; password is ${synthetic}`, true);
  }
  check(`${"password is ".repeat(2_048)}${synthetic}`, true);
  check(`${"utilize a senha ".repeat(2_048)}${synthetic}`, true);
});

for (const family of ["first", "second", "overlap"]) {
  test(`prose scanner has bounded CPU use for ${family} candidate near-misses`, (t) => {
    // Native test timeouts cannot interrupt synchronous regex work. The child
    // timeout bounds regressions; CPU medians exclude most scheduler delays.
    const output = execFileSync(process.execPath, [
      "--import", "tsx", fileURLToPath(new URL("../fixtures/secret-prose-scaling.ts", import.meta.url)), family
    ], { encoding: "utf8", timeout: 20_000, maxBuffer: 64 * 1_024 });
    const result = JSON.parse(output) as { family: string; samples: { size: number; characters: number; pairedCpuMs: number }[] };
    assert.equal(result.family, family);
    assert.deepEqual(result.samples.map((sample) => sample.size), [4_096, 8_192, 16_384, 32_768]);
    t.diagnostic(output);
    const small = result.samples[1]!;
    const large = result.samples[3]!;
    assert.ok(large.pairedCpuMs < 250, "paired scans must fit the generous CPU guardrail");
    assert.ok(large.pairedCpuMs <= Math.max(100, small.pairedCpuMs * 8), "4x input must not reproduce quadratic growth");
  });
}
