const Z_95 = 1.959963984540054;

export function wilsonInterval(
  successes: number,
  n: number,
  z = Z_95,
): { low: number; high: number; center: number; halfWidth: number } {
  if (!n || n <= 0) return { low: 0, high: 1, center: 0.5, halfWidth: 0.5 };
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  const low = Math.max(0, center - margin);
  const high = Math.min(1, center + margin);
  return { low, high, center, halfWidth: Math.max(high - phat, phat - low) };
}

export function wilsonMoePct(p: number, n: number): number {
  return wilsonInterval(Math.round(p * n), n).halfWidth * 100;
}

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1));
}

/** Deterministic seeded RNG (mulberry32 over a string-hashed seed). */
export function makeRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
