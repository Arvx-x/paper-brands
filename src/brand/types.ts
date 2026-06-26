import { z } from "zod";

/** A fully-specified candidate brand. The unit that competes in the arena. */
export const BrandConceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  positioning: z.string(),
  targetCustomer: z.string(),
  coreInsight: z.string(),
  productPromise: z.string(),
  heroSku: z.string(),
  priceMinor: z.number(),
  priceBand: z.string(),
  tagline: z.string(),
  claims: z.array(z.string()),
  packagingDirection: z.string(),
  brandVoice: z.string(),
  landingHeadline: z.string(),
  topAdAngles: z.array(z.string()),
  objections: z.array(z.string()),
  launchRisks: z.array(z.string()),
});
export type BrandConcept = z.infer<typeof BrandConceptSchema>;

/**
 * Blind "card" shown to buyer agents in the arena. Strips the real/disguised
 * identity to a neutral OPTION-x label so neither candidate nor competitor
 * benefits from name recognition or pretraining bias.
 */
export interface BlindCard {
  label: string; // e.g. "OPTION-A"
  pitch: string; // neutral description shown to the buyer
}
