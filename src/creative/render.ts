import { mkdir } from "node:fs/promises";
import { loadConfig } from "../config.ts";
import { ImageClient, writeImage, type ImageBlob } from "../llm/imageClient.ts";
import { brandKitDigest } from "./brandkit.ts";
import type { BrandKit, CreativeSpec, RenderedCreative } from "./types.ts";

export interface RenderOptions {
  /** "flash" for cheap drafts/optimizer iterations, "pro" for final hero renders. */
  tier?: "flash" | "pro";
  /** Reference images (logo/packaging/winning frames) for visual consistency. */
  refImages?: ImageBlob[];
  imageSize?: string;
  /** Skip the paid API call; write the composed prompt to a .txt instead. */
  dry?: boolean;
  /** Override the composed prompt (e.g. an edit instruction for refinement). */
  promptOverride?: string;
  /** Filename stem override (defaults to spec.id) — lets callers avoid collisions. */
  nameStem?: string;
  outDir: string;
  client?: ImageClient;
}

/**
 * Compose the full image prompt from the BrandKit + spec and render it. The kit
 * is folded into the prompt and the negative prompts are merged, so every asset
 * in the library shares one look. Passing identity images as refs locks it in.
 */
export function composePrompt(kit: BrandKit, spec: CreativeSpec): string {
  const text =
    [spec.headline, spec.subhead, spec.cta].filter(Boolean).map((t) => `"${t}"`).join(", ") ||
    "(no text)";
  // Only include art-direction lines the spec actually filled in.
  const direction = (
    [
      ["SUBJECT", spec.subject],
      ["CAMERA", spec.camera],
      ["LIGHTING", spec.lighting],
      ["COLOR GRADE", spec.colorGrade],
      ["COMPOSITION", spec.composition || spec.layout],
      ["TEXTURE", spec.texture],
      ["MOOD", spec.mood],
      ["TYPOGRAPHY", spec.typographyTreatment],
    ] as const
  )
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  return [
    `Art-direct and render an award-winning ${spec.assetType} (${spec.aspect}) for "${kit.brandName}" —`,
    `editorial campaign quality, the kind of work that wins design awards. Not a stock template.`,
    ``,
    `BRAND SYSTEM (obey strictly):`,
    brandKitDigest(kit),
    ``,
    `CREATIVE DIRECTION:`,
    spec.imagePrompt,
    direction ? `\n${direction}` : "",
    ``,
    `IN-IMAGE TEXT — render crisp, kerned, correctly spelled, integrated into the design: ${text}`,
    ``,
    `Photorealistic finish where applicable, flawless craft, intentional negative space, ` +
      `magazine-grade polish. Avoid: ${[kit.negativePrompt, spec.negativePrompt].filter(Boolean).join("; ")}.`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Edit prompt: refine an EXISTING render in place. Passed alongside the current
 * image as a reference, this preserves what already works and applies only the
 * jury's targeted fixes — how the loop converges to polish instead of churning.
 */
export function composeEditPrompt(kit: BrandKit, spec: CreativeSpec, fixes: string[]): string {
  const text =
    [spec.headline, spec.subhead, spec.cta].filter(Boolean).map((t) => `"${t}"`).join(", ") ||
    "(no text)";
  return [
    `Refine the attached ${spec.assetType} for "${kit.brandName}". This is an EDIT, not a new image.`,
    `KEEP its strong composition, subject, and on-brand look. Preserve exact brand palette ` +
      `(${kit.palette.map((p) => p.hex).join(", ")}) and the in-image text: ${text}.`,
    ``,
    `Apply ONLY these improvements:`,
    ...(fixes.length ? fixes.map((f) => `- ${f}`) : ["- elevate overall craft, lighting realism, and typographic polish"]),
    ``,
    `Result must look more premium and award-worthy than the input while staying clearly the same creative.`,
  ].join("\n");
}

export async function renderCreative(
  kit: BrandKit,
  spec: CreativeSpec,
  opts: RenderOptions,
): Promise<RenderedCreative> {
  const cfg = loadConfig();
  const model = opts.tier === "pro" ? cfg.imageModelPro : cfg.imageModel;
  const prompt = opts.promptOverride ?? composePrompt(kit, spec);
  const stem = opts.nameStem ?? spec.id;
  await mkdir(opts.outDir, { recursive: true });

  if (opts.dry) {
    const path = `${opts.outDir}/${stem}.prompt.txt`;
    await Bun.write(path, prompt);
    return { spec, imagePath: path, model: `${model} (dry)`, promptUsed: prompt };
  }

  const client = opts.client ?? new ImageClient(cfg);
  const blob = await client.generate({
    prompt,
    model,
    aspect: spec.aspect,
    imageSize: opts.imageSize ?? (opts.tier === "pro" ? "2K" : "1K"),
    system: `Global brand negative prompt: ${kit.negativePrompt}`,
    refImages: opts.refImages,
  });
  const ext = blob.mime.includes("jpeg") ? "jpg" : "png";
  const path = await writeImage(blob, `${opts.outDir}/${stem}.${ext}`);
  return { spec, imagePath: path, model, promptUsed: prompt };
}
