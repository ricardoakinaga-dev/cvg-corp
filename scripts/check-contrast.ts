type Rgb = readonly [number, number, number];

const checks: Array<{ foreground: string; background: string }> = [
  { foreground: "#385263", background: "#f5f8f6" },
  { foreground: "#59717c", background: "#f5f8f6" },
  { foreground: "#ffffff", background: "#08786f" },
  { foreground: "#a83f3c", background: "#fbe7e1" },
  { foreground: "#8d5d0e", background: "#fff2d4" }
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
  return { ...check, ratio: Number(ratio.toFixed(2)), threshold: 4.5, pass: ratio >= 4.5 };
});

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
if (results.some((result) => !result.pass)) process.exitCode = 1;
