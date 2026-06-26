import { multiResearch } from "./research.ts";
import { LLMClient } from "../llm/client.ts";
import { dynamicClusters, tierLabels } from "./cluster.ts";
import type { PriceBand } from "../categories/types.ts";

export interface PriceObservation {
  brand: string;
  product: string;
  retailer?: string;
  mrp?: number;
  price: number; // current selling price, whole currency
  packSize?: string;
  grams?: number;
  pricePerGram?: number;
  subtype?: string; // e.g. tinted, medicated, SPF — model-tagged
}

export interface PriceBucket extends PriceBand {
  share: number; // fraction of SKUs in this bucket
  count: number;
  medianPerGram?: number;
  examples: string[];
}

export interface PriceStats {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  medianPerGram?: number;
}

export interface PriceIntel {
  currency: string;
  observations: PriceObservation[];
  dropped: number;
  bands: PriceBand[]; // dynamic count, for CategoryPack
  buckets: PriceBucket[]; // richer, with share/examples
  stats: PriceStats | null;
}

/**
 * Layered, multi-provider price discovery with DYNAMIC buckets:
 *  1) fan out many queries (tiers x retailers x sub-segments) across OpenAI +
 *     Gemini grounded search to find as many real SKUs as possible
 *  2) consolidate into structured records with a strict JSON pass
 *  3) normalize pack size -> price-per-gram
 *  4) gently drop only absurd rows (never nuke small samples)
 *  5) CLUSTER prices to discover the natural number of tiers (k chosen by
 *     silhouette), with data-driven labels, ranges, shares, and examples
 */
export async function gatherPriceIntel(
  category: string,
  geography: string,
  currency: string,
  llm = new LLMClient(),
): Promise<PriceIntel> {
  const geo = geography ? ` in ${geography}` : "";
  const retailers = "Amazon, Flipkart, Nykaa, Myntra, brand websites";
  const angles = [
    `cheapest budget ${category}${geo} with current ${currency} price and pack size (${retailers})`,
    `most popular best-selling ${category}${geo} with current ${currency} price, pack size, star rating`,
    `premium and luxury ${category}${geo}: high-end and imported brands with current ${currency} price and pack size`,
    `full ${category} price list${geo}: as many distinct SKUs as possible with MRP, current price, pack size (g/ml)`,
    `different types/variants of ${category}${geo} (e.g. tinted, medicated, SPF, natural) with prices and pack size`,
    `new and trending ${category}${geo} launched recently with price and pack size`,
  ];

  const system =
    "You are a marketplace pricing analyst. Use live listings (Amazon, Flipkart, " +
    "Nykaa, Myntra, brand sites). Report REAL current selling prices and pack " +
    "sizes — never invent. Cover the FULL range from cheapest to most premium. " +
    "Include brand, product, retailer, MRP, current price, pack size, and a short " +
    "type tag (e.g. tinted/medicated/SPF/plain).";

  const texts = await Promise.all(
    angles.map((q) => multiResearch(q, system).then((r) => r.content).catch(() => "")),
  );
  const combined = texts.filter(Boolean).join("\n\n---\n\n").slice(0, 32000);
  if (!combined) return empty(currency);

  const extracted = await llm
    .completeJson<{ observations: RawObs[] }>({
      temperature: 0,
      maxTokens: 4000,
      messages: [
        {
          role: "system",
          content:
            "Extract product price records from marketplace research into JSON. " +
            "Include only records with a real numeric price. Do not fabricate or dedupe.",
        },
        {
          role: "user",
          content:
            `Currency: ${currency}. Extract EVERY distinct product mentioned with a price.\n` +
            `JSON: { "observations": [ { "brand", "product", "retailer", "subtype", ` +
            `"mrp" (number, optional), "price" (number, current selling price), ` +
            `"packSize" (raw, e.g. "4.2 g") } ] }\n` +
            `Use selling price (not MRP) for "price". Whole numbers, no symbols.\n\n` +
            `RESEARCH:\n${combined}`,
        },
      ],
    })
    .catch(() => ({ observations: [] as RawObs[] }));

  let obs = (extracted.observations ?? [])
    .map(normalizeObs)
    .filter((o): o is PriceObservation => o !== null);
  obs = dedupe(obs);

  const before = obs.length;
  obs = gentleClean(obs);
  const dropped = before - obs.length;

  if (obs.length < 4) {
    return { currency, observations: obs, dropped, bands: [], buckets: [], stats: null };
  }

  const buckets = buildBuckets(obs, currency);
  const bands: PriceBand[] = buckets.map((b) => ({ label: b.label, lowMinor: b.lowMinor, highMinor: b.highMinor }));
  const stats = computeStats(obs);
  return { currency, observations: obs, dropped, bands, buckets, stats };
}

// ---- extraction / normalization ----
interface RawObs {
  brand?: unknown;
  product?: unknown;
  retailer?: unknown;
  subtype?: unknown;
  mrp?: unknown;
  price?: unknown;
  packSize?: unknown;
}

function normalizeObs(r: RawObs): PriceObservation | null {
  const price = num(r.price);
  if (!price || price < 5) return null;
  const grams = parseGrams(str(r.packSize));
  return {
    brand: str(r.brand).slice(0, 60),
    product: str(r.product).slice(0, 120),
    retailer: r.retailer ? str(r.retailer).slice(0, 40) : undefined,
    subtype: r.subtype ? str(r.subtype).slice(0, 30) : undefined,
    mrp: num(r.mrp) || undefined,
    price,
    packSize: r.packSize ? str(r.packSize).slice(0, 40) : undefined,
    grams: grams || undefined,
    pricePerGram: grams ? round2(price / grams) : undefined,
  };
}

function parseGrams(s: string): number {
  if (!s) return 0;
  const m = s.match(/([\d.]+)\s*(g|gram|grams|ml|oz)/i);
  if (!m) return 0;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return m[2]!.toLowerCase() === "oz" ? round2(v * 28.35) : round2(v);
}

/**
 * Only remove rows that are almost certainly wrong: non-positive, or extreme
 * relative to the ROBUST center (MAD), and only when the sample is large enough
 * that trimming won't gut it. Small samples are kept intact.
 */
function gentleClean(obs: PriceObservation[]): PriceObservation[] {
  if (obs.length < 12) return obs;
  const prices = obs.map((o) => o.price).sort((a, b) => a - b);
  const med = median(prices);
  const mad = median(prices.map((v) => Math.abs(v - med))) || med * 0.5 || 1;
  // Generous bound (6 MAD) — only true absurdities (e.g. a 24-pack carton).
  return obs.filter((o) => Math.abs(o.price - med) <= 6 * mad);
}

// ---- dynamic buckets ----
function buildBuckets(obs: PriceObservation[], currency: string): PriceBucket[] {
  const clusters = dynamicClusters(obs.map((o) => o.price), 5, Math.max(2, Math.floor(obs.length * 0.08)));
  const labels = tierLabels(clusters.length);
  const total = obs.length;
  return clusters.map((c, i) => {
    const inRange = obs.filter((o) => o.price >= c.min && o.price <= c.max);
    const pgs = inRange.map((o) => o.pricePerGram).filter((v): v is number => v != null);
    return {
      label: labels[i] ?? `tier-${i + 1}`,
      lowMinor: Math.round(c.min) * 100,
      highMinor: Math.round(c.max) * 100,
      count: c.members.length,
      share: round2(c.members.length / total),
      medianPerGram: pgs.length ? round2(median(pgs.sort((a, b) => a - b))) : undefined,
      examples: inRange
        .sort((a, b) => a.price - b.price)
        .slice(0, 3)
        .map((o) => `${o.brand} ${o.product}`.trim().slice(0, 40) + ` ${currency}${o.price}`),
    };
  });
}

function computeStats(obs: PriceObservation[]): PriceStats {
  const sorted = obs.map((o) => o.price).sort((a, b) => a - b);
  const q = (p: number) => sorted[clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1)]!;
  const pg = obs.map((o) => o.pricePerGram).filter((v): v is number => v != null).sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0]!,
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    max: sorted[sorted.length - 1]!,
    medianPerGram: pg.length ? round2(median(pg)) : undefined,
  };
}

// ---- helpers ----
function empty(currency: string): PriceIntel {
  return { currency, observations: [], dropped: 0, bands: [], buckets: [], stats: null };
}
function dedupe(obs: PriceObservation[]): PriceObservation[] {
  const seen = new Set<string>();
  const out: PriceObservation[] = [];
  for (const o of obs) {
    const key = `${o.brand.toLowerCase()}|${o.product.toLowerCase()}|${o.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}
function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}
function num(v: unknown): number {
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}
function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
