import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface DocumentIntegrityFinding {
  readonly code: "BROKEN_LINK" | "LOCAL_ONLY_LINK" | "BROKEN_ANCHOR" | "DUPLICATE_ADR_NUMBER" | "ADR_FILENAME_NUMBER_MISMATCH" | "CONTRIBUTING_GUIDANCE_MISSING";
  readonly file: string;
  readonly detail: string;
}

function walkMarkdown(root: string, directory: string, output: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walkMarkdown(root, path, output);
    else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") output.push(relative(root, path).split(sep).join("/"));
  }
}

function removeCodeAndComments(content: string): string {
  return content
    .replace(/^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function targets(content: string): string[] {
  const source = removeCodeAndComments(content);
  const values: string[] = [];
  for (const match of source.matchAll(/\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g)) {
    values.push((match[1] ?? "").replace(/^<|>$/g, ""));
  }
  for (const match of source.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/gm)) {
    values.push((match[1] ?? "").replace(/^<|>$/g, ""));
  }
  for (const match of source.matchAll(/\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) values.push(match[2] ?? "");
  return values;
}

function headingSlugs(content: string): Set<string> {
  const source = removeCodeAndComments(content);
  const slugs = new Set<string>();
  const counts = new Map<string, number>();
  const add = (base: string): void => {
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  };
  for (const match of source.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = (match[1] ?? "")
      .replace(/`([^`]*)`/g, "$1")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-");
    if (slug) add(slug);
  }
  for (const match of source.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/gi)) slugs.add(match[2] ?? "");
  for (const match of source.matchAll(/<a\s+[^>]*\bname\s*=\s*(["'])([^"']+)\1/gi)) slugs.add(match[2] ?? "");
  return slugs;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `ignored` reports targets Git ignores. Such a file can exist on the author's
 * workstation but never in a clean checkout, so a link to it passes locally and
 * breaks in CI; it is rejected everywhere to keep both results identical.
 */
export function validateDocumentIntegrity(
  documents: ReadonlyMap<string, string>,
  exists: (repositoryPath: string) => boolean,
  ignored: (repositoryPath: string) => boolean = () => false,
): DocumentIntegrityFinding[] {
  const findings: DocumentIntegrityFinding[] = [];
  const slugs = new Map([...documents].map(([path, content]) => [path, headingSlugs(content)]));
  const adrNumbers = new Map<string, string[]>();

  for (const [path, content] of documents) {
    if (path.startsWith("docs/adr/")) {
      const number = content.match(/^#\s+ADR[- ]+(\d+)\b/im)?.[1];
      if (number) adrNumbers.set(number, [...(adrNumbers.get(number) ?? []), path]);
      const fileNumber = path.match(/(?:^|\/)(\d{3})-[^/]+\.md$/)?.[1];
      if (fileNumber && number && Number(fileNumber) !== Number(number)) {
        findings.push({ code: "ADR_FILENAME_NUMBER_MISMATCH", file: path, detail: `filename number ${fileNumber} differs from ADR heading ${number}` });
      }
    }

    for (const rawTarget of targets(content)) {
      const target = rawTarget.trim();
      if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
      const hashIndex = target.indexOf("#");
      const queryIndex = target.indexOf("?");
      const pathEnd = [hashIndex, queryIndex].filter((index) => index >= 0).reduce((a, b) => Math.min(a, b), target.length);
      const rawPath = decodePath(target.slice(0, pathEnd));
      const fragment = hashIndex >= 0 ? decodePath(target.slice(hashIndex + 1).split("?")[0] ?? "") : "";
      const targetPath = rawPath.startsWith("/")
        ? rawPath.slice(1)
        : posix.normalize(posix.join(posix.dirname(path), rawPath));
      if (rawPath && !exists(targetPath)) {
        findings.push({ code: "BROKEN_LINK", file: path, detail: `missing target ${rawPath}` });
        continue;
      }
      if (rawPath && ignored(targetPath)) {
        findings.push({ code: "LOCAL_ONLY_LINK", file: path, detail: `target ${rawPath} is ignored by Git and absent from a clean checkout` });
        continue;
      }
      if (fragment && (!rawPath || extname(rawPath).toLowerCase() === ".md")) {
        const documentPath = rawPath ? targetPath : path;
        const available = slugs.get(documentPath);
        if (available && !available.has(fragment)) findings.push({ code: "BROKEN_ANCHOR", file: path, detail: `${documentPath} has no heading or anchor #${fragment}` });
      }
    }
  }

  const contributing = documents.get("CONTRIBUTING.md")?.toLocaleLowerCase();
  if (contributing) {
    const requiredGuidance = [
      "## focused checks by area",
      "npm run verify:control-plane",
      "tests/unit/api-response-contract.test.ts",
      "npm test",
      "explicitly identified disposable postgresql database",
      "shared or production database",
      "npm run test:e2e",
      "npm run typecheck"
    ];
    for (const phrase of requiredGuidance) {
      if (!contributing.includes(phrase)) findings.push({ code: "CONTRIBUTING_GUIDANCE_MISSING", file: "CONTRIBUTING.md", detail: `focused contributor guidance omits ${phrase}` });
    }
  }

  for (const [number, files] of adrNumbers) {
    if (files.length > 1) findings.push({ code: "DUPLICATE_ADR_NUMBER", file: files.slice().sort()[0]!, detail: `ADR ${number} is assigned to ${files.sort().join(", ")}` });
  }
  return findings;
}

/** Ignored paths under `root` (ignored directories collapsed); empty outside a Git work tree. */
function gitIgnoredPaths(root: string): (repositoryPath: string) => boolean {
  const result = spawnSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) return () => false;
  const entries = result.stdout.split("\0").filter(Boolean);
  const files = new Set(entries.filter((entry) => !entry.endsWith("/")));
  const directories = entries.filter((entry) => entry.endsWith("/"));
  return (repositoryPath) => files.has(repositoryPath) || directories.some((directory) => `${repositoryPath}/`.startsWith(directory));
}

function main(): void {
  const root = resolve(process.env.CVG_REPO_ROOT?.trim() || process.cwd());
  const paths: string[] = [];
  walkMarkdown(root, resolve(root, "docs"), paths);
  for (const path of ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md"]) {
    if (existsSync(resolve(root, path))) paths.push(path);
  }
  const documents = new Map(paths.map((path) => [path, readFileSync(resolve(root, path), "utf8")]));
  const findings = validateDocumentIntegrity(documents, (repositoryPath) => {
    const absolute = resolve(root, repositoryPath);
    if (!existsSync(absolute)) return false;
    return statSync(absolute).isFile() || statSync(absolute).isDirectory();
  }, gitIgnoredPaths(root));
  process.stdout.write(`DOCS_INTEGRITY_${findings.length === 0 ? "PASS" : "FAIL"} files=${documents.size} findings=${findings.length}\n`);
  for (const finding of findings) process.stdout.write(`${finding.code} file=${finding.file} detail=${finding.detail}\n`);
  process.exitCode = findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
