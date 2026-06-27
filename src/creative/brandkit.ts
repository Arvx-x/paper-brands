import { mkdir } from "node:fs/promises";
import { LLMClient } from "../llm/client.ts";
import { Agent } from "../agents/agent.ts";
import type { BrandConcept } from "../brand/types.ts";
import { BrandKitSchema, brandSlug, type BrandKit } from "./types.ts";
import type { CreativeResearch } from "./research.ts";

/**
 * Derive a structured BrandKit from a BrandConcept (and, when available, real
 * competitor-creative research). This is the spec every downstream render obeys
 * — palette with hex, type mood, art direction, voice, do/don't lists, and a
 * global negative prompt. The Creative Director + Brand Guardian co-author it.
 */
export async function buildBrandKit(
  concept: BrandConcept,
  research?: CreativeResearch,
  llm = new LLMClient(),
  /** Target market (geography) — drives market-appropriate casting. Not hardcoded. */
  market?: string,
): Promise<BrandKit> {
  const director = new Agent(
    {
      role: "Creative Director",
      charter:
        "You codify a brand's entire visual + verbal identity into a precise, " +
        "buildable system: an ownable palette (with hex), type moods, an art-direction " +
        "style that looks expensively made, voice rules, and explicit visual do/don'ts. " +
        "Every choice ladders back to the brand's positioning and the real customer.",
      temperature: 0.6,
    },
    llm,
  );

  const conceptBrief = JSON.stringify(
    {
      name: concept.name,
      positioning: concept.positioning,
      targetCustomer: concept.targetCustomer,
      coreInsight: concept.coreInsight,
      productPromise: concept.productPromise,
      heroSku: concept.heroSku,
      tagline: concept.tagline,
      packagingDirection: concept.packagingDirection,
      brandVoice: concept.brandVoice,
      claims: concept.claims,
    },
    null,
    2,
  );

  const raw = await director.respondJson<Record<string, unknown>>(
    `Brand concept:\n${conceptBrief}\n\n` +
      (research?.notes
        ? `Competitor-creative research (match this quality bar, then differentiate):\n${research.notes}\n\n`
        : "") +
      `Target market: ${market ?? "infer from the target customer"}.\n\n` +
      `Codify a complete BrandKit. Return JSON with EXACTLY these keys:\n` +
      `- essence: one line the whole look ladders back to\n` +
      `- palette[]: { name, hex, role(primary|secondary|accent|neutral|background) } — 4-6 swatches, real hex\n` +
      `- typography: { headingMood, bodyMood, pairing }\n` +
      `- artDirection: photography/illustration style, lighting, composition language (concrete, visual)\n` +
      `- casting: WHO appears in the creatives — talent that authentically reflects THIS target market and ` +
      `customer (ethnicity, age range, styling, settings). Specify the REAL diversity within the market — ` +
      `e.g. for India, the full range of Indian skin tones (fair, wheatish, dusky, deep) and features, NOT a ` +
      `single stereotyped tone; real, relatable, aspirational people, not foreign models standing in. ` +
      `Include casting do's and don'ts. Derive this from the market — never default to Western talent.\n` +
      `- moodKeywords[]: 6-10 visual adjectives\n` +
      `- logoDirection: how the primary mark should look\n` +
      `- packagingDirection: front-of-pack look\n` +
      `- voice: { tone, doSay[], dontSay[] }\n` +
      `- visualDos[]: visual rules to always follow\n` +
      `- visualDonts[]: visual mistakes to never make\n` +
      `- negativePrompt: a single string of things image generation must avoid (artifacts, clichés, off-brand looks)\n` +
      `- competitiveNotes[]: what rivals do well / overuse, from the research\n` +
      `Be concrete and visual. Return ONLY the JSON object.`,
  );

  return BrandKitSchema.parse({
    brandId: concept.id,
    brandName: concept.name,
    essence: raw.essence ?? concept.positioning,
    palette: raw.palette ?? [],
    typography: raw.typography ?? { headingMood: "", bodyMood: "", pairing: "" },
    artDirection: raw.artDirection ?? concept.packagingDirection,
    casting: raw.casting ?? "",
    moodKeywords: raw.moodKeywords ?? [],
    logoDirection: raw.logoDirection ?? "",
    packagingDirection: raw.packagingDirection ?? concept.packagingDirection,
    voice: raw.voice ?? { tone: concept.brandVoice, doSay: [], dontSay: [] },
    visualDos: raw.visualDos ?? [],
    visualDonts: raw.visualDonts ?? [],
    negativePrompt:
      raw.negativePrompt ??
      "low-resolution, watermark, distorted text, extra fingers, generic stock look, cluttered composition",
    competitiveNotes: Array.isArray(raw.competitiveNotes) ? raw.competitiveNotes : [],
  });
}

/** A compact, prompt-ready summary of the kit injected into every render + jury call. */
export function brandKitDigest(kit: BrandKit): string {
  const pal = kit.palette.map((p) => `${p.name} ${p.hex} (${p.role})`).join(", ");
  return [
    `Brand: ${kit.brandName} — ${kit.essence}`,
    `Palette: ${pal}`,
    `Type mood: ${kit.typography.headingMood} / ${kit.typography.bodyMood} (${kit.typography.pairing})`,
    `Art direction: ${kit.artDirection}`,
    kit.casting ? `Casting (authentic to target market): ${kit.casting}` : "",
    `Mood: ${kit.moodKeywords.join(", ")}`,
    `Voice: ${kit.voice.tone}`,
    `DO: ${kit.visualDos.join("; ")}`,
    `DON'T: ${kit.visualDonts.join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function saveBrandKit(kit: BrandKit, dir?: string): Promise<string> {
  const d = dir ?? `data/${brandSlug(kit.brandName)}`;
  await mkdir(d, { recursive: true });
  const path = `${d}/brandkit.json`;
  await Bun.write(path, JSON.stringify(kit, null, 2));
  return path;
}

export async function loadBrandKit(brandName: string, dir?: string): Promise<BrandKit | null> {
  const path = `${dir ?? `data/${brandSlug(brandName)}`}/brandkit.json`;
  try {
    return BrandKitSchema.parse(await Bun.file(path).json());
  } catch {
    return null;
  }
}
