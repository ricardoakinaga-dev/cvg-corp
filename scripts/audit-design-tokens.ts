import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

type Finding = {
  code: string;
  severity: "high" | "medium";
  category: string;
  message: string;
};

const root = resolve(process.argv.find((argument) => !argument.startsWith("-") && argument !== process.argv[0] && argument !== process.argv[1]) ?? "apps/web/src");
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
  if (/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(content)) {
    findings.push({ code: "storage_bypass", severity: "high", category: "state", message: `${path}: browser persistence must use an explicitly governed adapter` });
  }
  for (const match of content.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const value = match[0].toLowerCase();
    colors.add(value);
    if (!path.endsWith("styles.css")) findings.push({ code: "inline_color", severity: "high", category: "color", message: `${path}: use a design token instead of ${value}` });
  }
}

const rgb = (value: string): [number, number, number] => [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)];
const ordered = [...colors].sort();
for (let left = 0; left < ordered.length; left += 1) {
  for (let right = left + 1; right < ordered.length; right += 1) {
    const leftColor = ordered[left]!;
    const rightColor = ordered[right]!;
    const a = rgb(leftColor);
    const b = rgb(rightColor);
    const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (distance < 10) findings.push({ code: "near_duplicate_color", severity: "medium", category: "color", message: `token colors ${leftColor} and ${rightColor} are visually near-duplicates (distance ${distance.toFixed(2)})` });
  }
}

const summary = {
  high: findings.filter((finding) => finding.severity === "high").length,
  medium: findings.filter((finding) => finding.severity === "medium").length
};
process.stdout.write(`${JSON.stringify({ schema_version: 1, root, files_scanned: files.map((path) => path.replace(`${root}/`, "")).sort(), findings, summary, limitations: ["Static source scan only; browser cascade and computed styles are not evaluated.", "Near-duplicate colors use Euclidean RGB distance, not perceptual Delta E."] }, null, 2)}\n`);
if (summary.high > 0) process.exitCode = 1;
