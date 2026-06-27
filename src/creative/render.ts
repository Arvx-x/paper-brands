import { mkdir } from "node:fs/promises";
import { loadConfig } from "../config.ts";
import { ImageClient, writeImage, type ImageBlob } from "../llm/imageClient.ts";
import { brandKitDigest } from "./brandkit.ts";
import { defaultStructure, type GenStructure } from "./structure.ts";
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
  /** Active generation structure (template/directives/negatives). */
  structure?: GenStructure;
  outDir: string;
  client?: ImageClient;
}

/**
 * Compose the final image prompt by filling the active GenStructure's template
 * with the BrandKit + spec. The structure owns the wording, directives, and
 * negatives, so the meta-optimizer can rewrite how prompts are built without a
 * code change. v1's template reproduces the known-good v3 prompt exactly.
 */
export function composePrompt(
  kit: BrandKit,
  spec: CreativeSpec,
  structure: GenStructure = defaultStructure(),
): string {
  const text =
    [spec.headline, spec.subhead, spec.cta].filter(Boolean).map((t) => `"${t}"`).join(", ") ||
    "(no text)";

  // Build the {direction} block from the structure-driven `direction` map,
  // falling back to legacy named fields for specs produced before this change.
  const dirEntries = Object.keys(spec.direction).length
    ? Object.entries(spec.direction)
    : ([
        ["subject", spec.subject],
        ["camera", spec.camera],
        ["lighting", spec.lighting],
        ["colorGrade", spec.colorGrade],
        ["composition", spec.composition || spec.layout],
        ["texture", spec.texture],
        ["mood", spec.mood],
        ["typographyTreatment", spec.typographyTreatment],
      ] as [string, string][]);
  const direction = dirEntries
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${labelize(k)}: ${v}`)
    .join("\n");

  const negatives = [...structure.negatives, kit.negativePrompt, spec.negativePrompt]
    .filter(Boolean)
    .join("; ");

  return structure.promptTemplate
    .replaceAll("{assetType}", spec.assetType)
    .replaceAll("{aspect}", spec.aspect)
    .replaceAll("{brandName}", kit.brandName)
    .replaceAll("{brandSystem}", brandKitDigest(kit))
    .replaceAll("{imagePrompt}", spec.imagePrompt)
    .replaceAll("{direction}", direction ? `\n${direction}` : "")
    .replaceAll("{text}", text)
    .replaceAll("{directives}", structure.directives.join(" "))
    .replaceAll("{negatives}", negatives)
    .split("\n")
    .filter((l, i, arr) => !(l.trim() === "" && arr[i - 1]?.trim() === "")) // collapse blank runs
    .join("\n");
}

function labelize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
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
  let prompt = opts.promptOverride ?? composePrompt(kit, spec, opts.structure);
  // When identity/product references are supplied, force fidelity to them so the
  // product/logo don't drift across the library (a stick stays a stick).
  if (!opts.promptOverride && opts.refImages?.length) {
    prompt +=
      `\n\nBRAND CONSISTENCY — reference image(s) attached: the product and logo MUST match them ` +
      `EXACTLY (same form factor, proportions, colour, finish, label, and wordmark). Reuse that ` +
      `identity verbatim; do NOT redesign or restyle it. Place it naturally into this composition.`;
  }
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
