import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CvgStore, DomainError } from "@cvg/domain";
import type { CvgContext, OpaqueId } from "@cvg/contracts";
import { EmbeddedAgentRuntime } from "@cvg/embedded-agent-runtime";
import { MockModelProvider, type MockModelStep } from "@cvg/model-adapters";
import { GovernedHarness } from "@cvg/harness";
import { MockHarnessAdapter } from "@cvg/harness-adapters";
import { ToolGatewayError } from "@cvg/agent-tools";
import type { EmbeddedTelemetryPort } from "@cvg/embedded-agent-runtime";

/**
 * Deterministic agent evals.  Golden scenarios run against the embedded
 * runtime with a scripted mock provider; differential scenarios compare the
 * embedded runtime with the legacy governed mock harness structurally.
 * No real model, credential or patient data is involved.
 */

const stepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), content: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("tool"), tool: z.string().min(1), input: z.record(z.string(), z.unknown()).default({}) }).strict()
]);

const scenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,80}$/),
  version: z.number().int().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  differential: z.boolean().default(false),
  safeMode: z.boolean().default(false),
  purpose: z.enum(["SUMMARY", "DRAFT_CLINICAL", "KNOWLEDGE_QUERY", "OPERATIONS"]),
  prompt: z.string().min(1).max(8_000),
  patientRequired: z.boolean().default(false),
  encounterId: z.string().nullable().default(null),
  requestedTool: z.string().nullable().default(null),
  executor: z.enum(["default", "outcome-unknown"]).default("default"),
  steps: z.array(stepSchema).max(8),
  expect: z.object({
    turnStatus: z.enum(["COMPLETED", "RECEIVED", "DENIED", "QUARANTINED", "OUTCOME_UNKNOWN"]),
    approval: z.boolean(),
    policyDenied: z.boolean().default(false),
    toolReceipts: z.number().int().min(0).nullable().default(null),
    draft: z.boolean().default(false),
    quarantined: z.boolean().default(false),
    responseIncludes: z.string().nullable().default(null)
  }).strict()
}).strict();

export type AgentEvalScenario = z.infer<typeof scenarioSchema>;

export interface AgentEvalResult {
  id: string;
  passed: boolean;
  failures: string[];
  observed: {
    turnStatus: string | null;
    approval: boolean;
    policyDenied: boolean;
    toolReceipts: number;
    draft: boolean;
    response: string | null;
    tokens: number;
    stopCondition: string;
    runtimeVersion: string;
  };
}

export interface DifferentialEvalResult {
  id: string;
  parity: boolean;
  embedded: string;
  externalMock: string;
  detail: string;
}

function buildContext(store: CvgStore): CvgContext {
  const veterinarianId = [...store.users.values()].find((user) => user.login.startsWith("ana."))?.id ?? store.bootstrapCredentials.userId;
  const option = store.contextOptions(veterinarianId)[0];
  if (!option) throw new Error("store fixture has no context option");
  const session = store.createSession(veterinarianId, "agent-evals-token", "agent-evals-csrf", 60);
  return store.resolveContext(veterinarianId, { unitId: option.unit.id, workspaceId: option.workspace.id }, "eval", "agent-evals", null, null, session.id);
}

function scopedPatient(store: CvgStore, context: CvgContext): OpaqueId | null {
  const patient = [...store.patients.values()].find((candidate) => candidate.organizationId === context.organizationId && candidate.unitId === context.unitId && candidate.workspaceId === context.workspaceId);
  return patient?.id ?? null;
}

function stepsToScript(steps: AgentEvalScenario["steps"]): MockModelStep[] {
  return steps.map((step) =>
    step.kind === "message"
      ? {
          reply: { kind: "MESSAGE" as const, content: step.content },
          usage: { inputTokens: 12, outputTokens: 6, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" as const },
          providerId: "mock-model",
          model: "mock-1",
          responseDigest: "e".repeat(64),
          finishReason: "stop" as const,
          providerRequestId: "eval",
          retryable: false
        }
      : {
          reply: { kind: "TOOL_CALL" as const, tool: step.tool, input: step.input, callId: "eval-call" },
          usage: { inputTokens: 10, outputTokens: 4, costMicros: 0, currency: "USD", source: "LOCAL_SYNTHETIC" as const },
          providerId: "mock-model",
          model: "mock-1",
          responseDigest: "f".repeat(64),
          finishReason: "tool_calls" as const,
          providerRequestId: "eval",
          retryable: false
        }
  );
}

export async function runAgentEvals(directory = "evals/golden"): Promise<{ results: AgentEvalResult[]; differential: DifferentialEvalResult[]; passed: boolean }> {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const results: AgentEvalResult[] = [];
  const differential: DifferentialEvalResult[] = [];
  for (const file of files) {
    const parsed = scenarioSchema.safeParse(JSON.parse(await readFile(join(directory, file), "utf8")));
    if (!parsed.success) {
      results.push({ id: file, passed: false, failures: [`invalid scenario: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`], observed: { turnStatus: null, approval: false, policyDenied: false, toolReceipts: 0, draft: false, response: null, tokens: 0, stopCondition: "INVALID", runtimeVersion: "unknown" } });
      continue;
    }
    const scenario = parsed.data;
    results.push(await executeScenario(scenario));
    if (scenario.differential) differential.push(await compareDifferential(scenario));
  }
  return { results, differential, passed: results.every((result) => result.passed) && differential.every((result) => result.parity) };
}

async function executeScenario(scenario: AgentEvalScenario): Promise<AgentEvalResult> {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = buildContext(store);
  const patientId = scenario.patientRequired ? scopedPatient(store, context) : null;
  const failures: string[] = [];
  const events: string[] = [];
  const telemetry: EmbeddedTelemetryPort = { increment: () => undefined, recordKernelEvent: (event) => events.push(event.name) };
  const runtime = new EmbeddedAgentRuntime({
    store,
    modelProvider: new MockModelProvider({ script: stepsToScript(scenario.steps) }),
    runtimeCommit: "eval-commit",
    telemetry,
    controls: () => ({ aiEnabled: true, safeMode: scenario.safeMode, disabledProviders: [], disabledTools: [], disabledPlugins: [] }),
    ...(scenario.executor === "outcome-unknown"
      ? {
          toolExecutor: async () => {
            throw new ToolGatewayError("OUTCOME_UNKNOWN", "eval: resultado externo desconhecido");
          }
        }
      : {})
  });
  let turnStatus: string | null = null;
  let approval = false;
  let policyDenied = false;
  let response: string | null = null;
  let tokens = 0;
  let stopCondition = "NONE";
  try {
    const result = await runtime.executeTurn(context, {
      sessionId: null,
      prompt: scenario.prompt,
      purpose: scenario.purpose,
      patientId,
      encounterId: scenario.encounterId as OpaqueId | null,
      requestedTool: scenario.requestedTool,
      approvalId: null,
      idempotencyKey: `eval-${scenario.id}`
    });
    turnStatus = result.turn.status;
    approval = result.approval !== null;
    response = result.turn.response;
    tokens = result.turn.inputTokens + result.turn.outputTokens;
    stopCondition = result.turn.usage?.status ?? "UNKNOWN";
  } catch (error) {
    if (error instanceof DomainError) {
      policyDenied = error.code === "POLICY_DENIED";
      stopCondition = error.code;
      const deniedTurn = [...store.aiTurns.values()].at(-1);
      turnStatus = deniedTurn?.status ?? "DENIED";
      response = deniedTurn?.response ?? null;
    } else {
      failures.push(`unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const toolReceipts = [...store.commandReceipts.values()].filter((receipt) => receipt.operation.startsWith("tool.") && receipt.status === "SUCCEEDED").length;
  const draft = [...store.aiDrafts.values()].length > 0;
  if (turnStatus !== scenario.expect.turnStatus) failures.push(`turnStatus expected ${scenario.expect.turnStatus} but observed ${turnStatus}`);
  if (approval !== scenario.expect.approval) failures.push(`approval expected ${scenario.expect.approval} but observed ${approval}`);
  if (policyDenied !== scenario.expect.policyDenied) failures.push(`policyDenied expected ${scenario.expect.policyDenied} but observed ${policyDenied}`);
  if (scenario.expect.toolReceipts !== null && toolReceipts !== scenario.expect.toolReceipts) failures.push(`toolReceipts expected ${scenario.expect.toolReceipts} but observed ${toolReceipts}`);
  if (draft !== scenario.expect.draft) failures.push(`draft expected ${scenario.expect.draft} but observed ${draft}`);
  if (scenario.expect.quarantined && events.length > 0) failures.push("quarantine expected but the kernel still processed the turn");
  if (scenario.expect.responseIncludes && !(response ?? "").includes(scenario.expect.responseIncludes)) failures.push(`response does not include ${JSON.stringify(scenario.expect.responseIncludes)}`);
  return {
    id: scenario.id,
    passed: failures.length === 0,
    failures,
    observed: { turnStatus, approval, policyDenied, toolReceipts, draft, response, tokens, stopCondition, runtimeVersion: "embedded-agent-runtime/1.0.0" }
  };
}

/** Structural comparison between the embedded runtime and the legacy mock harness. */
async function compareDifferential(scenario: AgentEvalScenario): Promise<DifferentialEvalResult> {
  const embedded = await executeScenario({ ...scenario, expect: { ...scenario.expect } });
  const external = await executeLegacyScenario(scenario);
  const parity = embedded.observed.turnStatus === external.turnStatus && embedded.observed.approval === external.approval && embedded.observed.policyDenied === external.policyDenied;
  return {
    id: scenario.id,
    parity,
    embedded: `${String(embedded.observed.turnStatus)}${embedded.observed.approval ? "+approval" : ""}${embedded.observed.policyDenied ? "+denied" : ""}`,
    externalMock: `${String(external.turnStatus)}${external.approval ? "+approval" : ""}${external.policyDenied ? "+denied" : ""}`,
    detail: parity ? "structural parity" : `embedded=${JSON.stringify(embedded.observed)} legacy=${JSON.stringify(external)}`
  };
}

async function executeLegacyScenario(scenario: AgentEvalScenario): Promise<{ turnStatus: string | null; approval: boolean; policyDenied: boolean }> {
  const store = new CvgStore({ bootstrapPassword: "synthetic-password-123" });
  const context = buildContext(store);
  const patientId = scenario.patientRequired ? scopedPatient(store, context) : null;
  const harness = new MockHarnessAdapter(new GovernedHarness(store));
  try {
    const result = await harness.executeTurn(context, {
      sessionId: null,
      prompt: scenario.prompt,
      purpose: scenario.purpose,
      patientId,
      encounterId: scenario.encounterId as OpaqueId | null,
      requestedTool: scenario.requestedTool,
      approvalId: null,
      idempotencyKey: `eval-legacy-${scenario.id}`
    });
    return { turnStatus: result.approval ? "RECEIVED" : result.turn.status, approval: result.approval !== null, policyDenied: false };
  } catch (error) {
    return { turnStatus: error instanceof DomainError ? "DENIED" : null, approval: false, policyDenied: error instanceof DomainError && error.code === "POLICY_DENIED" };
  }
}

async function main(): Promise<void> {
  const sha = process.env.CVG_BUILD_SHA ?? process.env.CVG_GIT_SHA ?? "local";
  const { results, differential, passed } = await runAgentEvals();
  const artifact = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    subjectSha: sha,
    evidenceClass: "SYNTHETIC",
    provider: "mock-model",
    passed,
    results,
    differential
  };
  await mkdir("artifacts/evals", { recursive: true });
  const path = join("artifacts/evals", `agent-evals-${sha}.json`);
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`);
  for (const result of results) process.stdout.write(`${result.passed ? "PASS" : "FAIL"} ${result.id}${result.passed ? "" : ` — ${result.failures.join("; ")}`}\n`);
  for (const comparison of differential) process.stdout.write(`${comparison.parity ? "PARITY" : "DIVERGENT"} ${comparison.id} embedded=${comparison.embedded} legacy=${comparison.externalMock}\n`);
  process.stdout.write(`agent evals: ${results.filter((result) => result.passed).length}/${results.length} passed; differential ${differential.filter((entry) => entry.parity).length}/${differential.length}; artifact ${path}\n`);
  if (!passed) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("scripts/agent-evals.ts")) await main();
