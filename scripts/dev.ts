import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev:api"], { stdio: "inherit", env: { ...process.env, CVG_HOST: "127.0.0.1", CVG_STORAGE: process.env.CVG_STORAGE ?? "memory", CVG_DEMO_MODE: process.env.CVG_DEMO_MODE ?? "true" } }),
  spawn("npm", ["run", "dev:web"], { stdio: "inherit", env: { ...process.env } })
];

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
for (const child of children) child.on("exit", (code) => { if (!shuttingDown && code !== 0) { shutdown(); process.exitCode = code ?? 1; } });
