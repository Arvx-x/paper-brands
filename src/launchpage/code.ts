import type { LLMClient } from "../llm/client.ts";
import type { BrandConcept } from "../brand/types.ts";
import type { CreativeAssets } from "./types.ts";

export function assetRefs(assets: CreativeAssets): string[] {
  const refs: string[] = [];
  if (assets.logoPath) refs.push("assets/logo.png");
  if (assets.heroPath) refs.push("assets/hero.png");
  if (assets.packagingPath) refs.push("assets/packaging.png");
  (assets.adPaths ?? []).forEach((_, i) => refs.push(`assets/ad-${i + 1}.png`));
  return refs;
}

function extractHtml(raw: string): string | null {
  const fence = raw.match(/```html\s*([\s\S]*?)```/i);
  if (fence?.[1] && /<html[\s>]/i.test(fence[1])) return fence[1].trim();
  const span = raw.match(/<!DOCTYPE html>[\s\S]*<\/html>/i) ?? raw.match(/<html[\s>][\s\S]*<\/html>/i);
  if (span) return span[0].trim();
  return null;
}

export async function codePage(
  concept: BrandConcept,
  assets: CreativeAssets,
  llm: LLMClient,
  model = "gemini-3.1-flash",
): Promise<string> {
  const refs = assetRefs(assets);
  const kit = assets.brandKit;
  const palette = (kit.palette ?? []).map((p) => `${p.name} ${p.hex} (${p.role})`).join(", ");

  const prompt =
    `Code ONE complete, self-contained, mobile-responsive HTML landing page for this D2C product.\n` +
    `Inline all CSS in a <style> tag. NO external stylesheets, NO JS frameworks, NO CDN links.\n\n` +
    `Brand: ${concept.name}\n` +
    `Headline: ${concept.landingHeadline}\nTagline: ${concept.tagline}\n` +
    `Positioning: ${concept.positioning}\nPromise: ${concept.productPromise}\n` +
    `Claims: ${(concept.claims ?? []).join("; ")}\n` +
    `Hero SKU: ${concept.heroSku} — price ${(concept.priceMinor / 100).toLocaleString("en-IN")} (${concept.priceBand})\n` +
    `Target customer: ${concept.targetCustomer}\n\n` +
    `Brand palette (use these hex values): ${palette || "(none)"}\n` +
    `Type mood: ${(kit.moodKeywords ?? []).join(", ") || "(default)"}\nArt direction: ${kit.artDirection || "(none)"}\nVoice: ${typeof kit.voice === "object" ? (kit.voice as { tone?: string }).tone ?? "" : String(kit.voice ?? "")}\n\n` +
    (refs.length
      ? `Reference these local images with <img src="..."> (relative paths, exactly these): ${refs.join(", ")}\n`
      : `No images are available; design a strong text + color layout.\n`) +
    `Include a clear primary call-to-action button to JOIN THE LAUNCH WAITLIST.\n` +
    `Return ONLY the HTML document (a single <!DOCTYPE html>...</html>).`;

  const raw = await llm.complete({
    messages: [{ role: "user", content: prompt }],
    model,
    temperature: 0.7,
    maxTokens: 4000,
  });
  const html = extractHtml(raw);
  if (!html) throw new Error("codePage: LLM returned no usable HTML");
  return html;
}
