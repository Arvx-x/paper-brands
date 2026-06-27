import type { BlindCard, BrandConcept } from "../brand/types.ts";
import type { CompetitorArchetype } from "../categories/types.ts";
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
