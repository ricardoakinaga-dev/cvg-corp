import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import base from "../../playwright.config.ts";

const directory = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  ...base,
  testDir: directory,
  testMatch: "logout-race.spec.ts",
  outputDir: directory + "logout-race-results-v2",
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: directory + "logout-race-run-v2.json" }]],
  projects: base.projects?.filter((project) => project.name === "chromium-wide-1440"),
});
