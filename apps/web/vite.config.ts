import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const BUNDLE_BUDGET = {
  entryJavaScriptBytes: 420_000,
  totalJavaScriptBytes: 900_000,
  cssBytes: 110_000
} as const;

function bundleBudget(): Plugin {
  return {
    name: "cvg-web-bundle-budget",
    generateBundle(_options, bundle) {
      const assets = Object.values(bundle).map((asset) => ({
        fileName: asset.fileName,
        bytes: Buffer.byteLength(asset.type === "asset" ? String(asset.source) : asset.code),
        type: asset.type,
        isEntry: asset.type === "chunk" && asset.isEntry
      }));
      const entryJavaScript = assets.filter((asset) => asset.type === "chunk" && asset.isEntry);
      const totalJavaScriptBytes = assets.filter((asset) => asset.type === "chunk").reduce((total, asset) => total + asset.bytes, 0);
      const cssBytes = assets.filter((asset) => asset.fileName.endsWith(".css")).reduce((total, asset) => total + asset.bytes, 0);

      for (const asset of assets.filter((candidate) => candidate.type === "chunk" || candidate.fileName.endsWith(".css"))) {
        process.stdout.write(`bundle-budget ${asset.fileName} ${asset.bytes}B${asset.isEntry ? " entry" : ""}\n`);
      }
      const violations = [
        ...entryJavaScript.filter((asset) => asset.bytes > BUNDLE_BUDGET.entryJavaScriptBytes).map((asset) => `[CVG-AUD26-024] entry JavaScript budget exceeded: ${asset.fileName}=${asset.bytes}B > ${BUNDLE_BUDGET.entryJavaScriptBytes}B`),
        ...(totalJavaScriptBytes > BUNDLE_BUDGET.totalJavaScriptBytes ? [`[CVG-AUD26-024] total JavaScript budget exceeded: ${totalJavaScriptBytes}B > ${BUNDLE_BUDGET.totalJavaScriptBytes}B`] : []),
        ...(cssBytes > BUNDLE_BUDGET.cssBytes ? [`[CVG-AUD26-024] CSS budget exceeded: ${cssBytes}B > ${BUNDLE_BUDGET.cssBytes}B`] : [])
      ];
      if (violations.length > 0) this.error(violations.join("\n"));
    }
  };
}

export default defineConfig({
  plugins: [react(), bundleBudget()],
  root: "apps/web",
  // Isolated per E2E run when PLAYWRIGHT_OUTPUT_DIR is set (see playwright.config.ts).
  ...(process.env.PLAYWRIGHT_OUTPUT_DIR?.trim() ? { cacheDir: resolve(process.env.PLAYWRIGHT_OUTPUT_DIR.trim(), "vite-cache") } : {}),
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${process.env.PLAYWRIGHT_API_PORT ?? "4310"}` }
  },
  build: { outDir: "../../dist/web", emptyOutDir: true }
});
