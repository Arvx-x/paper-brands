import { LLMClient } from "../llm/client.ts";
import { ImageClient, readImage } from "../llm/imageClient.ts";
import { brandKitDigest } from "./brandkit.ts";
import {
  JuryVerdictSchema,
  JuryScoreSchema,
  aggregateScore,
  type BrandKit,
  type JuryVerdict,
  type RenderedCreative,
} from "./types.ts";

/** Distinct judging lenses — like the arena's persona cohort, but for craft. */
const JUDGES = [
  {
    name: "Awwwards-level Art Director",
    emphasis:
      "craft, composition, lighting realism, and whether it looks like an award-winning editorial campaign — you are ruthless about anything that reads as AI-generated, stock, or template",
  },
  {
    name: "Brand Guardian",
    emphasis: "fidelity to the BrandKit: exact palette, type mood, voice, logo usage, and the do/don't lists",
  },
  {
    name: "Growth Marketer",
    emphasis: "scroll-stopping power, message clarity in under a second, and conversion intent on the target channel",
  },
  {
    name: "Typography & Detail Critic",
    emphasis:
      "in-image text — spelling, kerning, legibility, hierarchy, and integration — plus small artifacts (warped edges, extra fingers, mushy logos) that betray low craft",
  },
];

const RUBRIC =
  `Score each axis 0-10. Be a STRINGENT critic: 5 = competent, 7 = good agency work, ` +
  `9-10 = genuinely award-winning. Reserve high scores; most first drafts are 5-7.\n` +
  `- visualQuality: craft, polish, composition, lighting, finish (penalize any AI/stock tells)\n` +
  `- brandConsistency: adherence to the exact BrandKit (palette/type/voice/style)\n` +
  `- messageClarity: is the single idea instantly legible, text spelled & kerned correctly\n` +
  `- conversionPotential: would the target audience stop scrolling and act\n` +
  `- differentiation: unmistakably this brand, not a generic category creative\n` +
  `In "fixes", give 2-4 SPECIFIC, visual, actionable changes (not vague praise) an editor ` +
  `could apply to the existing image to raise the score.\n` +
  `Return JSON: { "scores": { visualQuality, brandConsistency, messageClarity, conversionPotential, differentiation }, "critique": "...", "fixes": ["..."] }`;

/**
 * The Jury scores a rendered creative across a panel of multimodal judges and
 * aggregates to a single 0..100 — the optimizer's objective. With a real image
 * it judges the pixels; in --dry mode it judges the composed prompt (text only),
 * so the optimization loop is exercisable without spending image credits.
 */
export async function juryScore(
  rendered: RenderedCreative,
  kit: BrandKit,
  opts: { imageClient?: ImageClient; llm?: LLMClient } = {},
): Promise<JuryVerdict> {
  const isImage = !rendered.imagePath.endsWith(".prompt.txt");
  const digest = brandKitDigest(kit);
  const context =
    `BrandKit:\n${digest}\n\n` +
    `Creative intent — headline: "${rendered.spec.headline}", subhead: "${rendered.spec.subhead}", ` +
    `cta: "${rendered.spec.cta}", asset: ${rendered.spec.assetType} (${rendered.spec.aspect}).\n\n`;

  const mime = rendered.imagePath.endsWith(".jpg") ? "image/jpeg" : "image/png";
  const image = isImage ? await readImage(rendered.imagePath, mime).catch(() => null) : null;

  const verdicts = await Promise.all(
    JUDGES.map((j) =>
      scoreOne(j, context, RUBRIC, image, rendered.promptUsed, opts).catch(() => null),
    ),
  );
  const ok = verdicts.filter((v): v is JuryVerdict => v !== null);
  if (ok.length === 0) {
    return { scores: zeroScores(), overall: 0, critique: "Jury failed to score.", fixes: [] };
  }
  return averageVerdicts(ok);
}

async function scoreOne(
  judge: { name: string; emphasis: string },
  context: string,
  rubric: string,
  image: { base64: string; mime: string } | null,
  promptText: string,
  opts: { imageClient?: ImageClient; llm?: LLMClient },
): Promise<JuryVerdict> {
  const head =
    `You are a ${judge.name} judging a brand creative, emphasizing ${judge.emphasis}. ` +
    `Be a tough, specific critic.\n\n${context}${rubric}\n\n`;

  let raw: Record<string, unknown>;
  if (image) {
    const ic = opts.imageClient ?? new ImageClient();
    raw = await ic.analyzeJson<Record<string, unknown>>({
      prompt: `${head}Judge the attached image.`,
      images: [image],
    });
  } else {
    // Dry mode: judge the composed render prompt as a proxy for the image.
    const llm = opts.llm ?? new LLMClient();
    raw = await llm.completeJson<Record<string, unknown>>({
      messages: [
        { role: "system", content: "You are a brand creative judge. Return ONLY JSON." },
        { role: "user", content: `${head}No image is available; judge this render prompt as a proxy:\n${promptText}` },
      ],
      temperature: 0.3,
    });
  }

  const scores = JuryScoreSchema.parse(raw.scores ?? raw);
  return {
    scores,
    overall: aggregateScore(scores),
    critique: typeof raw.critique === "string" ? raw.critique : "",
    fixes: Array.isArray(raw.fixes) ? (raw.fixes as string[]) : [],
  };
}

function averageVerdicts(vs: JuryVerdict[]): JuryVerdict {
  const avg = (sel: (v: JuryVerdict) => number) =>
    Math.round((vs.reduce((s, v) => s + sel(v), 0) / vs.length) * 10) / 10;
  const scores = {
    visualQuality: avg((v) => v.scores.visualQuality),
    brandConsistency: avg((v) => v.scores.brandConsistency),
    messageClarity: avg((v) => v.scores.messageClarity),
    conversionPotential: avg((v) => v.scores.conversionPotential),
    differentiation: avg((v) => v.scores.differentiation),
  };
  return JuryVerdictSchema.parse({
    scores,
    overall: aggregateScore(scores),
    critique: vs.map((v) => v.critique).filter(Boolean).join(" | "),
    fixes: vs.flatMap((v) => v.fixes).slice(0, 6),
  });
}

function zeroScores() {
  return {
    visualQuality: 0,
    brandConsistency: 0,
    messageClarity: 0,
    conversionPotential: 0,
    differentiation: 0,
  };
}
