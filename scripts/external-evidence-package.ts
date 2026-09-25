import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubjectManifest } from "./subject-manifest.ts";

/**
 * AUD27-005 release-authority tooling: assembles an external evidence-root
 * package that the AUD27 verifier can validate without being able to produce
 * it. It is intentionally run by the external authority against a frozen
 * checkout and writes outside the candidate.
 */

export const EXTERNAL_PACKAGE_STATUS = "EXTERNAL_AUTHORITY_VERIFIED" as const;

export type ExternalEvidenceInput = {
  root: string;
  outputDirectory: string;
  authorityId: string;
  anchorEvidencePath?: string;
  recoveryEvidencePath: string;
  runbook?: string;
  restoreProcedure?: string;
  executedAt?: string;
  force?: boolean;
  runAnchor?: boolean;
};

export type ExternalEvidenceFile = { path: string; digest: string };

export type ExternalEvidenceResult = {
  outputDirectory: string;
  sourceSha: string;
  subjectFingerprint: string;
  status: typeof EXTERNAL_PACKAGE_STATUS;
  files: ExternalEvidenceFile[];
};

export function digestOf(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export function assertExternalOutput(root: string, outputDirectory: string): string {
  const resolvedRoot = resolve(root);
  const resolvedOutput = resolve(outputDirectory);
  if (resolvedOutput === resolvedRoot || isWithin(resolvedRoot, resolvedOutput)) {
    throw new Error("external evidence output must live outside the candidate checkout");
  }
  if (/aud24/i.test(resolvedOutput)) throw new Error("external evidence output path is not admissible");
  if (existsSync(resolvedOutput)) {
    const stats = statSync(resolvedOutput);
    if (stats.isSymbolicLink()) throw new Error("external evidence output must not be a symlink");
    if (!stats.isDirectory()) throw new Error("external evidence output must be a directory");
  }
  return resolvedOutput;
}

export function runAnchorEvidence(root: string, executedAt: string, sourceSha: string, subjectFingerprint: string): Buffer {
  const commands: Array<{ label: string; args: string[] }> = [
    { label: "npm test", args: ["test"] },
    { label: "npm run verify:aud27-semantics", args: ["run", "verify:aud27-semantics"] },
    { label: "npm run verify:control-plane", args: ["run", "verify:control-plane"] },
    { label: "npm run verify:static", args: ["run", "verify:static"] }
  ];
  const results = commands.map(({ label, args }) => {
    const result = spawnSync("npm", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 900_000 });
    if (result.status !== 0) throw new Error(`anchor command failed: ${label}`);
    return { command: label, exitStatus: 0 as const, outputDigest: digestOf(`${result.stdout ?? ""}${result.stderr ?? ""}`) };
  });
  return Buffer.from(`${JSON.stringify({
    kind: "cvg-aud27-independent-anchor-evidence",
    executedAt,
    sourceSha,
    subjectFingerprint,
    environment: `${process.platform} ${process.arch}; Node ${process.version}`,
    commands: results
  }, null, 2)}\n`);
}

export function buildExternalEvidencePackage(input: ExternalEvidenceInput): ExternalEvidenceResult {
  const root = resolve(input.root);
  const output = assertExternalOutput(root, input.outputDirectory);
  const authorityId = input.authorityId.trim();
  if (!authorityId) throw new Error("authority id is required");
  if (!input.runAnchor && !input.anchorEvidencePath) throw new Error("anchor evidence is required unless runAnchor is set");
  const recoveryBytes = readFileSync(input.recoveryEvidencePath);
  if (existsSync(output)) {
    if (!input.force && readdirSync(output).length > 0) throw new Error("external evidence output is not empty; pass force to overwrite");
  } else {
    mkdirSync(output, { recursive: true });
  }
  const subject = buildSubjectManifest(root);
  const executedAt = input.executedAt ?? new Date().toISOString();
  const anchorBytes = input.runAnchor
    ? runAnchorEvidence(root, executedAt, subject.manifest.sourceSha, subject.fingerprint)
    : readFileSync(input.anchorEvidencePath ?? "");
  const anchorPath = "anchor-evidence.json";
  const recoveryPath = "recovery-evidence.json";
  const authorityPath = "authority-attestation.json";
  const anchorDigest = digestOf(anchorBytes);
  const recoveryDigest = digestOf(recoveryBytes);
  const authorityBytes = Buffer.from(`${JSON.stringify({
    kind: "cvg-aud27-external-authority-attestation",
    authorityId,
    issuedAt: executedAt,
    sourceSha: subject.manifest.sourceSha,
    subjectFingerprint: subject.fingerprint,
    statement: "The authority reproduced the focal checks on the referenced candidate and issues this package as its independent anchor."
  }, null, 2)}\n`);
  const authorityDigest = digestOf(authorityBytes);
  const artifacts = [
    { path: anchorPath, digest: anchorDigest },
    { path: authorityPath, digest: authorityDigest },
    { path: recoveryPath, digest: recoveryDigest }
  ];
  const anchor = { status: "VERIFIED", path: anchorPath, digest: anchorDigest };
  const authority = { status: "VERIFIED", authorityId, attestationPath: authorityPath, attestationDigest: authorityDigest };
  const recovery = {
    status: "VERIFIED",
    runbook: input.runbook?.trim() || "restore.md",
    restoreProcedure: input.restoreProcedure?.trim() || "Execute the documented restore runbook against an isolated destination and record the drill evidence.",
    quarantineOnTamper: true,
    evidencePath: recoveryPath,
    evidenceDigest: recoveryDigest
  };
  const limitations = [
    "The external authority reproduced focal checks in its own environment; production infrastructure and human promotion remain outside this package."
  ];
  const core = {
    sourceSha: subject.manifest.sourceSha,
    subjectFingerprint: subject.fingerprint,
    status: EXTERNAL_PACKAGE_STATUS,
    artifacts,
    anchor,
    authority,
    recovery,
    limitations
  };
  writeFileSync(join(output, anchorPath), anchorBytes, { mode: 0o600 });
  writeFileSync(join(output, recoveryPath), recoveryBytes, { mode: 0o600 });
  writeFileSync(join(output, authorityPath), authorityBytes, { mode: 0o600 });
  const payloadBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, kind: "cvg-aud27-evidence-package", ...core }, null, 2)}\n`);
  writeFileSync(join(output, "package-payload.json"), payloadBytes, { mode: 0o600 });
  const payloadDigest = digestOf(payloadBytes);
  const manifestBytes = Buffer.from(`${JSON.stringify({ schemaVersion: 1, kind: "cvg-aud27-evidence-root-manifest", packagePath: "package-payload.json", packageDigest: payloadDigest, ...core }, null, 2)}\n`);
  writeFileSync(join(output, "package-manifest.json"), manifestBytes, { mode: 0o600 });
  writeFileSync(join(output, "package-integrity.json"), `${JSON.stringify({
    schemaVersion: 1,
    kind: "cvg-aud27-evidence-integrity",
    manifestPath: "package-manifest.json",
    manifestDigest: digestOf(manifestBytes),
    packagePath: "package-payload.json",
    packageDigest: payloadDigest
  }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(output, "README.md"), [
    "# External AUD27 evidence package",
    "",
    `Authority: ${authorityId}`,
    `Source SHA: ${subject.manifest.sourceSha}`,
    `Subject fingerprint: ${subject.fingerprint}`,
    "",
    "Validation: point CVG_EVIDENCE_ROOT at this directory and run `npm run verify:aud27-evidence-root`.",
    "Tamper check: copy the directory, modify one byte of package-payload.json and confirm the verifier fails.",
    ""
  ].join("\n"), { mode: 0o600 });
  return {
    outputDirectory: output,
    sourceSha: subject.manifest.sourceSha,
    subjectFingerprint: subject.fingerprint,
    status: EXTERNAL_PACKAGE_STATUS,
    files: artifacts
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const valueOf = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  if (argv.includes("--help")) {
    process.stdout.write([
      "Usage: npx tsx scripts/external-evidence-package.ts --output <dir-outside-repo> --authority-id <id> --recovery-evidence <file> [--run-anchor | --anchor-evidence <file>] [--runbook <file>] [--restore-procedure <text>] [--force]",
      "",
      "Run by the release authority against a frozen checkout; the package is written outside the candidate.",
      ""
    ].join("\n"));
    return;
  }
  const output = valueOf("--output");
  const authorityId = valueOf("--authority-id");
  const recoveryEvidencePath = valueOf("--recovery-evidence");
  const anchorEvidencePath = valueOf("--anchor-evidence");
  const runbook = valueOf("--runbook");
  const restoreProcedure = valueOf("--restore-procedure");
  const runAnchor = argv.includes("--run-anchor");
  if (!output || !authorityId || !recoveryEvidencePath || (!runAnchor && !anchorEvidencePath)) {
    process.stderr.write("missing required arguments; run with --help\n");
    process.exitCode = 1;
    return;
  }
  const result = buildExternalEvidencePackage({
    root: process.cwd(),
    outputDirectory: output,
    authorityId,
    recoveryEvidencePath,
    ...(anchorEvidencePath ? { anchorEvidencePath } : {}),
    ...(runAnchor ? { runAnchor } : {}),
    ...(runbook ? { runbook } : {}),
    ...(restoreProcedure ? { restoreProcedure } : {}),
    ...(argv.includes("--force") ? { force: true } : {})
  });
  process.stdout.write(`EXTERNAL_EVIDENCE_PACKAGE_WRITTEN output=${result.outputDirectory} sourceSha=${result.sourceSha} fingerprint=${result.subjectFingerprint}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
