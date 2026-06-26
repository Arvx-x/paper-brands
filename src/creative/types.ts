import { z } from "zod";

/**
 * Creative Factory domain types. These are to visuals what CategoryPack /
 * BrandConcept are to strategy: a structured "operating model" (BrandKit) plus
 * the unit that competes and gets optimized (CreativeSpec -> RenderedCreative).
 */

/** Asset types the factory can produce, each with a sane default aspect ratio. */
export const ASSET_PRESETS: Record<string, { aspect: string; note: string }> = {
  logo: { aspect: "1:1", note: "primary mark on a clean background, scalable, memorable" },
  packaging: { aspect: "4:5", note: "product packaging mockup, front-of-pack, retail-ready" },
  "product-hero": { aspect: "1:1", note: "studio product shot, premium lighting, clean backdrop" },
  "ad-square": { aspect: "1:1", note: "feed ad, thumb-stopping, single clear message" },
  "ad-portrait": { aspect: "4:5", note: "portrait feed ad, maximizes mobile real estate" },
  "ad-story": { aspect: "9:16", note: "full-bleed story/reel ad, top-and-bottom safe zones" },
  "landing-hero": { aspect: "16:9", note: "website hero banner, headline + product, generous negative space" },
  "social-post": { aspect: "1:1", note: "organic social post, on-brand, shareable" },
  banner: { aspect: "16:9", note: "display banner, legible at small sizes" },
};
export type AssetType = keyof typeof ASSET_PRESETS;

/**
 * Tolerant string: models (esp. Gemini) sometimes return a nested object where
 * a prose field was expected (e.g. artDirection: { lighting, composition }).
 * Flatten any non-string into readable text instead of hard-failing the parse.
 */
export const FlexString = z.preprocess((v) => {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`)
      .join(". ");
  }
  return String(v);
}, z.string());

export const SwatchSchema = z.object({
  name: z.string(),
  hex: z.string(),
  role: z.string().describe("primary | secondary | accent | neutral | background"),
});

/** The visual + verbal operating model for a brand. Drives every render. */
export const BrandKitSchema = z.object({
  brandId: z.string(),
  brandName: z.string(),
  /** One-line essence the whole look should ladder back to. */
  essence: FlexString,
  palette: z.array(SwatchSchema),
  typography: z.object({
    headingMood: FlexString,
    bodyMood: FlexString,
    pairing: FlexString.describe("concrete pairing direction, e.g. 'grotesque + humanist serif'"),
  }),
  /** Photography / illustration style, lighting, composition language. */
  artDirection: FlexString,
  moodKeywords: z.array(z.string()),
  logoDirection: FlexString,
  packagingDirection: FlexString,
  voice: z.object({
    tone: FlexString,
    doSay: z.array(z.string()),
    dontSay: z.array(z.string()),
  }),
  /** Visual do's and don'ts — fed verbatim into prompts and the jury rubric. */
  visualDos: z.array(z.string()),
  visualDonts: z.array(z.string()),
  /** Global negative prompt appended to every image generation. */
  negativePrompt: z.string(),
  /** What competitor creatives do well / overuse — distilled from research. */
  competitiveNotes: z.array(z.string()),
});
export type BrandKit = z.infer<typeof BrandKitSchema>;

/** A request for one creative — the "territory" analog. */
export const CreativeBriefSchema = z.object({
  id: z.string(),
  assetType: z.string(),
  purpose: FlexString.describe("the job this creative does, e.g. 'cold-traffic awareness'"),
  audience: FlexString,
  channel: FlexString,
  bigIdea: FlexString.describe("the single concept the visual expresses"),
  mustInclude: z.array(z.string()).default([]),
});
export type CreativeBrief = z.infer<typeof CreativeBriefSchema>;

/** A fully-specified creative — the unit that renders, gets scored, and optimized. */
export const CreativeSpecSchema = z.object({
  id: z.string(),
  briefId: z.string(),
  assetType: z.string(),
  aspect: z.string(),
  headline: FlexString,
  subhead: FlexString.default(""),
  cta: FlexString.default(""),
  /** Composition / layout description (where elements sit, hierarchy). */
  layout: FlexString,
  /** The prompt sent to the image model — concrete, brand-faithful, render-ready. */
  imagePrompt: FlexString,
  /** Art-direction detail — what separates a world-class render from a stock one. */
  subject: FlexString.default("").describe("the hero subject and how it's styled/posed"),
  camera: FlexString.default("").describe("shot type, lens, angle, depth of field"),
  lighting: FlexString.default("").describe("lighting setup, direction, quality, time of day"),
  colorGrade: FlexString.default("").describe("palette emphasis, contrast, film/grade reference"),
  composition: FlexString.default("").describe("framing, hierarchy, negative space, rule of thirds"),
  texture: FlexString.default("").describe("materials, surface finish, tactile detail"),
  mood: FlexString.default("").describe("emotional register the image should evoke"),
  typographyTreatment: FlexString.default("").describe("how in-image text is set and placed"),
  /** Spec-specific negative prompt (merged with the BrandKit's global one). */
  negativePrompt: FlexString.default(""),
  rationale: FlexString.default(""),
});
export type CreativeSpec = z.infer<typeof CreativeSpecSchema>;

/** A spec plus the artifact it rendered to. */
export interface RenderedCreative {
  spec: CreativeSpec;
  imagePath: string;
  model: string;
  promptUsed: string;
}

/** The jury's multimodal verdict on one rendered creative (0..10 per axis). */
export const JuryScoreSchema = z.object({
  visualQuality: z.number(),
  brandConsistency: z.number(),
  messageClarity: z.number(),
  conversionPotential: z.number(),
  differentiation: z.number(),
});
export const JuryVerdictSchema = z.object({
  scores: JuryScoreSchema,
  /** Weighted aggregate, 0..100 — the optimizer's objective. */
  overall: z.number(),
  critique: z.string(),
  fixes: z.array(z.string()).default([]),
});
export type JuryVerdict = z.infer<typeof JuryVerdictSchema>;

/** Default rubric weights (sum to 1). */
export const JURY_WEIGHTS = {
  visualQuality: 0.3,
  brandConsistency: 0.25,
  messageClarity: 0.2,
  conversionPotential: 0.15,
  differentiation: 0.1,
} as const;

export function aggregateScore(s: z.infer<typeof JuryScoreSchema>): number {
  const w = JURY_WEIGHTS;
  const raw =
    s.visualQuality * w.visualQuality +
    s.brandConsistency * w.brandConsistency +
    s.messageClarity * w.messageClarity +
    s.conversionPotential * w.conversionPotential +
    s.differentiation * w.differentiation;
  return Math.round(raw * 10 * 10) / 10; // 0..10 weighted -> 0..100, 1 dp
}

export function assetAspect(assetType: string): string {
  return ASSET_PRESETS[assetType]?.aspect ?? "1:1";
}

export function brandSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
