import { OpsTelemetry } from "@cvg/ops";

export interface LocalLoadResult {
  readonly status: "LOCAL_SYNTHETIC_PASS" | "LOCAL_SYNTHETIC_FAIL";
  readonly requests: number;
  readonly operationCardinality: number;
  readonly operationBudget: number;
  readonly operationOverflow: number;
  readonly retainedLatencySamples: number;
  readonly externalEvidence: "NOT_RUN";
}

/**
 * Deterministic local load profile. It exercises cardinality and bounded
 * latency retention without opening a socket or using a real tenant/provider.
 */
export function runLocalLoad(requests = 10_000): LocalLoadResult {
  const telemetry = new OpsTelemetry({ maxOperations: 64, maxLatencies: 256, maxLogs: 32 });
  for (let index = 0; index < requests; index += 1) {
    const startedAt = telemetry.requestStarted();
    const statusCode = index % 100 === 0 ? 503 : 200;
    telemetry.requestFinished(startedAt - (index % 17), statusCode, `GET /api/v1/patients/${index}?search=synthetic-${index}`);
  }
  const metrics = telemetry.metrics("memory");
  const bounded = Object.keys(metrics.operations).length <= 64 && telemetry.cardinality.operationOverflow === 0 && !Object.keys(metrics.operations).some((operation) => operation.includes("?"));
  return {
    status: bounded && metrics.requestsTotal === requests ? "LOCAL_SYNTHETIC_PASS" : "LOCAL_SYNTHETIC_FAIL",
    requests: metrics.requestsTotal,
    operationCardinality: Object.keys(metrics.operations).length,
    operationBudget: telemetry.cardinality.operationBudget,
    operationOverflow: telemetry.cardinality.operationOverflow,
    retainedLatencySamples: telemetry.latencySamples,
    externalEvidence: "NOT_RUN"
  };
}

if (process.argv[1]?.endsWith("run-local-load.ts")) process.stdout.write(`${JSON.stringify(runLocalLoad(), null, 2)}\n`);
