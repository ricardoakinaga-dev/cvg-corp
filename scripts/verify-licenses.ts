import { readFile } from "node:fs/promises";

type LockPackage = {
  version?: string;
  license?: string;
};

const allowedLicenses = new Set(["MIT", "ISC", "Apache-2.0", "BSD-3-Clause", "CC-BY-4.0", "MPL-2.0"]);
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8")) as {
  packages?: Record<string, LockPackage>;
};
const findings: string[] = [];
let scanned = 0;

for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path.startsWith("node_modules/") || !entry.version || path.startsWith("node_modules/@cvg/")) continue;
  scanned += 1;
  const license = entry.license?.trim();
  if (!license) {
    findings.push(`${path}: license metadata is missing`);
  } else if (!allowedLicenses.has(license)) {
    findings.push(`${path}: license ${license} is outside the approved policy`);
  }
}

if (findings.length > 0) {
  for (const finding of findings) process.stderr.write(`FAIL ${finding}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS license policy verified for ${scanned} third-party packages; approved SPDX identifiers: ${[...allowedLicenses].join(", ")}\n`);
}
