import { runAgentEvals } from "./agent-evals.ts";

/** Golden (SYNTHETIC) agent evals; no real provider is involved. */
const { results, differential, passed } = await runAgentEvals();
for (const result of results) process.stdout.write(`${result.passed ? "PASS" : "FAIL"} ${result.id}${result.passed ? "" : ` — ${result.failures.join("; ")}`}\n`);
for (const comparison of differential) process.stdout.write(`${comparison.parity ? "PARITY" : "DIVERGENT"} ${comparison.id} embedded=${comparison.embedded} legacy=${comparison.externalMock}\n`);
if (!passed) process.exit(1);
process.stdout.write(`AGENT_EVALS_VERIFIED scenarios=${results.length} differentialParity=${differential.filter((entry) => entry.parity).length}/${differential.length} evidence=SYNTHETIC\n`);
