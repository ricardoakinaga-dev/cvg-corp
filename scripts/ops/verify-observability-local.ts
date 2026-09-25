import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROPOSED_OPERATIONAL_SLO_DEFINITIONS, PROPOSED_SLO_ALERT_RULES, evaluateSlo, evaluateSloAlerts } from "@cvg/ops";
import { runLocalChaos } from "../chaos/run-local-chaos.ts";
import { runLocalDr } from "../dr/run-local-dr.ts";
import { runLocalLoad } from "../load/run-local-load.ts";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function requiredMarkers(relativePath: string, markers: readonly string[]): Promise<{ file: string; status: "PASS" | "FAIL"; missing: string[] }> {
  const source = await readFile(resolve(root, relativePath), "utf8").catch(() => "");
  const missing = markers.filter((marker) => !source.includes(marker));
  return { file: relativePath, status: missing.length === 0 ? "PASS" : "FAIL", missing };
}

async function runAlertDrill(): Promise<{ status: "PASS" | "FAIL"; breachAlert: string; unknownRestoreAlerts: number }> {
  const availability = PROPOSED_OPERATIONAL_SLO_DEFINITIONS.find((definition) => definition.id === "API_AVAILABILITY");
  const rto = PROPOSED_OPERATIONAL_SLO_DEFINITIONS.find((definition) => definition.id === "RESTORE_RTO");
  const rpo = PROPOSED_OPERATIONAL_SLO_DEFINITIONS.find((definition) => definition.id === "RESTORE_RPO");
  if (!availability || !rto || !rpo) return { status: "FAIL", breachAlert: "missing_slo", unknownRestoreAlerts: 0 };
  const breach = evaluateSlo(availability, { value: 0.998, sampleCount: 1_000, evidence: "MEASURED", environment: "synthetic", observedAt: new Date().toISOString() });
  const unknownRto = evaluateSlo(rto, { value: null, sampleCount: 0, evidence: "UNKNOWN", environment: "synthetic", observedAt: new Date().toISOString() });
  const unknownRpo = evaluateSlo(rpo, { value: null, sampleCount: 0, evidence: "UNKNOWN", environment: "synthetic", observedAt: new Date().toISOString() });
  const alerts = evaluateSloAlerts([breach, unknownRto, unknownRpo]);
  const breachAlert = alerts.find((alert) => alert.ruleId === "SLO-ALERT-API-AVAILABILITY-BREACH");
  const unknownRestoreAlerts = alerts.filter((alert) => alert.ruleId.includes("RESTORE") && alert.status === "ALERT").length;
  const status = breachAlert?.status === "ALERT" && unknownRestoreAlerts === 2 && PROPOSED_SLO_ALERT_RULES.every((rule) => rule.status === "PROPOSED") ? "PASS" : "FAIL";
  return { status, breachAlert: breachAlert?.status ?? "NOT_RUN", unknownRestoreAlerts };
}

async function main(): Promise<void> {
  const configChecks = await Promise.all([
    requiredMarkers("docker/observability/otel-collector.durable.yml", ["file/cvg-logs:", "rotation:", "attributes/redact", "/var/lib/cvg/observability/logs"]),
    requiredMarkers("docker/observability/compose.local.yml", ["cvg_observability_logs:", "otel-collector.durable.yml", "restart: \"no\"", "internal: true"]),
    requiredMarkers("docker/observability/slo.yml", ["API_ERROR_RATIO", "DEPENDENCY_AVAILABILITY", "RESTORE_RTO", "evidence: UNKNOWN", "externalDelivery: BLOCKED_EXTERNAL"]),
    requiredMarkers("docker/observability/alerts.yml", ["severity:", "owner:", "channel:", "for:", "runbook:", "CvgRestoreRtoRpoUnknown"]),
    requiredMarkers("docker/observability/retention.yml", ["externalBackend: BLOCKED_EXTERNAL", "rto: UNKNOWN", "rpo: UNKNOWN"])
  ]);
  const load = runLocalLoad();
  const chaos = await runLocalChaos();
  const dr = await runLocalDr();
  const alerts = await runAlertDrill();
  const status = configChecks.every((check) => check.status === "PASS") && load.status === "LOCAL_SYNTHETIC_PASS" && chaos.status === "LOCAL_SYNTHETIC_PASS" && dr.status === "LOCAL_SYNTHETIC_PASS" && alerts.status === "PASS";
  const report = {
    status: status ? "LOCAL_HARNESS_VERIFIED" : "LOCAL_HARNESS_FAILED",
    items: ["CVG-AUD26-009", "CVG-AUD26-010", "CVG-AUD26-032", "CVG-AUD26-033", "CVG-AUD26-034"],
    configChecks,
    load,
    chaos,
    dr,
    alerts,
    externalGates: {
      durableExternalLogBackend: "BLOCKED_EXTERNAL",
      alertDeliveryAuthority: "BLOCKED_EXTERNAL",
      productionLikeLoad: "BLOCKED_EXTERNAL",
      liveChaos: "NOT_RUN",
      managedRestore: "BLOCKED_EXTERNAL",
      rto: "UNKNOWN",
      rpo: "UNKNOWN"
    },
    dataPolicy: "synthetic-only; no real tenant, PHI, secret, provider or production endpoint used"
  } as const;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!status) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("verify-observability-local.ts")) await main();
