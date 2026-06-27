import type { BlindCard, BrandConcept } from "../brand/types.ts";
import type { BenchmarkBrand, CompetitorArchetype } from "../categories/types.ts";
import { normalizeLen } from "./card.ts";

// Word budgets keep all cards comparable so the buyer can't pick on verbosity.
const HEAD = 12, BODY = 40;

export function cardFromConcept(c: BrandConcept, label: string): BlindCard {
  const headline = normalizeLen(c.landingHeadline || c.tagline || c.positioning, HEAD);
  // Candidate keeps its brand voice (no pretraining footprint to leak).
  const body = normalizeLen(`${c.positioning}. ${c.productPromise}`, BODY);
  const card: BlindCard = {
    label, headline, body, claims: c.claims.slice(0, 5),
    format: c.heroSku, priceMinor: c.priceMinor,
  };
  return card;
}

export function cardFromArchetype(
  a: CompetitorArchetype,
  label: string,
  priceMinor: number,
): BlindCard {
  // Competitor: NEUTRAL register (paraphrase description), so a signature voice
  // can't de-anonymize a real brand. Use the archetype description as a plain claim.
  const headline = normalizeLen(a.description, HEAD);
  const body = normalizeLen(`${a.description} Positioning: ${a.pricePositioning}.`, BODY);
  const card: BlindCard = {
    label, headline, body, claims: a.claims.slice(0, 5),
    format: "standard", priceMinor,
  };
  return card;
}

export function cardFromBenchmark(b: BenchmarkBrand, label: string): BlindCard {
  // Disguise a real anchor brand: read ONLY safe fields (claims/format/priceMinor).
  // realName/tractionScore/reviewCount/rating/retailer are AUDIT-ONLY and must
  // never reach the buyer — the blind-control guarantee of the methodology.
  const headline = normalizeLen(b.claims[0] ?? "Established option", HEAD);
  const body = normalizeLen(b.claims.join(". "), BODY);
  const card: BlindCard = {
    label, headline, body, claims: b.claims.slice(0, 5),
    format: b.format, priceMinor: b.priceMinor,
  };
  return card;
}
