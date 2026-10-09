import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSubjectManifest } from "./subject-manifest.ts";

/**
 * AUD27-023 sealed independent-critic protocol. The release authority emits a
 * read-only packet bound to the frozen candidate fingerprint; the critic
 * reviews the copied evidence and returns a verdict bound to the packet
 * digest. Any byte change in the packet is detectable.
 */

export type SealedPacket = {
  schemaVersion: 1;
  kind: "cvg-sealed-critic-packet";
  generatedAt: string;
  candidate: { sourceSha: string; subjectFingerprint: string };
  evidence: Array<{ path: string; digest: string }>;
  instructions: string[];
};

export type CriticVerdict = {
  reviewer: string;
  independenceLevel: string;
  verdict: "PASS" | "FAIL";
  packetDigest: string;
  findings: Array<{ severity: string; detail: string }>;
};

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

export function packetDigestOf(packet: SealedPacket): string {
  return sha256(stable(packet));
}

function within(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function assertSealedOutput(root: string, outputDirectory: string): string {
  const resolvedRoot = resolve(root);
  const output = resolve(outputDirectory);
  if (output === resolvedRoot || within(resolvedRoot, output)) throw new Error("sealed packet output must live outside the candidate checkout");
  return output;
}

export function buildSealedPacket(root: string, outputDirectory: string, evidencePaths: readonly string[]): SealedPacket {
  const candidateRoot = resolve(root);
  const output = assertSealedOutput(candidateRoot, outputDirectory);
  if (evidencePaths.length === 0) throw new Error("at least one evidence path is required");
  const subject = buildSubjectManifest(candidateRoot);
  const evidence = evidencePaths.map((path) => {
    const absolute = resolve(candidateRoot, path);
    if (!within(candidateRoot, absolute) || !existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`evidence path is not a regular file inside the candidate: ${path}`);
    return { path, digest: sha256(readFileSync(absolute)) };
  });
  const packet: SealedPacket = {
    schemaVersion: 1,
    kind: "cvg-sealed-critic-packet",
    generatedAt: new Date().toISOString(),
    candidate: { sourceSha: subject.manifest.sourceSha, subjectFingerprint: subject.fingerprint },
    evidence,
    instructions: [
      "This packet is read-only sealed evidence for the frozen candidate.",
      "Review the copied evidence under evidence/ and the candidate commit/fingerprint in packet.json.",
      "Write verdict.json with reviewer, independenceLevel, verdict (PASS/FAIL), packetDigest and findings.",
      "Bind the verdict with --bind; do not modify any packet file."
    ]
  };
  if (!existsSync(output)) mkdirSync(output, { recursive: true });
  for (const entry of evidence) {
    const destination = join(output, "evidence", entry.path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(candidateRoot, entry.path), destination);
  }
  const packetBytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`);
  writeFileSync(join(output, "packet.json"), packetBytes, { mode: 0o600 });
  writeFileSync(join(output, "packet.digest"), `${packetDigestOf(packet)}\n`, { mode: 0o600 });
  return packet;
}

export function verifySealedPacket(root: string, packetDirectory: string): string[] {
  const errors: string[] = [];
  const directory = resolve(packetDirectory);
  const packetPath = join(directory, "packet.json");
  const digestPath = join(directory, "packet.digest");
  if (!existsSync(packetPath) || !existsSync(digestPath)) return ["sealed packet is missing packet.json or packet.digest"];
  let packet: SealedPacket;
  try {
    packet = JSON.parse(readFileSync(packetPath, "utf8")) as SealedPacket;
  } catch (error) {
    return [`sealed packet JSON is invalid: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (packet.kind !== "cvg-sealed-critic-packet" || packet.schemaVersion !== 1) errors.push("sealed packet kind or schema version is invalid");
  const expected = packetDigestOf(packet);
  if (readFileSync(digestPath, "utf8").trim() !== expected) errors.push("sealed packet digest does not match its bytes");
  for (const entry of packet.evidence) {
    const copy = join(directory, "evidence", entry.path);
    if (!existsSync(copy)) {
      errors.push(`sealed evidence copy is missing: ${entry.path}`);
      continue;
    }
    if (sha256(readFileSync(copy)) !== entry.digest) errors.push(`sealed evidence digest mismatch: ${entry.path}`);
  }
  const subject = buildSubjectManifest(resolve(root));
  if (packet.candidate.sourceSha !== subject.manifest.sourceSha) errors.push("sealed packet source SHA does not match the current candidate");
  if (packet.candidate.subjectFingerprint !== subject.fingerprint) errors.push("sealed packet subject fingerprint does not match the current candidate");
  return errors;
}

export function runTamperRehearsal(root: string, packetDirectory: string): { detected: boolean; detail: string } {
  const clean = verifySealedPacket(root, packetDirectory);
  if (clean.length > 0) return { detected: false, detail: `packet is not clean before the rehearsal: ${clean.join("; ")}` };
  const tampered = `${resolve(packetDirectory)}-tampered`;
  try {
    rmSync(tampered, { recursive: true, force: true });
    cpSync(resolve(packetDirectory), tampered, { recursive: true });
    const packet = JSON.parse(readFileSync(join(tampered, "packet.json"), "utf8")) as SealedPacket;
    const first = packet.evidence[0];
    if (!first) return { detected: false, detail: "packet has no evidence to tamper with" };
    const evidencePath = join(tampered, "evidence", first.path);
    const bytes = readFileSync(evidencePath);
    bytes[0] = bytes[0] === 0x41 ? 0x42 : 0x41;
    writeFileSync(evidencePath, bytes);
    const errors = verifySealedPacket(root, tampered);
    return { detected: errors.some((error) => error.includes("digest mismatch")), detail: errors.length ? errors.join("; ") : "tamper was not detected" };
  } finally {
    rmSync(tampered, { recursive: true, force: true });
  }
}

export function bindCriticVerdict(packetDirectory: string, verdictPath: string): string[] {
  const errors: string[] = [];
  const digestPath = join(resolve(packetDirectory), "packet.digest");
  if (!existsSync(digestPath)) return ["sealed packet digest is missing"];
  let verdict: CriticVerdict;
  try {
    verdict = JSON.parse(readFileSync(resolve(verdictPath), "utf8")) as CriticVerdict;
  } catch (error) {
    return [`critic verdict JSON is invalid: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (typeof verdict.reviewer !== "string" || verdict.reviewer.trim().length === 0) errors.push("critic verdict has no reviewer identity");
  if (typeof verdict.independenceLevel !== "string" || !/^I[0-3]$/.test(verdict.independenceLevel)) errors.push("critic verdict independenceLevel must be I0-I3");
  if (verdict.verdict !== "PASS" && verdict.verdict !== "FAIL") errors.push("critic verdict must be PASS or FAIL");
  if (!Array.isArray(verdict.findings)) errors.push("critic verdict findings must be an array");
  if (verdict.packetDigest !== readFileSync(digestPath, "utf8").trim()) errors.push("critic verdict is not bound to the sealed packet digest");
  return errors;
}

function option(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    process.stdout.write([
      "Usage:",
      "  npx tsx scripts/sealed-critic-packet.ts --emit <dir-outside-repo> --evidence <path1,path2,...>",
      "  npx tsx scripts/sealed-critic-packet.ts --verify <dir>",
      "  npx tsx scripts/sealed-critic-packet.ts --rehearsal <dir>",
      "  npx tsx scripts/sealed-critic-packet.ts --bind <dir> <verdict.json>",
      ""
    ].join("\n"));
    return;
  }
  const root = process.cwd();
  if (argv[0] === "--emit") {
    const output = option("--emit");
    const evidence = option("--evidence")?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    if (!output || evidence.length === 0) {
      process.stderr.write("--emit requires --evidence with at least one path\n");
      process.exitCode = 1;
      return;
    }
    const packet = buildSealedPacket(root, output, evidence);
    process.stdout.write(`SEALED_PACKET_EMITTED output=${resolve(output)} packetDigest=${packetDigestOf(packet)} sourceSha=${packet.candidate.sourceSha}\n`);
    return;
  }
  if (argv[0] === "--verify" || argv[0] === "--rehearsal") {
    const directory = argv[1];
    if (!directory) {
      process.stderr.write("directory is required\n");
      process.exitCode = 1;
      return;
    }
    if (argv[0] === "--verify") {
      const errors = verifySealedPacket(root, directory);
      for (const error of errors) process.stderr.write(`FAIL ${error}\n`);
      process.stdout.write(`SEALED_PACKET_${errors.length === 0 ? "VERIFIED" : "FAIL"} digest=${readFileSync(join(resolve(directory), "packet.digest"), "utf8").trim()}\n`);
      if (errors.length > 0) process.exitCode = 1;
      return;
    }
    const rehearsal = runTamperRehearsal(root, directory);
    process.stdout.write(`SEALED_PACKET_REHEARSAL_${rehearsal.detected ? "DETECTED" : "MISSED"} detail=${rehearsal.detail}\n`);
    if (!rehearsal.detected) process.exitCode = 1;
    return;
  }
  if (argv[0] === "--bind") {
    const directory = argv[1];
    const verdictPath = argv[2];
    if (!directory || !verdictPath) {
      process.stderr.write("--bind requires <dir> <verdict.json>\n");
      process.exitCode = 1;
      return;
    }
    const errors = bindCriticVerdict(directory, verdictPath);
    for (const error of errors) process.stderr.write(`FAIL ${error}\n`);
    process.stdout.write(`CRITIC_VERDICT_${errors.length === 0 ? "BOUND" : "REJECTED"}\n`);
    if (errors.length > 0) process.exitCode = 1;
    return;
  }
  process.stderr.write("missing mode; run with --help\n");
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
