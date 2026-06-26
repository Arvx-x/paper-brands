import { multiResearch } from "./research.ts";
import { LLMClient } from "../llm/client.ts";
import { dynamicClusters, tierLabels } from "./cluster.ts";
import type { PriceBand } from "../categories/types.ts";
import type { UnitOfMeasure } from "../intel/plan.ts";

export interface PriceObservation {
  brand: string;
  product: string;
  retailer?: string;
  mrp?: number;
  price: number; // current selling price, whole currency
  packSize?: string;
  /** Quantity in the category's unit of measure (g, ml, count, serving, ...). */
  unitQty?: number;
  /** Price per single unit-of-measure (e.g. per g, per serving). */
  pricePerUnit?: number;
  subtype?: string; // e.g. tinted, medicated — model-tagged from plan subtypes
}

export interface PriceBucket extends PriceBand {
  share: number; // fraction of SKUs in this bucket
  count: number;
  medianPerUnit?: number;
  examples: string[];
}

export interface PriceStats {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  medianPerUnit?: number;
}

export interface PriceIntel {
  currency: string;
  /** Display label for the per-unit metric, e.g. "g", "serving", "" if none. */
  unit: string;
  observations: PriceObservation[];
  dropped: number;
  bands: PriceBand[]; // dynamic count, for CategoryPack
  buckets: PriceBucket[]; // richer, with share/examples
  stats: PriceStats | null;
}

export interface PriceIntelOptions {
  retailers?: string[];
  subtypes?: string[];
  unitOfMeasure?: UnitOfMeasure;
}

const NONE_UOM: UnitOfMeasure = { kind: "none", unit: "unit", aliases: [] };

/**
 * Layered, multi-provider price discovery with DYNAMIC buckets. Category-blind:
 * retailers, sub-segments, and the value unit-of-measure are supplied by the
 * ResearchPlan (weight for creams, servings for supplements, count for
 * capsules, none for single-unit goods) — never hardcoded.
 *  1) fan out many queries (tiers x retailers x sub-segments) across providers
 *  2) consolidate into structured records with a strict JSON pass
 *  3) normalize pack size -> price-per-unit (only when the category has a unit)
 *  4) gently drop only absurd rows (never nuke small samples)
 *  5) CLUSTER prices to discover the natural number of tiers
 */
export async function gatherPriceIntel(
  category: string,
  geography: string,
  currency: string,
  opts: PriceIntelOptions = {},
  llm = new LLMClient(),
): Promise<PriceIntel> {
  const uom = opts.unitOfMeasure ?? NONE_UOM;
  const geo = geography ? ` in ${geography}` : "";
  const retailers = (opts.retailers?.length
    ? opts.retailers
    : ["major online marketplaces", "category specialist retailers", "brand websites"]
  ).join(", ");
  const subtypeHint = opts.subtypes?.length ? ` (e.g. ${opts.subtypes.join(", ")})` : "";
  const sizeHint =
    uom.kind === "none" ? "" : ` and pack ${uom.kind === "count" ? "count" : "size"}`;

  const angles = [
    `cheapest budget ${category}${geo} with current ${currency} price${sizeHint} (${retailers})`,
    `most popular best-selling ${category}${geo} with current ${currency} price${sizeHint}, star rating`,
    `premium and high-end ${category}${geo} with current ${currency} price${sizeHint}`,
    `full ${category} price list${geo}: as many distinct SKUs as possible with MRP, current price${sizeHint}`,
    `different types/variants of ${category}${geo}${subtypeHint} with prices${sizeHint}`,
    `new and trending ${category}${geo} launched recently with price${sizeHint}`,
  ];

  const system =
    `You are a marketplace pricing analyst. Use live listings (${retailers}). ` +
    `Report REAL current selling prices` +
    (sizeHint ? ` and pack sizes` : "") +
    ` — never invent. Cover the FULL range from cheapest to most premium. ` +
    `Include brand, product, retailer, MRP, current price` +
    (sizeHint ? `, pack size` : "") +
    (opts.subtypes?.length ? `, and a short type tag (one of: ${opts.subtypes.join(", ")}, or other)` : "") +
    `.`;

  const texts = (
    await Promise.all(
      angles.map((q) => multiResearch(q, system).then((r) => r.content).catch(() => "")),
    )
  ).filter(Boolean);
  if (!texts.length) return empty(currency, uom.unit);

  // Extract per-angle, not from one giant concatenation: a single 4k-token pass
  // over 32k chars silently drops most SKUs in later angles. Per-angle + merge
  // recovers them. (Observed: single-pass yielded 5 SKUs from text with dozens.)
  const perAngle = await Promise.all(texts.map((t) => extractObservations(llm, t, currency)));
  let obs = perAngle
    .flat()
    .map((r) => normalizeObs(r, uom))
    .filter((o): o is PriceObservation => o !== null);
  obs = dedupe(obs);

  const before = obs.length;
  obs = gentleClean(obs);
  const dropped = before - obs.length;

  if (obs.length < 4) {
    return { currency, unit: uom.unit, observations: obs, dropped, bands: [], buckets: [], stats: null };
  }

  const buckets = buildBuckets(obs, currency);
  const bands: PriceBand[] = buckets.map((b) => ({ label: b.label, lowMinor: b.lowMinor, highMinor: b.highMinor }));
  const stats = computeStats(obs);
  return { currency, unit: uom.unit, observations: obs, dropped, bands, buckets, stats };
}

/**
 * Extract price records from ONE research text. Run per-angle and merged so no
 * SKU is lost to a single call's token budget. Pack size is captured verbatim
 * whenever any size/quantity appears (it is the basis for per-unit value).
 */
async function extractObservations(llm: LLMClient, text: string, currency: string): Promise<RawObs[]> {
  const r = await llm
    .completeJson<{ observations: RawObs[] }>({
      temperature: 0,
      maxTokens: 4000,
      messages: [
        {
          role: "system",
          content:
            "Extract product price records from marketplace research into JSON. " +
            "Capture EVERY distinct product that has a real numeric price. Do not " +
            "fabricate, do not dedupe, do not summarise.",
        },
        {
          role: "user",
          content:
            `Currency: ${currency}. Extract EVERY distinct product with a price from the text.\n` +
            `JSON: { "observations": [ { "brand", "product", "retailer", "subtype", ` +
            `"mrp" (number, optional), "price" (number, current selling price), ` +
            `"packSize" } ] }\n` +
            `packSize: copy the size/quantity EXACTLY as written whenever it appears ` +
            `(e.g. "17 gm", "4.2 g", "250 ml", "60 capsules"); use "" only if truly absent.\n` +
            `Use selling price (not MRP) for "price". Whole numbers, no symbols.\n\n` +
            `TEXT:\n${text.slice(0, 12000)}`,
        },
      ],
    })
    .catch(() => ({ observations: [] as RawObs[] }));
  return r.observations ?? [];
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

function normalizeObs(r: RawObs, uom: UnitOfMeasure): PriceObservation | null {
  const price = num(r.price);
  if (!price || price < 5) return null;
  const qty = parsePackSize(str(r.packSize), uom);
  return {
    brand: str(r.brand).slice(0, 60),
    product: str(r.product).slice(0, 120),
    retailer: r.retailer ? str(r.retailer).slice(0, 40) : undefined,
    subtype: r.subtype ? str(r.subtype).slice(0, 30) : undefined,
    mrp: num(r.mrp) || undefined,
    price,
    packSize: r.packSize ? str(r.packSize).slice(0, 40) : undefined,
    unitQty: qty || undefined,
    pricePerUnit: qty ? round2(price / qty) : undefined,
  };
}

const DEFAULT_ALIASES: Record<string, string[]> = {
  weight: ["g", "gram", "grams", "kg", "oz", "lb"],
  volume: ["ml", "l", "litre", "liter", "fl oz", "oz"],
  count: ["pack", "count", "ct", "pcs", "pc", "piece", "pieces", "capsule", "capsules", "tablet", "tablets", "sachet", "sachets"],
  serving: ["serving", "servings", "scoop", "scoops", "dose", "doses"],
  duration: ["day", "days", "week", "weeks", "month", "months", "wash", "washes", "use", "uses"],
  none: [],
};

/** Extract a quantity in the category's unit of measure from a raw pack string. */
function parsePackSize(s: string, uom: UnitOfMeasure): number {
  if (!s || uom.kind === "none") return 0;
  // UNION the kind's defaults with any agent-supplied aliases and the canonical
  // unit — a partial agent list (e.g. ["grams"] missing bare "g") must never
  // shadow the defaults, or most pack sizes like "10 g" silently fail to parse.
  const aliases = Array.from(
    new Set([...(DEFAULT_ALIASES[uom.kind] ?? []), ...uom.aliases, uom.unit].filter(Boolean)),
  );
  if (!aliases.length) return 0;
  // Longer aliases first so "grams" wins over "g".
  const sorted = [...aliases].sort((a, b) => b.length - a.length).map(esc);
  const m = s.match(new RegExp(`([\\d.]+)\\s*(${sorted.join("|")})`, "i"));
  if (!m) return 0;
  let v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const tok = m[2]!.toLowerCase();
  if (uom.kind === "weight") {
    if (tok === "kg") v *= 1000;
    else if (tok === "oz") v *= 28.35;
    else if (tok === "lb") v *= 453.6;
  } else if (uom.kind === "volume") {
    if (tok === "l" || tok === "litre" || tok === "liter") v *= 1000;
    else if (tok === "oz" || tok === "fl oz") v *= 29.57;
  }
  return round2(v);
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove only TRUE absurdities (data-entry errors, multipack cartons), NEVER
 * the real premium/budget tails — those tails ARE the price distribution and
 * are the whole point of deriving price bands. Prices are positively skewed, so
 * a symmetric MAD rule collapses when a budget segment clusters tightly and then
 * nukes legitimate premium SKUs (observed: 6*MAD dropped 15 of 20, including a
 * real ₹229 SKU). We bound MULTIPLICATIVELY around the median and refuse to drop
 * more than 15% — if the bound would gut the sample, keep everything.
 */
function gentleClean(obs: PriceObservation[]): PriceObservation[] {
  if (obs.length < 6) return obs;
  const med = median(obs.map((o) => o.price).sort((a, b) => a - b));
  if (med <= 0) return obs;
  const kept = obs.filter((o) => o.price <= med * 10 && o.price >= med / 10);
  return kept.length >= obs.length * 0.85 ? kept : obs;
}

// ---- dynamic buckets ----
function buildBuckets(obs: PriceObservation[], currency: string): PriceBucket[] {
  // Below a meaningful sample, do NOT split into >2 tiers — silhouette will
  // happily carve a continuous price gradient into noise (observed: 5 SKUs ->
  // two meaningless ~₹120 "tiers"). Require a real per-tier floor too.
  const maxK = obs.length < 12 ? 2 : 5;
  const minMembers = Math.max(3, Math.floor(obs.length * 0.12));
  const clusters = dynamicClusters(obs.map((o) => o.price), maxK, minMembers);
  const labels = tierLabels(clusters.length);
  const total = obs.length;
  return clusters.map((c, i) => {
    const inRange = obs.filter((o) => o.price >= c.min && o.price <= c.max);
    const pus = inRange.map((o) => o.pricePerUnit).filter((v): v is number => v != null);
    return {
      label: labels[i] ?? `tier-${i + 1}`,
      lowMinor: Math.round(c.min) * 100,
      highMinor: Math.round(c.max) * 100,
      count: c.members.length,
      share: round2(c.members.length / total),
      medianPerUnit: pus.length ? round2(median(pus.sort((a, b) => a - b))) : undefined,
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
  const pu = obs.map((o) => o.pricePerUnit).filter((v): v is number => v != null).sort((a, b) => a - b);
  // Only report a per-unit median when a MAJORITY of SKUs actually parsed a
  // quantity — otherwise it is a fabricated statistic over a biased minority.
  const perUnitCovered = pu.length >= Math.max(4, Math.ceil(sorted.length * 0.5));
  return {
    n: sorted.length,
    min: sorted[0]!,
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    max: sorted[sorted.length - 1]!,
    medianPerUnit: perUnitCovered ? round2(median(pu)) : undefined,
  };
}

// ---- helpers ----
function empty(currency: string, unit: string): PriceIntel {
  return { currency, unit, observations: [], dropped: 0, bands: [], buckets: [], stats: null };
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
