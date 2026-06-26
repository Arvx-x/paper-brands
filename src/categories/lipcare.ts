import type { CategoryPack } from "./types.ts";

/**
 * Lipcare pilot pack. Hand-seeded for v0 from category knowledge; in the full
 * system the Market Intelligence agents populate this from reviews, listings,
 * ads, and search demand. Competitor archetypes are intentionally DISGUISED
 * (no real brand names) to avoid LLM pretraining bias in the arena.
 */
export const lipcarePack: CategoryPack = {
  id: "lipcare",
  name: "Lipcare",
  currency: "INR",
  geography: "India (D2C + marketplaces)",
  unmetNeeds: [
    "Long-lasting hydration without a waxy or sticky feel",
    "Visible relief for chronically cracked/peeling lips",
    "Daytime SPF protection that does not feel greasy",
    "Tint plus genuine skincare benefit in one product",
    "Non-medicinal aesthetics even for 'treatment' strength",
  ],
  purchaseTriggers: [
    "Lips cracked/painful before an event",
    "Seasonal dryness (winter / AC exposure)",
    "Saw an aesthetic Instagram/Reel ad",
    "Dermatologist or derm-influencer recommendation",
    "Restocking a balm that ran out",
  ],
  rejectionReasons: [
    "Feels waxy, sticky, or heavy",
    "Wears off within an hour",
    "Medicinal smell or taste",
    "Looks cheap on a shelf / unflattering packaging",
    "Unclear or unbelievable claims",
  ],
  priceBands: [
    { label: "mass", lowMinor: 9900, highMinor: 19900 },
    { label: "premium-mass", lowMinor: 19900, highMinor: 39900 },
    { label: "premium", lowMinor: 39900, highMinor: 79900 },
  ],
  competitorArchetypes: [
    {
      codeName: "ARCH-COMMODITY",
      description: "Ubiquitous waxy stick balm, petrolatum-led, distributed everywhere.",
      pricePositioning: "mass",
      claims: ["moisturizes", "all-day"],
      strengths: ["cheap", "trusted", "available everywhere"],
      weaknesses: ["waxy", "no skincare credibility", "generic"],
    },
    {
      codeName: "ARCH-DERM",
      description: "Clinical barrier-repair balm with ceramides, pharmacy positioning.",
      pricePositioning: "premium-mass",
      claims: ["barrier repair", "dermatologist tested"],
      strengths: ["credible", "effective for severe dryness"],
      weaknesses: ["medicinal feel", "unexciting", "not aspirational"],
    },
    {
      codeName: "ARCH-BEAUTY-TINT",
      description: "Beauty-forward tinted balm, sensorial, influencer-driven.",
      pricePositioning: "premium",
      claims: ["tint + care", "glossy finish"],
      strengths: ["aspirational", "shareable", "repeat purchase"],
      weaknesses: ["weak treatment efficacy", "pricey", "fades fast"],
    },
    {
      codeName: "ARCH-SPF",
      description: "Outdoor sun-protection lip shield, sporty positioning.",
      pricePositioning: "premium-mass",
      claims: ["SPF 30", "sweat resistant"],
      strengths: ["clear functional benefit", "niche loyalty"],
      weaknesses: ["greasy", "narrow use case", "low everyday pull"],
    },
  ],
  complianceNotes: [
    "Cosmetic claims only unless registered as a drug; avoid 'heals' / 'cures'.",
    "SPF claims require substantiation and correct labelling.",
    "Ingredient callouts must match the actual formulation INCI.",
  ],
  buyerSegments: [
    { seed: "Chronic dry-lips sufferer seeking real relief", weight: 0.22 },
    { seed: "Beauty enthusiast who values aesthetics and tint", weight: 0.2 },
    { seed: "Ingredient-conscious minimalist skincare buyer", weight: 0.16 },
    { seed: "Budget marketplace buyer optimizing price", weight: 0.16 },
    { seed: "Derm-recommendation seeker for severe dryness", weight: 0.12 },
    { seed: "Outdoor/SPF-aware active user", weight: 0.08 },
    { seed: "Male grooming buyer wanting no-shine repair", weight: 0.06 },
  ],
};

export const packs: Record<string, CategoryPack> = {
  lipcare: lipcarePack,
};
