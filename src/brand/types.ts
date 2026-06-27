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
 * Blind card shown to buyer agents. Structured like a product page so the deep
 * arena can render distinct sections; `pitch` is a flat fallback for the
 * single-shot arena. Identity is reduced to a neutral OPTION-x label.
 */
export interface BlindCard {
  label: string;        // e.g. "OPTION-A"
  headline: string;
  body: string;         // positioning + promise, in brand voice (or neutral for competitors)
  claims: string[];
  format: string;
  priceMinor: number;
  pitch: string;        // flat fallback for SingleShotArena
}
