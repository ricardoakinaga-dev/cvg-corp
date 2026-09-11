import { startServer } from "./app.ts";

export { assertProductionRuntimeOverrides, createRuntime, MemoryRateLimiter } from "./app.ts";
export { startServer } from "./app.ts";
export type { CvgServerRuntime, ServerConfig, ServerOptions } from "./app.ts";

if (process.argv[1]?.endsWith("apps/api/src/server.ts")) {
  const runtime = await startServer();
  process.stdout.write(`CVG API local em http://${runtime.config.host}:${runtime.config.port}\n`);
  if (runtime.config.demoMode && runtime.config.storageMode === "memory") process.stdout.write("Demonstração sintética habilitada; providers reais e dados reais permanecem bloqueados.\n");
  process.on("SIGINT", async () => { await runtime.app.close(); process.exit(0); });
  process.on("SIGTERM", async () => { await runtime.app.close(); process.exit(0); });
}
