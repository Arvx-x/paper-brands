export interface Cluster {
  members: number[];
  min: number;
  max: number;
  center: number;
}

/** 1D k-means (Lloyd) with quantile init. Deterministic for sorted input. */
function kmeans1d(sorted: number[], k: number, iters = 50): number[][] {
  // Init centers at evenly spaced quantiles.
  let centers = Array.from({ length: k }, (_, i) =>
    sorted[Math.min(sorted.length - 1, Math.round(((i + 0.5) / k) * (sorted.length - 1)))]!,
  );
  let groups: number[][] = [];
  for (let it = 0; it < iters; it++) {
    groups = Array.from({ length: k }, () => [] as number[]);
    for (const v of sorted) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = Math.abs(v - centers[c]!);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      groups[best]!.push(v);
    }
    const next = groups.map((g, i) => (g.length ? g.reduce((a, b) => a + b, 0) / g.length : centers[i]!));
    if (next.every((c, i) => c === centers[i])) break;
    centers = next;
  }
  return groups.filter((g) => g.length);
}

/** Mean silhouette for a 1D clustering (higher = better separated). */
function silhouette(groups: number[][]): number {
  const flat = groups.flatMap((g, gi) => g.map((v) => ({ v, gi })));
  if (groups.length < 2 || flat.length <= groups.length) return -1;
  let total = 0;
  let count = 0;
  for (const { v, gi } of flat) {
    const own = groups[gi]!;
    const a = own.length > 1 ? own.reduce((s, x) => s + Math.abs(x - v), 0) / (own.length - 1) : 0;
    let b = Infinity;
    groups.forEach((g, j) => {
      if (j === gi || !g.length) return;
      const d = g.reduce((s, x) => s + Math.abs(x - v), 0) / g.length;
      if (d < b) b = d;
    });
    const s = b === Infinity ? 0 : (b - a) / Math.max(a, b || 1);
    total += s;
    count++;
  }
  return count ? total / count : -1;
}

/**
 * Choose the number of price tiers DYNAMICALLY from the data instead of forcing
 * 3. Tries k=2..maxK, picks the best silhouette, and enforces a minimum tier
 * size so tiny noise clusters don't appear.
 */
export function dynamicClusters(values: number[], maxK = 5, minMembers = 2): Cluster[] {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const distinct = new Set(sorted).size;
  if (distinct <= 2) {
    return [toCluster(sorted)];
  }

  const upper = Math.min(maxK, distinct);
  let best: { groups: number[][]; score: number } | null = null;
  for (let k = 2; k <= upper; k++) {
    const groups = kmeans1d(sorted, k).filter((g) => g.length >= minMembers);
    if (groups.length < 2) continue;
    const score = silhouette(groups);
    if (!best || score > best.score) best = { groups, score };
  }
  const groups = best?.groups ?? [sorted];
  return groups
    .map(toCluster)
    .sort((a, b) => a.center - b.center);
}

function toCluster(members: number[]): Cluster {
  const min = Math.min(...members);
  const max = Math.max(...members);
  return { members, min, max, center: members.reduce((a, b) => a + b, 0) / members.length };
}

/** Rank-based tier names for a dynamic number of clusters. */
export function tierLabels(n: number): string[] {
  const sets: Record<number, string[]> = {
    1: ["all"],
    2: ["value", "premium"],
    3: ["mass", "premium-mass", "premium"],
    4: ["budget", "value", "premium-mass", "premium"],
    5: ["budget", "value", "mid", "premium", "luxury"],
  };
  return sets[n] ?? Array.from({ length: n }, (_, i) => `tier-${i + 1}`);
}
