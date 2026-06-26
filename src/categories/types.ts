import { z } from "zod";

/**
 * A CategoryPack is the vertical "operating model" that makes output quality
 * high. The platform is horizontal; quality comes from these packs.
 */
export const PriceBandSchema = z.object({
  label: z.string(),
  lowMinor: z.number().describe("low end of price band in minor currency units"),
  highMinor: z.number(),
});
export type PriceBand = z.infer<typeof PriceBandSchema>;

export const CompetitorArchetypeSchema = z.object({
  /** Disguised label so the simulator never sees a real brand name. */
  codeName: z.string(),
  description: z.string(),
  pricePositioning: z.string(),
  claims: z.array(z.string()),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
});
export type CompetitorArchetype = z.infer<typeof CompetitorArchetypeSchema>;

export const CategoryPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.string(),
  geography: z.string(),
  /** Mined, recurring unmet needs phrased as customer language. */
  unmetNeeds: z.array(z.string()),
  purchaseTriggers: z.array(z.string()),
  rejectionReasons: z.array(z.string()),
  priceBands: z.array(PriceBandSchema),
  /** Disguised real-world competitors used as blind benchmarks. */
  competitorArchetypes: z.array(CompetitorArchetypeSchema),
  /** Hard constraints the brand strategist must respect. */
  complianceNotes: z.array(z.string()),
  /** Persona seeds the cohort generator expands into buyer agents. */
  buyerSegments: z.array(
    z.object({
      seed: z.string(),
      weight: z.number().describe("relative share of category demand, 0..1"),
    }),
  ),
});
export type CategoryPack = z.infer<typeof CategoryPackSchema>;
