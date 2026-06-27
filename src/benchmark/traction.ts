export interface BrandSku {
  brand: string;
  product: string;
  priceMinor: number;
  format: string;
  claims: string[];
  reviewCount: number;
  rating: number;        // 0..5
  retailer: string;
  band: string;          // discovered price-band label
}

const W_VOL = Number(process.env.PB_TRACTION_W_VOL ?? "0.7");
const W_QUAL = Number(process.env.PB_TRACTION_W_QUAL ?? "0.3");
const RATING_FLOOR = Number(process.env.PB_TRACTION_RATING_FLOOR ?? "3.0");
const RATING_CEIL = Number(process.env.PB_TRACTION_RATING_CEIL ?? "5.0");

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Composite traction 0..1. maxReviewCount = the largest review count in the harvested set. */
export function tractionScore(
  m: { reviewCount: number; rating: number },
  maxReviewCount: number,
): number {
  const volSignal = Math.log10((m.reviewCount || 0) + 1);
  const maxSignal = Math.log10((maxReviewCount || 0) + 1) || 1; // avoid /0
  const volumeNorm = clamp01(volSignal / maxSignal);
  const span = RATING_CEIL - RATING_FLOOR || 1;
  const qualityNorm = clamp01(((m.rating || 0) - RATING_FLOOR) / span);
  return clamp01(W_VOL * volumeNorm + W_QUAL * qualityNorm);
}

/**
 * Dedupe to one SKU per brand (highest reviewCount), then select top-N by traction
 * with price-band stratification: greedily take the highest-traction brand from each
 * band in round-robin so the set spans the market, then fill remaining slots by
 * overall traction. Returns fewer than N if fewer brands exist (never pads).
 */
export function selectBenchmarks(skus: BrandSku[], n: number): BrandSku[] {
  const byBrand = new Map<string, BrandSku>();
  for (const s of skus) {
    const cur = byBrand.get(s.brand);
    if (!cur || s.reviewCount > cur.reviewCount) byBrand.set(s.brand, s);
  }
  const maxRc = Math.max(1, ...[...byBrand.values()].map((s) => s.reviewCount));
  const scored = [...byBrand.values()]
    .map((s) => ({ s, t: tractionScore(s, maxRc) }))
    .sort((a, b) => b.t - a.t);

  const bands = new Map<string, { s: BrandSku; t: number }[]>();
  for (const e of scored) {
    const arr = bands.get(e.s.band) ?? [];
    arr.push(e);
    bands.set(e.s.band, arr);
  }

  const picked: BrandSku[] = [];
  const taken = new Set<string>();
  const bandQueues = [...bands.values()];
  let progress = true;
  while (picked.length < n && progress) {
    progress = false;
    for (const q of bandQueues) {
      if (picked.length >= n) break;
      const next = q.shift();
      if (next && !taken.has(next.s.brand)) {
        picked.push(next.s);
        taken.add(next.s.brand);
        progress = true;
      }
    }
  }
  for (const e of scored) {
    if (picked.length >= n) break;
    if (!taken.has(e.s.brand)) { picked.push(e.s); taken.add(e.s.brand); }
  }
  return picked;
}
