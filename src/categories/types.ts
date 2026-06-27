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

/**
 * An EvidencedItem is a claim bound to a verbatim source quote + URL. This is
 * the core honesty primitive: a need/trigger/rejection is a HYPOTHESIS unless
 * `quote` literally appears in a fetched source (then `verified=true`). A bare
 * string is accepted and coerced (back-compat with hand-seeded packs) but lands
 * unverified — so old, unattributed packs are visibly distinct from grounded ones.
 */
export const EvidencedItemSchema = z.preprocess(
  (v) => (typeof v === "string" ? { text: v } : v),
  z.object({
    text: z.string(),
    quote: z.string().default(""),
    sourceUrl: z.string().default(""),
    verified: z.boolean().default(false),
    /** Was the matched source an independent (non-commercial) one? */
    independent: z.boolean().default(false),
  }),
);
export type EvidencedItem = z.infer<typeof EvidencedItemSchema>;

export const CompetitorArchetypeSchema = z.object({
  /** Disguised label so the simulator never sees a real brand name. */
  codeName: z.string(),
  description: z.string(),
  pricePositioning: z.string(),
  claims: z.array(z.string()),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  /** Quotes backing this archetype's claims/positioning (audit + falsifiability). */
  evidence: z.array(EvidencedItemSchema).default([]),
  /**
   * Real brands this archetype was clustered from — AUDIT-ONLY, never shown to
   * the blind arena. Makes each archetype falsifiable against real SKUs.
   */
  realExamples: z.array(z.string()).default([]),
});
export type CompetitorArchetype = z.infer<typeof CompetitorArchetypeSchema>;

/**
 * Provenance + confidence stamped onto every pack so a thin, ungrounded pack is
 * never mistaken for a well-evidenced one. Optional for backward-compat with
 * older hand-seeded packs; agents now always populate it.
 */
export const ProvenanceSchema = z.object({
  grounded: z.boolean().default(false),
  harvestedAt: z.string().optional(),
  corpusHash: z.string().optional(),
  lensesPlanned: z.number().default(0),
  lensesSucceeded: z.number().default(0),
  /** Lenses that returned zero findings (e.g. the complaints/negative lens). */
  missingLenses: z.array(z.string()).default([]),
  /** Distinct real source domains (after fetch + redirect resolution). */
  distinctDomains: z.number().default(0),
  /** Distinct INDEPENDENT domains (community/editorial/regulator). */
  independentDomains: z.number().default(0),
  /** Sources we fetched raw quotable text for. */
  fetchedSources: z.number().default(0),
  /** Source counts per incentive-class. */
  sourceClassCounts: z.record(z.string(), z.number()).default({}),
  /** Raw citation count before domain dedup (headline number; usually inflated). */
  citationCountRaw: z.number().default(0),
  /** Fraction of emitted claims that pass BOTH containment AND entailment. */
  attributionRate: z.number().default(0),
  attributedItems: z.number().default(0),
  totalItems: z.number().default(0),
  /** Verified items whose quote came from an independent (non-commercial) source. */
  independentItems: z.number().default(0),
  /** Independent model that judged quote→claim entailment (principle 13). */
  verifierModel: z.string().optional(),
  skuCount: z.number().default(0),
  providersUsed: z.array(z.string()).default([]),
  /** True when evidence was character-truncated before the pack saw it. */
  truncated: z.boolean().default(false),
  /** True when coverage fell below threshold or a negative-evidence lens was empty. */
  degraded: z.boolean().default(false),
  model: z.string().optional(),
  confidence: z.enum(["low", "medium", "high"]).default("low"),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const CategoryPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: z.string(),
  geography: z.string(),
  /** Mined unmet needs, each bound to a source quote. May be empty (honest). */
  unmetNeeds: z.array(EvidencedItemSchema),
  /**
   * Needs incumbents already serve well — the honest counterweight to unmetNeeds
   * so the council cannot manufacture a gap where the market is saturated.
   */
  wellMetNeeds: z.array(EvidencedItemSchema).default([]),
  purchaseTriggers: z.array(EvidencedItemSchema),
  rejectionReasons: z.array(EvidencedItemSchema),
  priceBands: z.array(PriceBandSchema),
  /** Disguised real-world competitors used as blind benchmarks. */
  competitorArchetypes: z.array(CompetitorArchetypeSchema),
  /** Hard constraints the brand strategist must respect. */
  complianceNotes: z.array(z.string()),
  /**
   * Need/job-based buyer segments the cohort generator expands into agents.
   * Weights are honest ESTIMATES grounded in the observed market signal
   * (price-tier + subtype shares), NOT fabricated demand shares — `basis` records
   * what each weight is derived from so it is never mistaken for measured demand.
   */
  buyerSegments: z.array(
    z.object({
      seed: z.string().describe("need/job-to-be-done based segment (NOT a demographic age band)"),
      weight: z.number().describe("estimated relative share, 0..1 (supply-proxy estimate)"),
      basis: z.string().default("").describe("what the weight is derived from (evidence/market signal)"),
    }),
  ),
  /** Evidence provenance + confidence. Optional for old packs; always set now. */
  provenance: ProvenanceSchema.optional(),
});
export type CategoryPack = z.infer<typeof CategoryPackSchema>;
