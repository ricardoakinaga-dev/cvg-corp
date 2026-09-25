type Rgb = readonly [number, number, number];
type ContrastCheck = { id: string; foreground: string; background: string; threshold?: number };

const checks: ContrastCheck[] = [
  { id: "body-primary-on-canvas", foreground: "#142433", background: "#f5f8f6" },
  { id: "display-on-surface", foreground: "#0e1a24", background: "#ffffff" },
  { id: "secondary-on-canvas", foreground: "#385263", background: "#f5f8f6" },
  { id: "muted-on-canvas", foreground: "#59717c", background: "#f5f8f6" },
  { id: "secondary-on-warm-surface", foreground: "#385263", background: "#fbf8ef" },
  { id: "inverse-on-action", foreground: "#ffffff", background: "#08786f" },
  { id: "danger-on-danger-surface", foreground: "#a83f3c", background: "#fbe7e1" },
  { id: "warning-on-warning-surface", foreground: "#8d5d0e", background: "#fff2d4" },
  { id: "action-on-subtle-surface", foreground: "#08786f", background: "#f2f7f5", threshold: 3 },
  { id: "action-on-surface", foreground: "#08786f", background: "#ffffff" },
  { id: "focus-on-surface", foreground: "#08786f", background: "#ffffff", threshold: 3 },
  { id: "slate-on-surface", foreground: "#385263", background: "#ffffff" }
];

function parseHex(value: string): Rgb {
  const raw = value.replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) throw new Error(`invalid color ${value}`);
  const expanded = raw.length === 3 ? [...raw].map((part) => `${part}${part}`).join("") : raw;
  return [Number.parseInt(expanded.slice(0, 2), 16), Number.parseInt(expanded.slice(2, 4), 16), Number.parseInt(expanded.slice(4, 6), 16)];
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

const results = checks.map((check) => {
  const foreground = luminance(parseHex(check.foreground));
  const background = luminance(parseHex(check.background));
  const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  const threshold = check.threshold ?? 4.5;
  return { ...check, ratio: Number(ratio.toFixed(2)), threshold, pass: ratio >= threshold };
});
const output = {
  schema_version: 2,
  source: "apps/web/src/styles.css",
  standard: "WCAG 2.x contrast ratio",
  checked: results.length,
  failed: results.filter((result) => !result.pass).length,
  results,
  limitations: ["Static token-pair checks do not replace computed-style inspection for gradients, transparency, images, or user-generated content."]
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (output.failed > 0) process.exitCode = 1;
