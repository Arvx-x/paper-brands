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

const PAGE_SYSTEM =
  "You are an award-winning D2C web designer and front-end engineer — the kind whose " +
  "landing pages win Awwwards and FWA. You build distinctive, conversion-focused product " +
  "pages, each one visually unmistakable as THIS brand. You never ship a generic template: " +
  "the layout, type system, color use, section rhythm, and art direction are derived from " +
  "the specific brand's identity every time. You write clean, hand-crafted, mobile-first " +
  "HTML with all CSS inline in a <style> tag — no frameworks, no CDNs, no boilerplate.";

export async function codePage(
  concept: BrandConcept,
  assets: CreativeAssets,
  llm: LLMClient,
  // `google:` prefix routes to Gemini; a bare name would hit the default (OpenAI) provider and 404.
  model = "google:gemini-3-flash-preview",
): Promise<string> {
  const refs = assetRefs(assets);
  const kit = assets.brandKit;
  const palette = (kit.palette ?? []).map((p) => `${p.name} ${p.hex} (${p.role})`).join(", ");
  const voice = typeof kit.voice === "object" ? (kit.voice as { tone?: string }).tone ?? "" : String(kit.voice ?? "");
  const typo = (kit as { typography?: { headingMood?: string; bodyMood?: string; pairing?: string } }).typography;
  const typography = typo
    ? [typo.pairing, typo.headingMood, typo.bodyMood].filter(Boolean).join(" · ")
    : "";
  const fontHint = typography
    ? `Typography direction: ${typography}. You MAY use Google Fonts via a <link> for the typefaces only (this is the one allowed external resource); everything else stays inline.`
    : `Pick distinctive typefaces (you MAY use Google Fonts via a <link> for fonts only) that match the brand's mood — avoid system-default Arial/Helvetica unless the brand is deliberately utilitarian.`;

  const prompt =
    `Design and code ONE complete, self-contained, mobile-first HTML landing page for this D2C product.\n` +
    `This page must look UNMISTAKABLY like THIS brand — derive the layout, section rhythm, color use, ` +
    `and art direction from the brand identity below. Do NOT produce a generic centered-hero template.\n\n` +
    `── BRAND ──\n` +
    `Name: ${concept.name}\n` +
    `Headline: ${concept.landingHeadline}\nTagline: ${concept.tagline}\n` +
    `Positioning: ${concept.positioning}\nPromise: ${concept.productPromise}\n` +
    `Claims (turn into benefit sections): ${(concept.claims ?? []).join("; ")}\n` +
    `Hero SKU: ${concept.heroSku} — price ${(concept.priceMinor / 100).toLocaleString("en-IN")} (${concept.priceBand} tier)\n` +
    `Target customer: ${concept.targetCustomer}\n\n` +
    `── VISUAL IDENTITY (obey strictly) ──\n` +
    `Palette — use these exact hex values as the page's color system: ${palette || "(none — choose a palette that fits the positioning)"}\n` +
    `Mood / feel: ${(kit.moodKeywords ?? []).join(", ") || "(infer from positioning)"}\n` +
    `Art direction: ${kit.artDirection || "(infer from positioning)"}\n` +
    `Brand voice for all copy: ${voice || "(infer from positioning)"}\n` +
    `${fontHint}\n\n` +
    `── REQUIREMENTS ──\n` +
    (refs.length
      ? `- Use these local images with <img src="..."> (exact relative paths): ${refs.join(", ")}. Make the hero image a focal element.\n`
      : `- No images available; lean on strong typography, color blocking, and layout for visual impact.\n`) +
    `- Sections to include (styled to the brand): hero with headline + primary CTA, the product with price, ` +
    `2–4 benefit/claim blocks, a trust/why-us moment, and a closing CTA.\n` +
    `- Primary CTA everywhere: JOIN THE LAUNCH WAITLIST (a real, prominent button).\n` +
    `- Mobile-first and fully responsive. All CSS inline in <style>. No JS frameworks, no CDN (fonts link is the only exception).\n` +
    `- Craft matters: intentional spacing, a real type scale, hover states, and a layout that feels designed, not defaulted.\n\n` +
    `Return ONLY the HTML document (a single <!DOCTYPE html>...</html>).`;

  const raw = await llm.complete({
    messages: [
      { role: "system", content: PAGE_SYSTEM },
      { role: "user", content: prompt },
    ],
    model,
    temperature: 0.8,
    maxTokens: 8000,
  });
  const html = extractHtml(raw);
  if (!html) throw new Error("codePage: LLM returned no usable HTML");
  return html;
}
