import type { BrandConcept } from "../brand/types.ts";
import type { BrandKit } from "../creative/types.ts";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A minimal, schema-valid BrandKit derived deterministically from the concept (no LLM council). */
export function deriveLiteKit(concept: BrandConcept): BrandKit {
  const premium = (concept.priceBand ?? "").toLowerCase().includes("premium");
  const accent = premium ? "#7c5cff" : "#1d9bf0";
  const moodWords = (concept.positioning + " " + concept.coreInsight)
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 4).slice(0, 5);

  return {
    brandId: slug(concept.id || concept.name),
    brandName: concept.name,
    essence: concept.tagline || concept.positioning,
    palette: [
      { name: "Ink", hex: "#171411", role: "primary" },
      { name: "Paper", hex: "#faf7f2", role: "background" },
      { name: "Accent", hex: accent, role: "accent" },
      { name: "Mute", hex: "#6b6258", role: "neutral" },
    ],
    typography: { headingMood: "modern, confident", bodyMood: "clean, readable", pairing: "grotesque + humanist serif" },
    artDirection: `Clean premium D2C product photography for ${concept.name}; ${concept.positioning}`,
    casting: "",
    moodKeywords: moodWords.length ? moodWords : ["clean", "premium"],
    logoDirection: `Clean wordmark for "${concept.name}", ${premium ? "premium and refined" : "approachable and bright"}`,
    packagingDirection: concept.packagingDirection || `Retail-ready packaging for ${concept.heroSku}, brand colors, clear hierarchy`,
    voice: { tone: concept.brandVoice || "warm, clear, confident", doSay: [], dontSay: [] },
    visualDos: ["realistic product detail", "consistent brand color", "clean composition"],
    visualDonts: ["AI artifacts", "warped text", "stocky cliche"],
    negativePrompt: "blurry, distorted text, watermark, extra fingers, low quality",
    competitiveNotes: [],
  };
}
