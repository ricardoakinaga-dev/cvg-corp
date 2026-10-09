import { build } from "esbuild";
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = join(root, "dist", "runtime");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const bundleOptions = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  tsconfig: join(root, "tsconfig.json"),
  minify: true,
  legalComments: "none",
  sourcemap: false,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
  },
  logLevel: "warning"
};

const entries = [
  ["docker/api-runtime.ts", "api.mjs"],
  ["docker/worker.ts", "worker.mjs"],
  ["scripts/db.ts", "migrate.mjs"]
];

for (const [entryPoint, outputName] of entries) {
  await build({
    ...bundleOptions,
    entryPoints: [join(root, entryPoint)],
    outfile: join(outputDirectory, outputName),
    metafile: false
  });
}

await cp(join(root, "db", "migrations"), join(outputDirectory, "db", "migrations"), { recursive: true });

for (const outputName of entries.map(([, name]) => name)) {
  const outputPath = join(outputDirectory, outputName);
  await stat(outputPath);
  await execFileAsync(process.execPath, ["--check", outputPath]);
}

const outputBytes = (await Promise.all((await readdir(outputDirectory)).filter((name) => name.endsWith(".mjs")).map(async (name) => (await stat(join(outputDirectory, name))).size))).reduce((sum, size) => sum + size, 0);
process.stdout.write(`runtime bundles ready: ${entries.length} entrypoints, ${outputBytes} JavaScript bytes\n`);
