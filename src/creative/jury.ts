import { LLMClient } from "../llm/client.ts";
import { ImageClient, readImage } from "../llm/imageClient.ts";
import { brandKitDigest } from "./brandkit.ts";
import { defaultStructure, scoreWith, type GenStructure } from "./structure.ts";
import { JuryVerdictSchema, type BrandKit, type JuryVerdict, type RenderedCreative } from "./types.ts";

/**
 * The Jury scores a rendered creative across the active structure's panel of
 * judges and rubric, aggregating (with the structure's gates) to a single
 * 0..100 — the optimizer's objective AND the meta-optimizer's fitness signal.
 * With a real image it judges pixels; in --dry mode it judges the composed
 * prompt, so the loop is exercisable without spending image credits.
 */
export async function juryScore(
  rendered: RenderedCreative,
  kit: BrandKit,
  opts: { structure?: GenStructure; imageClient?: ImageClient; llm?: LLMClient } = {},
): Promise<JuryVerdict> {
  const structure = opts.structure ?? defaultStructure();
  const isImage = !rendered.imagePath.endsWith(".prompt.txt");
  const digest = brandKitDigest(kit);
  const context =
    `BrandKit:\n${digest}\n\n` +
    `Creative intent — headline: "${rendered.spec.headline}", subhead: "${rendered.spec.subhead}", ` +
    `cta: "${rendered.spec.cta}", asset: ${rendered.spec.assetType} (${rendered.spec.aspect}).\n\n`;

  const rubric = buildRubric(structure);

  const mime = rendered.imagePath.endsWith(".jpg") ? "image/jpeg" : "image/png";
  const image = isImage ? await readImage(rendered.imagePath, mime).catch(() => null) : null;

  const verdicts = await Promise.all(
    structure.judges.map((j) =>
      scoreOne(j, context, rubric, structure, image, rendered.promptUsed, opts).catch(() => null),
    ),
  );
  const ok = verdicts.filter((v): v is JuryVerdict => v !== null);
  if (ok.length === 0) {
    return { scores: {}, overall: 0, critique: "Jury failed to score.", fixes: [] };
  }
  return averageVerdicts(ok, structure);
}

function buildRubric(structure: GenStructure): string {
  const axes = structure.rubric.map((a) => `- ${a.key}: ${a.guidance}`).join("\n");
  return (
    `Score each axis 0-10 on a HARSH curve. Calibration: 3 = amateur/obvious AI, 5 = competent stock, ` +
    `6 = decent, 7 = strong agency work, 8 = excellent, 9-10 = genuinely award-winning (almost never). ` +
    `Most AI-generated drafts deserve 4-6. Do NOT inflate.\n${axes}\n` +
    `In "fixes", give 2-4 SPECIFIC, visual, actionable changes (name the exact problem) an editor could ` +
    `apply to the existing image to raise the score.\n` +
    `Return JSON: { "scores": { ${structure.rubric.map((a) => a.key).join(", ")} }, "critique": "...", "fixes": ["..."] }`
  );
}

async function scoreOne(
  judge: { name: string; emphasis: string },
  context: string,
  rubric: string,
  structure: GenStructure,
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
    const llm = opts.llm ?? new LLMClient();
    raw = await llm.completeJson<Record<string, unknown>>({
      messages: [
        { role: "system", content: "You are a brand creative judge. Return ONLY JSON." },
        { role: "user", content: `${head}No image is available; judge this render prompt as a proxy:\n${promptText}` },
      ],
      temperature: 0.3,
    });
  }

  const scores = numericScores(raw.scores ?? raw, structure);
  return {
    scores,
    overall: scoreWith(structure, scores),
    critique: typeof raw.critique === "string" ? raw.critique : "",
    fixes: Array.isArray(raw.fixes) ? (raw.fixes as string[]) : [],
  };
}

/** Coerce a judge's raw scores into the structure's rubric keys (0..10). */
function numericScores(raw: unknown, structure: GenStructure): Record<string, number> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const axis of structure.rubric) {
    const v = Number(obj[axis.key]);
    out[axis.key] = Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 5;
  }
  return out;
}

function averageVerdicts(vs: JuryVerdict[], structure: GenStructure): JuryVerdict {
  const scores: Record<string, number> = {};
  for (const axis of structure.rubric) {
    const mean = vs.reduce((s, v) => s + (v.scores[axis.key] ?? 0), 0) / vs.length;
    scores[axis.key] = Math.round(mean * 10) / 10;
  }
  return JuryVerdictSchema.parse({
    scores,
    overall: scoreWith(structure, scores),
    critique: vs.map((v) => v.critique).filter(Boolean).join(" | "),
    fixes: vs.flatMap((v) => v.fixes).slice(0, 6),
  });
}
