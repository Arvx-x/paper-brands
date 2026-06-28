import type { BrandKit, CreativeSpec } from "../creative/types.ts";

/** A product-shot spec the creative optimizer will refine to real-brand quality. */
export function productSpec(kit: BrandKit): CreativeSpec {
  return {
    id: "product",
    briefId: "launchpage-product",
    assetType: "product-hero",
    aspect: "1:1",
    headline: kit.brandName,
    subhead: "",
    cta: "",
    layout: "Centered hero product on a clean brand-colored surface, generous negative space.",
    imagePrompt:
      `Studio product shot of ${kit.brandName} — premium lighting, clean backdrop in brand colors, ` +
      `realistic packaging detail, retail-ready, photographic, high fidelity. ${kit.artDirection}`,
    direction: {},
    subject: `${kit.brandName} hero product`,
    camera: "product shot, 50mm, slight top-down, shallow depth of field",
    lighting: "soft key + gentle fill, premium studio",
    colorGrade: "brand palette emphasis, natural contrast",
    composition: "centered, rule-of-thirds, generous negative space",
    texture: "realistic material finish",
    mood: "premium, trustworthy",
    typographyTreatment: "",
    negativePrompt: "",
    rationale: "",
  };
}
