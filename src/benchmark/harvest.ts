import type { PriceObservation } from "../scrape/prices.ts";
import type { PriceBand, BenchmarkBrand } from "../categories/types.ts";
import { selectBenchmarks, tractionScore, type BrandSku } from "./traction.ts";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function bandFor(priceMinor: number, bands: PriceBand[]): string {
  const b = bands.find((x) => priceMinor >= x.lowMinor && priceMinor <= x.highMinor);
  return b?.label ?? bands[Math.floor(bands.length / 2)]?.label ?? "unknown";
}

/**
 * Turn scraped price observations into audit-only BenchmarkBrand anchors.
 * Returns degraded=true (and empty list) when NO observation has review data —
 * never fabricates anchors.
 */
export function benchmarksFromObservations(
  observations: PriceObservation[],
  bands: PriceBand[],
  n: number,
): { benchmarkBrands: BenchmarkBrand[]; degraded: boolean } {
  const withReviews = observations.filter((o) => (o.reviewCount ?? 0) > 0);
  if (withReviews.length === 0) return { benchmarkBrands: [], degraded: true };

  const skus: BrandSku[] = withReviews.map((o) => {
    const priceMinor = Math.round((o.price || 0) * 100);
    return {
      brand: o.brand, product: o.product, priceMinor,
      format: o.packSize ?? "standard",
      claims: o.subtype ? [o.subtype, o.product] : [o.product],
      reviewCount: o.reviewCount ?? 0, rating: o.rating ?? 0,
      retailer: o.retailer ?? "", band: bandFor(priceMinor, bands),
    };
  });

  const maxRc = Math.max(1, ...skus.map((s) => s.reviewCount));
  const picked = selectBenchmarks(skus, n);

  const benchmarkBrands: BenchmarkBrand[] = picked.map((s) => ({
    auditId: `bm-${slug(s.brand)}`,
    realName: s.brand,
    claims: s.claims,
    priceMinor: s.priceMinor,
    format: s.format,
    reviewCount: s.reviewCount,
    rating: s.rating,
    retailer: s.retailer,
    tractionScore: tractionScore(s, maxRc),
    evidence: [{
      text: `${s.brand} ${s.product}`,
      quote: `${s.reviewCount} reviews, ${s.rating} star at ${s.retailer || "retailer"}`,
      sourceUrl: "", verified: true, independent: false,
    }],
  }));

  return { benchmarkBrands, degraded: false };
}
