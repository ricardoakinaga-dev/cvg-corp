import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["apps", "packages", "scripts", "db", "docker"];
const sourceExtensions = /\.(ts|tsx|sql|css|json)$/;
const ignoredDirectories = new Set([".git", "artifacts", "dist", "node_modules", ".vite"]);
const failures: string[] = [];
const files: string[] = [];

async function collect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await collect(join(directory, entry.name));
      continue;
    }
    const path = join(directory, entry.name);
    if (sourceExtensions.test(entry.name)) files.push(path);
  }
}

for (const root of roots) await collect(root);

for (const path of files.sort()) {
  const content = await readFile(path, "utf8");
  if (!content.endsWith("\n") || content.endsWith("\n\n")) failures.push(`${path}: file must end with exactly one newline`);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bsk-[A-Za-z0-9]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b/.test(content)) failures.push(`${path}: credential-like literal is forbidden`);
  if (/\b(?:localStorage|sessionStorage)\s*[.[]/.test(content)) failures.push(`${path}: browser storage is forbidden for the offline/composer contract`);
  if (path.startsWith("packages/domain/") && /from\s+["']@cvg\/(?:harness|harness-adapters|integrations|agent-runtime)["']/.test(content)) failures.push(`${path}: domain must not import runtime/provider/integration packages`);
}

const apiSource = await readFile("apps/api/src/app.ts", "utf8");
const directMutation = /store\.(grantRole|revokeRole|createGuardian|disablePatient|mergePatients|createAppointment|checkInAppointment|createEncounter|createClinicalDocument|signClinicalDocument|addClinicalAddendum|createDiagnosticRequest|createSpecimen|createResult|createStockMovement|createHospitalEpisode|createMedicationOrder|dispenseMedication|administerMedication|createCharge|createPayment|requestRefund|createMessage|createKnowledgeDocument|restore)\s*\(/;
if (directMutation.test(apiSource)) failures.push("apps/api/src/app.ts: domain mutations must pass through the application command service");

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`lint passed: ${files.length} repository source files checked\n`);
}
