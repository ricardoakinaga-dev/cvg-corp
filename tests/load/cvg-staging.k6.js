/*
 * Production-like load contract for the CVG staging gate.
 *
 * This file is intentionally executable only by an explicitly configured k6
 * run. It never supplies a default endpoint, credential or capacity target.
 * Missing configuration must remain a blocked external gate.
 */
import http from "k6/http";
import { check, group, sleep } from "k6";
import { doubleDuration } from "./duration.js";

const baseUrl = (__ENV.CVG_LOAD_BASE_URL ?? "").replace(/\/$/, "");
const bearer = __ENV.CVG_LOAD_BEARER_TOKEN ?? "";
const p95 = Number(__ENV.CVG_LOAD_P95_MS ?? "");
const duration = __ENV.CVG_LOAD_DURATION ?? "30s";

if (!baseUrl || !/^https:\/\//i.test(baseUrl)) throw new Error("CVG_LOAD_BASE_URL must be an explicit HTTPS staging URL");
if (!bearer) throw new Error("CVG_LOAD_BEARER_TOKEN must be supplied by the staging secret authority");
if (!Number.isFinite(p95) || p95 <= 0) throw new Error("CVG_LOAD_P95_MS must be an observed, approved threshold");

export const options = {
  scenarios: {
    users_50: { executor: "constant-vus", vus: 50, duration },
    users_100: { executor: "constant-vus", vus: 100, duration, startTime: duration },
    burst: { executor: "ramping-arrival-rate", startRate: 0, timeUnit: "1s", preAllocatedVUs: 20, maxVUs: 150, stages: [{ target: 100, duration: "10s" }, { target: 0, duration: "10s" }], startTime: doubleDuration(duration) }
  },
  thresholds: {
    http_req_duration: [`p(95)<${p95}`],
    http_req_failed: ["rate<0.01"]
  }
};

const headers = { Authorization: `Bearer ${bearer}`, Accept: "application/json", "x-cvg-load-run": __ENV.CVG_LOAD_RUN_ID ?? "explicit-staging-run" };

function request(path, name) {
  const response = http.get(`${baseUrl}${path}`, { headers, tags: { operation: name } });
  check(response, { [`${name} status is 2xx`]: (result) => result.status >= 200 && result.status < 300 });
  return response;
}

export default function () {
  group("patient-and-appointment-read", () => {
    request(__ENV.CVG_LOAD_PATIENT_PATH ?? "/api/v1/patients", "patient_lookup");
    request(__ENV.CVG_LOAD_APPOINTMENT_PATH ?? "/api/v1/appointments", "appointment_listing");
  });

  if (__ENV.CVG_LOAD_AI_PATH) group("ai-turn", () => request(__ENV.CVG_LOAD_AI_PATH, "deepseek_turn"));
  if (__ENV.CVG_LOAD_PROVIDER_PATH) group("provider", () => request(__ENV.CVG_LOAD_PROVIDER_PATH, "provider_ack"));
  if (__ENV.CVG_LOAD_WORKER_METRICS_PATH) group("worker-backlog", () => request(__ENV.CVG_LOAD_WORKER_METRICS_PATH, "worker_backlog"));
  sleep(1);
}
