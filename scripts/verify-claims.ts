import { existsSync, readFileSync } from "node:fs";

/**
 * Overclaim detector.  Positive "production ready"/"Triplo AAA" claims are
 * rejected unless the canonical quality state proves them.  Negations and
 * historical documents are allowed; only canonical current docs are scanned.
 */
const state = JSON.parse(readFileSync("artifacts/quality/current-state.json", "utf8")) as { aaaState?: string; productionState?: string; engineeringState?: string };
const aaaProven = state.aaaState === "TRIPLE_AAA_CANDIDATE";
const productionProven = state.productionState === "PRODUCTION_READY";
const scanned = ["README.md", "docs/README.md", "docs/architecture-final.md", "docs/final-state-of-art-scorecard.md", "docs/triple-aaa-final-scorecard.md", "docs/embedded-runtime-rollout.md"];
const failures: string[] = [];
const negation = /\b(não|nao|not|never|without|blocked|pending|pendente|bloqueado|absent|ausente|NOT_PROVEN|não provado|no evidence)\b/i;

for (const path of scanned) {
  if (!existsSync(path)) continue;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith(">") || line.startsWith("|")) continue;
    const positiveAaa = /(triplo\s*aaa|triple\s*aaa)\s*(atingido|alcançado|achieved|certified|concluído|verified|proven)?/i.test(line) && !negation.test(line) && !/\?/.test(line) && /(atingido|alcançado|achieved|certified|concluído|verified|proven|is\s+now|está)/i.test(line);
    if (positiveAaa && !aaaProven) failures.push(`${path}: positive Triple-AAA claim without proven state: ${line.slice(0, 160)}`);
    const positiveProduction = /production[-\s]?ready/i.test(line) && !negation.test(line) && !/\?/.test(line);
    if (positiveProduction && !productionProven) failures.push(`${path}: positive production-ready claim without human approval: ${line.slice(0, 160)}`);
    if (/verified in production/i.test(line) && !negation.test(line)) failures.push(`${path}: "verified in production" without production evidence: ${line.slice(0, 160)}`);
    if (/external provider verified/i.test(line) && !negation.test(line) && !/NOT_RUN|BLOCKED/.test(line)) failures.push(`${path}: external provider claim without external evidence: ${line.slice(0, 160)}`);
  }
}
if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`CLAIMS_VERIFIED scanned=${scanned.length} aaaState=${state.aaaState ?? "unknown"} productionState=${state.productionState ?? "unknown"}\n`);
