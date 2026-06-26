import { ImageClient, readImage, type ImageBlob } from "../llm/imageClient.ts";
import { LLMClient } from "../llm/client.ts";
import { renderCreative } from "./render.ts";
import { juryScore } from "./jury.ts";
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
    imagePrompt:
      `${kind === "logo" ? "Primary brand logo" : "Product packaging"} for "${kit.brandName}". ` +
      `${direction}. Essence: ${kit.essence}.`,
    negativePrompt: "",
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
  opts: { outDir: string; variants?: number; dry?: boolean; imageClient?: ImageClient; llm?: LLMClient },
): Promise<IdentityResult> {
  const ic = opts.imageClient ?? new ImageClient();
  const llm = opts.llm ?? new LLMClient();
  const variants = opts.variants ?? 2;

  const best = async (kind: "logo" | "packaging"): Promise<RenderedCreative> => {
    const base = identitySpec(kit, kind);
    const candidates = await Promise.all(
      Array.from({ length: variants }, async (_, i) => {
        const spec = { ...base, id: `${base.id}-${i + 1}` };
        const r = await renderCreative(kit, spec, {
          tier: kind === "logo" ? "flash" : "pro",
          dry: opts.dry,
          outDir: `${opts.outDir}/identity`,
          client: ic,
        }).catch(() => null);
        if (!r) return null;
        const v = await juryScore(r, kit, { imageClient: ic, llm });
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
