import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ALERTMANAGER_TEMPLATE_PATH = resolve(root, "docker/observability/alertmanager.yml");
const PLACEHOLDER = /\$\{CVG_ALERTMANAGER_WEBHOOK_URL:\?[^}]+\}/g;

export type AlertmanagerValidationOptions = { requireTls?: boolean };

function invalid(detail: string): never {
  throw new Error(`ALERTMANAGER_CONFIG_INVALID: ${detail}`);
}

export function validateAlertmanagerSink(raw: string | undefined, options: AlertmanagerValidationOptions = {}): URL {
  if (!raw?.trim()) invalid("CVG_ALERTMANAGER_WEBHOOK_URL is required");
  if (raw.includes("${") || raw.includes("}")) invalid("sink URL must not contain an unresolved template");

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    invalid("sink URL must be absolute");
  }

  const localHttp = parsed.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname);
  if (options.requireTls ? parsed.protocol !== "https:" : parsed.protocol !== "https:" && !localHttp) {
    invalid(options.requireTls ? "production sink URL must use HTTPS" : "sink URL must use HTTPS, or HTTP on loopback for a controlled local fixture");
  }
  if (parsed.username || parsed.password) invalid("sink URL must not embed credentials");
  if (parsed.hash) invalid("sink URL must not contain a fragment");
  if (!parsed.hostname) invalid("sink URL must include a host");
  return parsed;
}

export function renderAlertmanagerConfig(template: string, sink: string | undefined, options: AlertmanagerValidationOptions = {}): string {
  const parsed = validateAlertmanagerSink(sink, options);
  const matches = template.match(PLACEHOLDER) ?? [];
  if (matches.length !== 1) invalid("template must contain exactly one CVG_ALERTMANAGER_WEBHOOK_URL placeholder");

  const rendered = template.replace(PLACEHOLDER, () => parsed.toString());
  if ((rendered.match(PLACEHOLDER) ?? []).length > 0 || rendered.includes("cvg-null")) invalid("rendered config still contains a placeholder or null receiver");
  if (!/receiver:\s+cvg-webhook\b/.test(rendered) || !/webhook_configs:/.test(rendered) || !/url:\s+https?:\/\//.test(rendered)) {
    invalid("rendered config must contain the governed webhook receiver");
  }
  return rendered;
}

export async function renderAlertmanagerFromEnvironment(options: AlertmanagerValidationOptions = {}): Promise<string> {
  const template = await readFile(ALERTMANAGER_TEMPLATE_PATH, "utf8");
  return renderAlertmanagerConfig(template, process.env.CVG_ALERTMANAGER_WEBHOOK_URL, options);
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const production = process.argv.includes("--production");
  const output = argumentValue("--output");
  const rendered = await renderAlertmanagerFromEnvironment({ requireTls: production });
  if (output) {
    const target = resolve(output);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, rendered, { mode: 0o600, flag: "wx" });
    process.stdout.write(`ALERTMANAGER_CONFIG_RENDERED path=${target} bytes=${Buffer.byteLength(rendered, "utf8")}\n`);
    return;
  }
  process.stdout.write(`ALERTMANAGER_CONFIG_VALID mode=${production ? "production" : "local"} receiver=cvg-webhook\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
