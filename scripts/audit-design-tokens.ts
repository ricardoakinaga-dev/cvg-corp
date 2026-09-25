import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

type Finding = {
  code: string;
  severity: "high" | "medium";
  category: string;
  message: string;
};

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const root = resolve(args.find((argument) => !argument.startsWith("-")) ?? "apps/web/src");
const files: string[] = [];

const walk = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(css|ts|tsx)$/.test(entry.name)) files.push(path);
  }
};

await walk(root);

const findings: Finding[] = [];
const colors = new Set<string>();
for (const path of files) {
  const content = await readFile(path, "utf8");
  const relativePath = relative(root, path);
  const governedPersistenceAdapter = /(?:^|[/\\])state[/\\]persistence\.ts$/.test(path);
  if (!governedPersistenceAdapter && /\b(?:localStorage|sessionStorage|indexedDB)\b/.test(content)) {
    findings.push({ code: "storage_bypass", severity: "high", category: "state", message: `${path}: browser persistence must use an explicitly governed adapter` });
  }
  for (const match of content.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const value = match[0].toLowerCase();
    colors.add(value);
    if (!path.endsWith("styles.css")) findings.push({ code: "inline_color", severity: "high", category: "color", message: `${path}: use a design token instead of ${value}` });
  }
  if (path.endsWith("styles.css")) {
    const requiredTokens = [
      "color-canvas",
      "color-surface",
      "color-content-primary",
      "color-content-secondary",
      "color-content-muted",
      "color-border-subtle",
      "color-action",
      "color-focus",
      "color-success",
      "color-warning",
      "color-danger",
      "size-touch-target"
    ];
    for (const token of requiredTokens) {
      if (!new RegExp(`--${token}\\s*:`).test(content)) {
        findings.push({ code: "missing_semantic_token", severity: "high", category: "token", message: `${relativePath}: required semantic token --${token} is missing` });
      }
    }
  }
}

const summary = {
  high: findings.filter((finding) => finding.severity === "high").length,
  medium: findings.filter((finding) => finding.severity === "medium").length
};
const output = {
  schema_version: 2,
  root,
  strict,
  files_scanned: files.map((path) => relative(root, path)).sort(),
  registered_colors: colors.size,
  findings,
  summary,
  blocking_findings: summary.high > 0 || (strict && summary.medium > 0),
  limitations: [
    "Static source scan only; browser cascade and computed styles are not evaluated.",
    "Palette consolidation is checked through named semantic roles; visually similar primitive values remain valid when they represent distinct surfaces or states."
  ]
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.blocking_findings) process.exitCode = 1;
