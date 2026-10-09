import { fileURLToPath } from "node:url";

const entries = {
  api: "api.mjs",
  worker: "worker.mjs",
  migrate: "migrate.mjs",
  "backup-volume-init": "init-backup-volume.mjs"
};

const args = process.argv.slice(2);
if (args.length === 0) args.push("api");

let command = args.shift();
if (command === "node") {
  if (args[0] === "--import" && args[1] === "tsx") args.splice(0, 2);
  const sourceEntry = args.shift();
  if (sourceEntry === "docker/worker.ts") command = "worker";
  else if (sourceEntry === "scripts/db.ts") command = "migrate";
  else throw new Error("unsupported compatibility entrypoint");
}

const runtimeFile = entries[command];
if (!runtimeFile) throw new Error("unsupported runtime entrypoint");
if (command === "migrate" && args.length === 0) args.push("migrate");

const runtimeUrl = new URL(`./${runtimeFile}`, import.meta.url);
const runtimePath = fileURLToPath(runtimeUrl);
process.argv = [process.execPath, runtimePath, ...args];
try {
  await import(runtimeUrl.href);
} catch (error) {
  const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "Error";
  let message = error instanceof Error ? error.message : "Unknown failure";
  for (const [key, value] of Object.entries(process.env)) {
    if (value && /(?:PASSWORD|TOKEN|SECRET|API_KEY)/i.test(key)) message = message.replaceAll(value, "[redacted]");
  }
  message = message
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
  process.stderr.write(`runtime ${command} failed: ${errorName}: ${message}\n`);
  process.exit(1);
}
