import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { containsSecretMaterial, inspectUntrustedContent } from "@cvg/agent-context";

const item = {
  id: "prose-scaling", trust: "USER_SUPPLIED" as const,
  provenance: { source: "synthetic-test", owner: "test", version: null, digest: "a".repeat(64), retrievedAt: null }
};
const family = process.argv[2] ?? "first";
assert.ok(["first", "second", "overlap"].includes(family));

function evaluate(text: string): void {
  assert.equal(containsSecretMaterial(text), false);
  assert.equal(inspectUntrustedContent(text, item).some((finding) => finding.code === "SECRET_MATERIAL"), false);
}

for (let warmup = 0; warmup < 5; warmup += 1) evaluate("password is ordinary.");
const median = (samples: number[]): number => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
const samples = [4_096, 8_192, 16_384, 32_768].map((size) => {
  const text = family === "overlap"
    ? "password is ".repeat(Math.floor(size / 12)) + "ordinary"
    : `password is ${family === "second" ? "plain " : ""}${".".repeat(size)}x`;
  const cpuMs: number[] = [];
  const wallMs: number[] = [];
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const cpuStart = process.cpuUsage();
    const wallStart = performance.now();
    evaluate(text);
    wallMs.push(performance.now() - wallStart);
    const cpu = process.cpuUsage(cpuStart);
    cpuMs.push((cpu.user + cpu.system) / 1_000);
  }
  return { size, characters: text.length, pairedCpuMs: median(cpuMs), pairedWallMs: median(wallMs) };
});
process.stdout.write(JSON.stringify({ family, samples }));
