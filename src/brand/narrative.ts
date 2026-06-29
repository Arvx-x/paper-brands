// src/brand/narrative.ts
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { Agent } from "../agents/agent.ts";
import { LLMClient } from "../llm/client.ts";
import type { BrandConcept } from "./types.ts";
import type { BrandKit } from "../creative/types.ts";

export const BrandNarrativeSchema = z.object({
  brandId: z.string(),
  vision: z.string().default(""),
  mission: z.string().default(""),
  originStory: z.string().default(""),
  values: z.array(z.object({ name: z.string(), description: z.string().default("") })).default([]),
  manifesto: z.string().default(""),
  customerStory: z.string().default(""),
  tagline: z.string().default(""),
});
export type BrandNarrative = z.infer<typeof BrandNarrativeSchema>;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Generate the verbal brand narrative (vision/story/values/manifesto) grounded in
 * the concept + kit. Honest fallbacks: any field the LLM omits falls back to a
 * concept-derived value — never invented precision. Never introduces new product
 * claims (reuses the concept's positioning/claims).
 */
export async function buildNarrative(
  concept: BrandConcept,
  kit: BrandKit,
  llm: LLMClient = new LLMClient(),
  market?: string,
): Promise<BrandNarrative> {
  const strategist = new Agent(
    {
      role: "Brand Strategist & Storyteller",
      charter:
        "You write a brand's verbal identity — its vision, mission, origin story, " +
        "values, manifesto, and the customer it serves — grounded strictly in the " +
        "concept and visual kit. You never invent product claims; you make the brand " +
        "feel real, specific, and ownable.",
      temperature: 0.7,
    },
    llm,
  );
  const brief = JSON.stringify({
    name: concept.name, positioning: concept.positioning, coreInsight: concept.coreInsight,
    targetCustomer: concept.targetCustomer, productPromise: concept.productPromise,
    tagline: concept.tagline, essence: kit.essence, voice: kit.voice,
    market: market ?? "infer from the target customer",
  }, null, 2);

  const raw = await strategist
    .respondJson<Record<string, unknown>>(
      `Brand concept + kit:\n${brief}\n\n` +
        `Write the brand narrative. Return JSON with EXACTLY these keys:\n` +
        `- vision: the future this brand is building toward (1-2 sentences)\n` +
        `- mission: what it does, for whom, why (1 sentence)\n` +
        `- originStory: a short, specific founding narrative (2-4 sentences)\n` +
        `- values: 3-5 of { name, description }\n` +
        `- manifesto: a punchy, voice-forward rallying paragraph (short)\n` +
        `- customerStory: a day-in-the-life of the target customer (2-3 sentences)\n` +
        `- tagline: one memorable line\n` +
        `Ground everything in the concept. Do NOT invent product claims. Return ONLY JSON.`,
    )
    .catch(() => ({} as Record<string, unknown>));

  return BrandNarrativeSchema.parse({
    brandId: concept.id || slug(concept.name),
    vision: raw.vision ?? concept.positioning,
    mission: raw.mission ?? concept.productPromise,
    originStory: raw.originStory ?? concept.coreInsight,
    values: Array.isArray(raw.values) ? raw.values : [],
    manifesto: raw.manifesto ?? concept.tagline,
    customerStory: raw.customerStory ?? concept.targetCustomer,
    tagline: raw.tagline ?? concept.tagline,
  });
}

export async function saveNarrative(n: BrandNarrative, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = `${dir}/narrative.json`;
  await Bun.write(path, JSON.stringify(n, null, 2));
  return path;
}

export async function loadNarrative(dir: string): Promise<BrandNarrative | null> {
  try {
    return BrandNarrativeSchema.parse(await Bun.file(`${dir}/narrative.json`).json());
  } catch {
    return null;
  }
}
