// src/userdata/merge.ts
import type { UserVoice, UserSku, UserCompetitor, UserOverrides, UserIntel } from "./types.ts";
import type { EvidenceSource } from "../intel/market.ts";
import type { PriceObservation } from "../scrape/prices.ts";
import type { CategoryPack } from "../categories/types.ts";

/**
 * Each user voice becomes a synthetic, user-provided source whose rawText IS the
 * quote. The intel containment gate then passes correctly because the user is the
 * source. Internal notes are marked non-independent so they cannot masquerade as
 * independent market voice.
 */
export function voicesToSources(voices: UserVoice[]): EvidenceSource[] {
  return voices.map((v, i) => ({
    finalUrl: `user://${encodeURIComponent(v.source)}#${i}`,
    sourceClass: "first-party",
    independent: v.independent,
    rawText: v.quote,
  }));
}

/**
 * Map user-supplied SKU rows to PriceObservation (the harvest contract).
 * Fields present on UserSku but absent from PriceObservation — tier, unitsSold,
 * marginPct — are NOT copied here. They stay on the original UserSku row and will
 * be accessible to future pipeline steps that extend PriceObservation or read
 * UserIntel directly.
 */
export function skusToObservations(skus: UserSku[]): PriceObservation[] {
  return skus.map((s) => ({
    brand: s.brand,
    product: s.product,
    price: s.price,
    mrp: s.mrp,
    packSize: s.packSize,
    unitQty: s.unitQty,
    subtype: s.subtype,
    reviewCount: s.reviewCount,
    rating: s.rating,
  }));
}

const obsKey = (o: PriceObservation): string =>
  `${o.brand.toLowerCase().trim()}|${o.product.toLowerCase().trim()}`;

/**
 * Append user observations to harvested ones, deduped by brand+product. On
 * conflict the USER row wins (they know their own / measured data); the number of
 * conflicts is returned so provenance can record it.
 */
export function mergeObservations(
  harvested: PriceObservation[],
  user: PriceObservation[],
): { merged: PriceObservation[]; conflicts: number } {
  if (!user.length) return { merged: harvested, conflicts: 0 };
  const userKeys = new Set(user.map(obsKey));
  let conflicts = 0;
  const keptHarvested = harvested.filter((o) => {
    if (userKeys.has(obsKey(o))) { conflicts++; return false; }
    return true;
  });
  return { merged: [...keptHarvested, ...user], conflicts };
}

/** Re-normalize segment weights to sum ~1.0 (whole-percent, matches intel.ts). */
function normalizeWeights<T extends { weight: number }>(segs: T[]): T[] {
  const total = segs.reduce((a, s) => a + (s.weight || 0), 0);
  if (total <= 0) return segs.map((s) => ({ ...s, weight: Math.round(100 / segs.length) / 100 }));
  return segs.map((s) => ({ ...s, weight: Math.round((s.weight / total) * 100) / 100 }));
}

/**
 * Apply hard user overrides to a built pack. Returns a NEW pack (no mutation) and
 * the list of fields actually changed, recorded in provenance. priceBands override
 * is the highest authority — it wins over harvested/recomputed bands.
 */
export function applyOverrides(
  pack: CategoryPack,
  ov: UserOverrides,
): { pack: CategoryPack; applied: string[] } {
  const applied: string[] = [];
  const next: CategoryPack = { ...pack };
  if (ov.priceBands && ov.priceBands.length) { next.priceBands = ov.priceBands; applied.push("priceBands"); }
  if (ov.buyerSegments && ov.buyerSegments.length) {
    next.buyerSegments = normalizeWeights(ov.buyerSegments.map((s) => ({ seed: s.seed, weight: s.weight, basis: "user-provided override" })));
    applied.push("buyerSegments");
  }
  if (ov.currency) { next.currency = ov.currency; applied.push("currency"); }
  return { pack: next, applied };
}

/** Compact grounding text for the brief. Real names allowed here (archetypes stay
 * disguised by the existing prompt rules); empty input => empty string. */
export function competitorsToHints(comps: UserCompetitor[]): string {
  if (!comps.length) return "";
  return (
    "USER-PROVIDED COMPETITORS (real, for grounding only — keep archetypes disguised):\n" +
    comps
      .map((c) => {
        const bits = [c.pricePositioning ? `positioning: ${c.pricePositioning}` : "",
          c.claims.length ? `claims: ${c.claims.join("; ")}` : "",
          c.strengths.length ? `strengths: ${c.strengths.join("; ")}` : "",
          c.weaknesses.length ? `weaknesses: ${c.weaknesses.join("; ")}` : ""].filter(Boolean).join(" | ");
        return `- ${c.name}${bits ? " (" + bits + ")" : ""}`;
      })
      .join("\n")
  );
}

export function summarize(intel: Omit<UserIntel, "summary">): UserIntel["summary"] {
  const overrides: string[] = [];
  if (intel.overrides.priceBands?.length) overrides.push("priceBands");
  if (intel.overrides.buyerSegments?.length) overrides.push("buyerSegments");
  if (intel.overrides.currency) overrides.push("currency");
  return { voices: intel.voices.length, skus: intel.skus.length, competitors: intel.competitors.length, overrides };
}
