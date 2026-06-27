import { test, expect } from "bun:test";
import { cardFromConcept, cardFromArchetype } from "./cardBuild.ts";
import type { BrandConcept } from "../brand/types.ts";
import type { CompetitorArchetype } from "../categories/types.ts";

const concept = {
  id: "c1", name: "X", positioning: "Clinical care", targetCustomer: "t",
  coreInsight: "i", productPromise: "Fades spots in 8 weeks", heroSku: "30ml serum",
  priceMinor: 69900, priceBand: "mid", tagline: "Spotless, gently",
  claims: ["10% niacinamide", "fragrance-free"], packagingDirection: "p",
  brandVoice: "calm clinical", landingHeadline: "Fade dark spots, gently",
  topAdAngles: [], objections: [], launchRisks: [],
} as BrandConcept;

const archetype = {
  codeName: "ALPHA", description: "Premium derm brand", pricePositioning: "premium",
  claims: ["patented complex"], strengths: [], weaknesses: [], evidence: [], realExamples: [],
} as CompetitorArchetype;

test("concept card uses landingHeadline and brand voice body", () => {
  const card = cardFromConcept(concept, "OPTION-A");
  expect(card.label).toBe("OPTION-A");
  expect(card.headline).toBe("Fade dark spots, gently");
  expect(card.priceMinor).toBe(69900);
  expect(card.claims).toContain("10% niacinamide");
});

test("competitor card is built at the given price and carries claims", () => {
  const card = cardFromArchetype(archetype, "OPTION-B", 150000);
  expect(card.priceMinor).toBe(150000);
  expect(card.claims).toContain("patented complex");
  expect(card.headline.length).toBeGreaterThan(0);
});
