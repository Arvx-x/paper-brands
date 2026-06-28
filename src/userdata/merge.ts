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
