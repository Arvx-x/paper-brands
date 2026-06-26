import { openaiResearch } from "./openaiSearch.ts";
import type { PriceBand } from "../categories/types.ts";

export interface PriceObservation {
  brand: string;
  product: string;
  packSize?: string;
  price: number; // whole currency units
}

export interface PriceIntel {
  currency: string;
  observations: PriceObservation[];
  bands: PriceBand[];
}

/**
 * Pull REAL current marketplace prices for a category and derive price bands
 * from observed-price percentiles — instead of letting the strategy model
 * hallucinate bands (which produced insane numbers like "premium = ₹8").
 */
export async function gatherPriceIntel(
  category: string,
  geography: string,
  currency: string,
): Promise<PriceIntel> {
  const system =
    "You are a marketplace pricing analyst. Use live web results from Amazon, " +
    "Flipkart, Nykaa, and brand sites to list REAL, currently-sold products with " +
    "their CURRENT selling price. Do not invent prices. Prefer the standard single-" +
    "unit pack. End your answer with a fenced ```json array of " +
    `{ "brand", "product", "packSize", "price" } where price is a number in ${currency} ` +
    "(whole units, no symbols).";

  const query =
    `List 20-30 currently-sold ${category} products in ${geography} with their ` +
    `current ${currency} price (single-unit pack). Cover the full range from the ` +
    `cheapest mass options to the most premium. Return the JSON array at the end.`;

  const res = await openaiResearch(query, system).catch(() => null);
  const observations = res ? parseObservations(res.content, currency) : [];
  const prices = observations.map((o) => o.price).filter((p) => p > 0).sort((a, b) => a - b);
  const bands = prices.length >= 4 ? bandsFromPercentiles(prices) : [];
  return { currency, observations, bands };
}

function parseObservations(content: string, currency: string): PriceObservation[] {
  const json = extractJsonArray(content);
  const out: PriceObservation[] = [];
  if (json) {
    for (const r of json) {
      const price = coerceNumber((r as Record<string, unknown>).price);
      if (!price) continue;
      out.push({
        brand: String((r as Record<string, unknown>).brand ?? "").slice(0, 60),
        product: String((r as Record<string, unknown>).product ?? "").slice(0, 120),
        packSize: (r as Record<string, unknown>).packSize
          ? String((r as Record<string, unknown>).packSize).slice(0, 40)
          : undefined,
        price,
      });
    }
  }
  // Fallback: scrape currency amounts from prose if JSON was absent/short.
  if (out.length < 4) {
    const sym = currency === "INR" ? "(?:₹|Rs\\.?|INR)" : "(?:\\$|USD|" + currency + ")";
    const re = new RegExp(`${sym}\\s?([0-9][0-9,]{1,6})`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const p = coerceNumber(m[1]);
      if (p && p >= 10) out.push({ brand: "", product: "(from text)", price: p });
    }
  }
  // De-dupe identical prices from the prose fallback noise.
  return dedupeByPrice(out);
}

/** Robust, outlier-trimmed bands from the observed price distribution. */
function bandsFromPercentiles(sorted: number[]): PriceBand[] {
  const q = (p: number) => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[idx]!;
  };
  // Trim extreme tails to avoid one mispriced bundle skewing the ladder.
  const lo = q(0.05);
  const p33 = q(0.4);
  const p66 = q(0.75);
  const hi = q(0.95);
  const round = (n: number) => Math.max(1, Math.round(n));
  const minor = (n: number) => round(n) * 100;
  return [
    { label: "mass", lowMinor: minor(lo), highMinor: minor(p33) },
    { label: "premium-mass", lowMinor: minor(p33), highMinor: minor(p66) },
    { label: "premium", lowMinor: minor(p66), highMinor: minor(hi) },
  ];
}

function extractJsonArray(content: string): unknown[] | null {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1]! : content;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function coerceNumber(v: unknown): number {
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

function dedupeByPrice(obs: PriceObservation[]): PriceObservation[] {
  const seen = new Set<string>();
  const out: PriceObservation[] = [];
  for (const o of obs) {
    const key = `${o.brand}|${o.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}
