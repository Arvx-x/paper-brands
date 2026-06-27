import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { CREATIVE_COUNCIL_SPECS } from "./agents.ts";
import { JURY_WEIGHTS } from "./types.ts";

/**
 * GenStructure is the WHOLE generation pipeline expressed as data, so we can
 * optimize the pipeline itself — not just individual creatives. Everything that
 * shapes output quality (how the brief is specified, how the image prompt is
 * assembled, who judges it and how) lives here, versioned, so each meta-iteration
 * is a tracked, reversible change with a before/after we can score and compare.
 *
 * v1 (`defaultStructure`) encodes the current known-good behaviour exactly, so
 * the hill-climb starts from a baseline that does not regress.
 */

export const SpecFieldSchema = z.object({
  key: z.string(),
  instruction: z.string(),
});

export const RubricAxisSchema = z.object({
  key: z.string(),
  weight: z.number(),
  guidance: z.string(),
});

export const GateSchema = z.object({
  axis: z.string(),
  /** Score (0..10) below which the cap applies. */
  threshold: z.number(),
  /** Ceiling (0..100) imposed on the aggregate when the axis is below threshold. */
  cap: z.number(),
});

export const JudgeSchema = z.object({
  name: z.string(),
  emphasis: z.string(),
});

export const AgentRoleSchema = z.object({
  role: z.string(),
  charter: z.string(),
});

export const GenStructureSchema = z.object({
  version: z.number(),
  parentVersion: z.number().nullable().default(null),
  changelog: z.string().default("baseline"),

  // ── Brief / spec stage ──────────────────────────────────────────────────
  /** Art-direction fields the council must fill for each creative. */
  specFields: z.array(SpecFieldSchema),
  /** The Prompt Engineer's framing instruction (how to think about the creative). */
  specSystem: z.string(),

  // ── Image-prompt assembly ───────────────────────────────────────────────
  /**
   * Template assembled into the final image prompt. Placeholders:
   * {assetType} {aspect} {brandName} {brandSystem} {imagePrompt} {direction} {text} {negatives}
   */
  promptTemplate: z.string(),
  /** Craft directives appended near the end of the prompt. */
  directives: z.array(z.string()),
  /** Global negatives merged with the kit/spec negatives. */
  negatives: z.array(z.string()),

  // ── Council ─────────────────────────────────────────────────────────────
  council: z.array(AgentRoleSchema),

  // ── Jury ────────────────────────────────────────────────────────────────
  judges: z.array(JudgeSchema),
  rubric: z.array(RubricAxisSchema),
  gates: z.array(GateSchema),
});
export type GenStructure = z.infer<typeof GenStructureSchema>;

/** v1 — the current, known-good generation behaviour, expressed as data. */
export function defaultStructure(): GenStructure {
  return GenStructureSchema.parse({
    version: 1,
    parentVersion: null,
    changelog: "baseline: current v3 generation behaviour",

    specFields: [
      { key: "subject", instruction: "the hero and exactly how it's styled, posed, and placed" },
      { key: "camera", instruction: "shot type, specific lens (e.g. 85mm), angle, depth of field/bokeh" },
      { key: "lighting", instruction: "setup, direction, quality (soft/hard), time of day, any rim/fill" },
      { key: "colorGrade", instruction: "which BrandKit hex dominate, contrast, a film/grade reference" },
      { key: "composition", instruction: "framing, focal hierarchy, negative space, where text sits" },
      { key: "texture", instruction: "materials and surface finish (matte, dewy, ceramic, paper grain)" },
      { key: "mood", instruction: "the single emotion it must evoke" },
      { key: "typographyTreatment", instruction: "how the headline/subhead/CTA are set and positioned" },
    ],
    specSystem:
      "Direct ONE award-winning creative for a state-of-the-art image model — the kind of work " +
      "that wins Cannes Lions, not a stock template. Think like a top art director shooting an " +
      "editorial campaign.",

    promptTemplate: [
      `Art-direct and render an award-winning {assetType} ({aspect}) for "{brandName}" —`,
      `editorial campaign quality, the kind of work that wins design awards. Not a stock template.`,
      ``,
      `BRAND SYSTEM (obey strictly):`,
      `{brandSystem}`,
      ``,
      `CREATIVE DIRECTION:`,
      `{imagePrompt}`,
      `{direction}`,
      ``,
      `IN-IMAGE TEXT — render crisp, kerned, correctly spelled, integrated into the design: {text}`,
      ``,
      `{directives} Avoid: {negatives}.`,
    ].join("\n"),
    directives: [
      "Photorealistic finish where applicable, flawless craft, intentional negative space, magazine-grade polish.",
    ],
    negatives: [],

    council: CREATIVE_COUNCIL_SPECS.map((s) => ({ role: s.role, charter: s.charter })),

    judges: [
      { name: "Awwwards-level Art Director", emphasis: "craft, composition, lighting realism, and whether it looks like an award-winning editorial campaign — ruthless about AI/stock/template tells" },
      { name: "Brand Guardian", emphasis: "fidelity to the BrandKit: exact palette, type mood, voice, logo usage, do/don't lists" },
      { name: "Growth Marketer", emphasis: "scroll-stopping power, message clarity in under a second, conversion intent on the target channel" },
      { name: "Typography & Detail Critic", emphasis: "in-image text spelling/kerning/legibility/hierarchy, and artifacts (warped edges, extra fingers, mushy logos, plastic skin)" },
      { name: "Market Realism & Casting Director", emphasis: "whether casting/styling/setting authentically fit the target market and its real diversity; foreign stand-ins or a single stereotyped skin tone are serious failures" },
      { name: "Common-sense Skeptic", emphasis: "the gut check a smart outsider has: does anything look wrong, implausible, tone-deaf, or try-hard? would a real person in this market relate?" },
    ],
    rubric: [
      { key: "visualQuality", weight: JURY_WEIGHTS.visualQuality, guidance: "craft, polish, composition, lighting, finish; penalize AI/stock tells hard" },
      { key: "brandConsistency", weight: JURY_WEIGHTS.brandConsistency, guidance: "exact adherence to the BrandKit (palette hex, type mood, logo/product form, voice)" },
      { key: "marketFit", weight: JURY_WEIGHTS.marketFit, guidance: "authentic casting/styling/setting for the target market and its real diversity" },
      { key: "messageClarity", weight: JURY_WEIGHTS.messageClarity, guidance: "single idea legible in under a second; text spelled & kerned correctly" },
      { key: "conversionPotential", weight: JURY_WEIGHTS.conversionPotential, guidance: "would the target audience actually stop and act" },
      { key: "differentiation", weight: JURY_WEIGHTS.differentiation, guidance: "unmistakably this brand, not a generic category creative" },
    ],
    gates: [
      { axis: "marketFit", threshold: 5, cap: 50 },
      { axis: "brandConsistency", threshold: 5, cap: 55 },
      { axis: "visualQuality", threshold: 4, cap: 45 },
    ],
  });
}

/** Apply a GenStructure's rubric weights + gates to a set of 0..10 axis scores. */
export function scoreWith(structure: GenStructure, scores: Record<string, number>): number {
  let overall = 0;
  for (const axis of structure.rubric) overall += (scores[axis.key] ?? 0) * axis.weight;
  overall *= 10; // weighted 0..10 -> 0..100
  for (const g of structure.gates) {
    if ((scores[g.axis] ?? 10) < g.threshold) overall = Math.min(overall, g.cap);
  }
  return Math.round(overall * 10) / 10;
}

export async function saveStructure(s: GenStructure, dir = "structures"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = `${dir}/v${s.version}.json`;
  await Bun.write(path, JSON.stringify(s, null, 2));
  await Bun.write(`${dir}/active.json`, JSON.stringify(s, null, 2));
  return path;
}

export async function loadStructure(version: number | "active", dir = "structures"): Promise<GenStructure | null> {
  const path = `${dir}/${version === "active" ? "active" : `v${version}`}.json`;
  try {
    return GenStructureSchema.parse(await Bun.file(path).json());
  } catch {
    return null;
  }
}
