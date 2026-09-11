const DURATION_PART = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;

/** Return a k6 duration that starts after two complete user phases. */
export function doubleDuration(value) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("duration must be a non-empty string");
  const source = value.trim();
  let cursor = 0;
  let totalMilliseconds = 0;
  for (const match of source.matchAll(DURATION_PART)) {
    if (match.index !== cursor) throw new Error(`invalid duration: ${value}`);
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`invalid duration: ${value}`);
    const multiplier = match[2] === "ms" ? 1 : match[2] === "s" ? 1_000 : match[2] === "m" ? 60_000 : 3_600_000;
    totalMilliseconds += amount * multiplier;
    cursor += match[0].length;
  }
  if (cursor !== source.length || totalMilliseconds <= 0) throw new Error(`invalid duration: ${value}`);
  return `${totalMilliseconds * 2 / 1_000}s`;
}
