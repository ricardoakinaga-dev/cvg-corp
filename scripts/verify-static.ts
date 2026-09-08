import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const failures: string[] = [];
const required = [
  "packages/contracts/src/index.ts", "packages/domain/src/index.ts", "packages/harness/src/index.ts", "apps/api/src/server.ts", "apps/web/src/main.tsx", "apps/web/src/styles.css", "db/migrations/001_initial.sql", "tests/unit/domain.test.ts", "tests/integration/api.test.ts"
];
for (const path of required) { try { const content = await readFile(path, "utf8"); if (content.trim().length < 40) failures.push(`${path}: empty artifact`); } catch { failures.push(`${path}: missing`); } }
const sourceFiles: string[] = [];
const walk = async (root: string): Promise<void> => { for (const item of await readdir(root, { withFileTypes: true })) { const path = join(root, item.name); if (item.isDirectory()) await walk(path); else if (/\.(ts|tsx|sql|json|css)$/.test(item.name)) sourceFiles.push(path); } };
await walk("apps"); await walk("packages"); await walk("db"); await walk("scripts");
for (const path of sourceFiles) {
  const content = await readFile(path, "utf8");
  if (/sk-[A-Za-z0-9]{20,}|postgres:\/\/[^\s]*@[^\s]+/.test(content) && !path.endsWith("docker-compose.yml")) failures.push(`${path}: possible credential literal`);
  if (/localStorage\s*\./.test(content)) failures.push(`${path}: localStorage is forbidden for the composer/offline contract`);
}
const docs = await readFile("docs/README.md", "utf8");
if (!docs.includes("Quality") && !docs.includes("qualidade")) failures.push("docs/README.md: documentation index not found");
if (failures.length) { for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`); process.exitCode = 1; } else process.stdout.write(`static verification passed: ${required.length} required artifacts, ${sourceFiles.length} source files\n`);
