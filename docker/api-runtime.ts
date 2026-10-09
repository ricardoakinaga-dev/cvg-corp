import { startServer } from "../apps/api/src/app.ts";

const runtime = await startServer();
process.stdout.write(`CVG API local em http://${runtime.config.host}:${runtime.config.port}\n`);
if (runtime.config.demoMode && runtime.config.storageMode === "memory") {
  process.stdout.write("Demonstração sintética habilitada; providers reais e dados reais permanecem bloqueados.\n");
}
process.on("SIGINT", async () => { await runtime.app.close(); process.exit(0); });
process.on("SIGTERM", async () => { await runtime.app.close(); process.exit(0); });
