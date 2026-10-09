import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { containsSecretMaterial, inspectUntrustedContent } from "@cvg/agent-context";

const metadata = {
  id: "scaling-probe", trust: "USER_SUPPLIED" as const,
  provenance: { source: "synthetic-fixture", owner: "test", version: null, digest: "a".repeat(64), retrievedAt: null }
};

function evaluate(content: string): void {
  assert.equal(containsSecretMaterial(content), false);
  assert.equal(inspectUntrustedContent(content, metadata).some((finding) => finding.code === "SECRET_MATERIAL"), false);
}

for (let index = 0; index < 5; index += 1) evaluate("ordinary input a-a-a-");
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const samples = [4_096, 8_192, 16_384, 32_768].map((characters) => {
  const text = "a-".repeat(characters / 2);
  const cpuMs: number[] = [];
  const wallMs: number[] = [];
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const cpuStart = process.cpuUsage();
    const wallStart = performance.now();
    evaluate(text);
    wallMs.push(performance.now() - wallStart);
    const used = process.cpuUsage(cpuStart);
    cpuMs.push((used.user + used.system) / 1_000);
  }
  return { characters, pairedCpuMs: median(cpuMs), pairedWallMs: median(wallMs) };
});
process.stdout.write(JSON.stringify(samples));
