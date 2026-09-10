import { performance } from "node:perf_hooks";
import { CvgStore } from "@cvg/domain";
import { GovernedHarness } from "@cvg/harness";

const warmup = 3;
const repetitions = 30;
const store = new CvgStore({ bootstrapPassword: "benchmark-synthetic-password-123" });
const option = store.contextOptions(store.bootstrapCredentials.userId)[0];
if (!option) throw new Error("benchmark fixture has no context");
const benchmarkSession = store.createSession(store.bootstrapCredentials.userId, "benchmark-local-session", "benchmark-local-csrf", 60);
const context = store.resolveContext(store.bootstrapCredentials.userId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "OPERATIONS", "benchmark-local", null, null, benchmarkSession.id);
const harness = new GovernedHarness(store);

type Measurement = { operation: string; repetitions: number; samplesMs: number[]; metricsMs: { min: number; p50: number; p95: number; p99: number; max: number } };

function percentile(samples: number[], percentileValue: number): number {
  const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * percentileValue) - 1));
  return samples[index] ?? 0;
}

async function measure(operation: string, callback: () => void | Promise<void>): Promise<Measurement> {
  for (let index = 0; index < warmup; index += 1) await callback();
  const samples: number[] = [];
  for (let index = 0; index < repetitions; index += 1) {
    const started = performance.now();
    await callback();
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  return {
    operation,
    repetitions,
    samplesMs: samples.map((sample) => Number(sample.toFixed(4))),
    metricsMs: {
      min: Number((samples[0] ?? 0).toFixed(4)),
      p50: Number(percentile(samples, 0.50).toFixed(4)),
      p95: Number(percentile(samples, 0.95).toFixed(4)),
      p99: Number(percentile(samples, 0.99).toFixed(4)),
      max: Number((samples.at(-1) ?? 0).toFixed(4))
    }
  };
}

const measurements: Measurement[] = await Promise.all([
  measure("patient_lookup", () => { store.listPatients(context); }),
  measure("appointment_list", () => { store.listAppointments(context); }),
  measure("ai_turn_local_stub", async () => {
    const session = harness.createSession(context, { purpose: "OPERATIONS", patientId: null, encounterId: null });
    await harness.executeTurn(context, { sessionId: session.id, prompt: "organizar a fila sintética", purpose: "OPERATIONS", patientId: null, encounterId: null, requestedTool: null, approvalId: null, idempotencyKey: `benchmark-${session.id}` });
  })
]);

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, synthetic: true, provider: "local-stub", dataset: "CvgStore bootstrap fixture", warmup, repetitions },
  measurements,
  notRun: ["login", "postgres_commit", "rls_overhead", "outbox_processing", "recovery", "external_ai_turn"],
  interpretation: "Local baseline only. These samples do not establish a production SLO, capacity limit, provider latency or release approval."
}, null, 2)}\n`);
