import test from "node:test";
import assert from "node:assert/strict";
import { OpsTelemetry, renderPrometheusMetrics } from "@cvg/ops";

test("agent counters are sanitized, aggregated and rendered without tenant labels", () => {
  const telemetry = new OpsTelemetry();
  telemetry.increment("agent_tool_denied");
  telemetry.increment("agent_tool_denied", 2);
  telemetry.increment("Agent Plugin Kill-Switch"); // sanitized
  telemetry.increment("org:123:actor:456"); // must not leak identifiers as-is beyond charset sanitization
  telemetry.increment("", 5); // ignored
  telemetry.increment("agent_bad", Number.NaN); // ignored

  const metrics = telemetry.metrics("memory", { agentRuntime: "READY" });
  assert.equal(metrics.agentCounters["agent_tool_denied"], 3);
  assert.equal(metrics.agentCounters["agent_plugin_kill_switch"], 1);
  assert.equal(metrics.agentCounters["org_123_actor_456"], 1);
  assert.equal(metrics.agentCounters["agent_bad"], undefined);

  const rendered = renderPrometheusMetrics(metrics);
  assert.match(rendered, /cvg_agent_agent_tool_denied 3/);
  assert.match(rendered, /# TYPE cvg_agent_agent_tool_denied counter/);
  assert.match(rendered, /cvg_agent_org_123_actor_456 1/);
  assert.equal(rendered.includes("organization"), false);
});

test("metrics without agent counters still render the base families", () => {
  const metrics = new OpsTelemetry().metrics("memory");
  assert.deepEqual(metrics.agentCounters, {});
  const rendered = renderPrometheusMetrics(metrics);
  assert.match(rendered, /cvg_api_requests_total/);
  assert.equal(/cvg_agent_agent_/.test(rendered), false, "no custom agent counter families are rendered when empty");
});
