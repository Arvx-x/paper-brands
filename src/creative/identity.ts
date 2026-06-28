import { ImageClient, readImage, type ImageBlob } from "../llm/imageClient.ts";
import { LLMClient } from "../llm/client.ts";
import { renderCreative } from "./render.ts";
import { juryScore } from "./jury.ts";
import { defaultStructure, type GenStructure } from "./structure.ts";
import { CreativeSpecSchema, type BrandKit, type CreativeSpec, type RenderedCreative } from "./types.ts";

export interface IdentityResult {
  logo: RenderedCreative;
  packaging: RenderedCreative;
  /** The chosen logo + packaging as reference images for downstream consistency. */
  refImages: ImageBlob[];
}

/** Build a render-ready identity spec straight from the BrandKit. */
function identitySpec(kit: BrandKit, kind: "logo" | "packaging"): CreativeSpec {
  const direction = kind === "logo" ? kit.logoDirection : kit.packagingDirection;
  const aspect = kind === "logo" ? "1:1" : "4:5";
  const palette = (kit.palette ?? []).map((p) => `${p.name} ${p.hex} (${p.role})`).join(", ");
  const mood = (kit.moodKeywords ?? []).join(", ");

  // Fill the rich art-direction `direction` map so identity assets go through the
  // same world-class prompt path as council creatives — not a thin generic brief.
  // This is what lifts packaging from "generic mockup" to a designed, on-shelf hero.
  const dir =
    kind === "logo"
      ? {
          subject: `the primary "${kit.brandName}" wordmark/logomark as a clean vector-style mark`,
          composition: "single centered mark, generous even margins, perfectly balanced, scalable to a favicon",
          colorGrade: `brand palette only (${palette || "neutral"}); flat, no gradients unless the brand demands it`,
          texture: "crisp flat finish, no mockup, no drop shadows, no 3D bevel",
          mood: mood || "confident and timeless",
          typographyTreatment: "the brand name set in a distinctive, well-kerned, correctly spelled custom-feeling logotype",
        }
      : {
          subject: `the actual retail product for "${kit.brandName}" in its real-world package/container, label fully legible`,
          camera: "85mm product lens, slight hero angle, shallow depth of field, product razor-sharp",
          lighting: "premium softbox studio lighting with a soft key, gentle rim light, true-to-life reflections on the material",
          colorGrade: `brand palette (${palette || "neutral"}); rich but realistic contrast, accurate product color`,
          composition: "front-of-pack hero, product centered with breathing room, clean seamless backdrop, magazine product-shot framing",
          texture: "true material finish — show the real substrate (glass, tube, carton, matte/gloss), label print crisp and readable",
          mood: mood || "premium and trustworthy",
          typographyTreatment: "on-pack brand name and key claim crisp, correctly spelled, integrated into the label design",
        };

  return CreativeSpecSchema.parse({
    id: `identity-${kind}`,
    briefId: `identity-${kind}`,
    assetType: kind,
    aspect,
    headline: kind === "logo" ? kit.brandName : "",
    subhead: "",
    cta: "",
    layout:
      kind === "logo"
        ? "centered primary mark on a clean background, generous margin, scalable"
        : "front-of-pack hero, product centered, label legible, retail studio lighting",
    direction: dir,
    imagePrompt:
      `${kind === "logo" ? "Primary brand logo" : "Photorealistic retail product packaging"} for "${kit.brandName}". ` +
      `${direction}. Essence: ${kit.essence}.` +
      (kind === "packaging"
        ? ` It must look like a real, premium product you could pick up off a shelf — a believable physical package, ` +
          `not a flat graphic or generic box mockup.`
        : ""),
    negativePrompt:
      kind === "packaging"
        ? "generic box mockup, floating label, fake/placeholder text, lorem ipsum, watermark, distorted typography, plastic CGI look"
        : "photographic background, mockup, drop shadow, 3D bevel, busy background, misspelled wordmark",
    rationale: `Foundational ${kind} that anchors the whole visual system.`,
  });
}

/**
 * The identity stage runs FIRST (name/packaging/logo before creatives, as the
 * user framed it). It generates a few candidates per identity asset, jury-picks
 * the strongest, and hands the winners back as reference images so every later
 * creative is edited from the real identity — the key to a consistent library.
 */
export async function generateIdentity(
  kit: BrandKit,
  opts: {
    outDir: string;
    variants?: number;
    dry?: boolean;
    structure?: GenStructure;
    imageClient?: ImageClient;
    llm?: LLMClient;
  },
): Promise<IdentityResult> {
  const ic = opts.imageClient ?? new ImageClient();
  const llm = opts.llm ?? new LLMClient();
  const variants = opts.variants ?? 2;
  const structure = opts.structure ?? defaultStructure();

  const best = async (kind: "logo" | "packaging"): Promise<RenderedCreative> => {
    const base = identitySpec(kit, kind);
    const candidates = await Promise.all(
      Array.from({ length: variants }, async (_, i) => {
        const spec = { ...base, id: `${base.id}-${i + 1}` };
        const r = await renderCreative(kit, spec, {
          tier: kind === "logo" ? "flash" : "pro",
          structure,
          dry: opts.dry,
          outDir: `${opts.outDir}/identity`,
          client: ic,
        }).catch(() => null);
        if (!r) return null;
        const v = await juryScore(r, kit, { structure, imageClient: ic, llm });
        return { r, score: v.overall };
      }),
    );
    const ok = candidates.filter((c): c is { r: RenderedCreative; score: number } => c !== null);
    if (ok.length === 0) throw new Error(`identity ${kind}: all renders failed`);
    ok.sort((a, b) => b.score - a.score);
    return ok[0]!.r;
  };

  const logo = await best("logo");
  const packaging = await best("packaging");

  const refImages: ImageBlob[] = [];
  if (!opts.dry) {
    for (const r of [logo, packaging]) {
      const mime = r.imagePath.endsWith(".jpg") ? "image/jpeg" : "image/png";
      const blob = await readImage(r.imagePath, mime).catch(() => null);
      if (blob) refImages.push(blob);
    }
  }
  return { logo, packaging, refImages };
}
