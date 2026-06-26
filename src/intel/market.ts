import { mkdir } from "node:fs/promises";
import { LLMClient } from "../llm/client.ts";
import { CategoryPackSchema, type CategoryPack } from "../categories/types.ts";

export interface CategoryBrief {
  category: string;
  geography: string;
  currency: string;
  channel?: string;
  priceAmbition?: string;
  notes?: string;
}

/**
 * Market Intelligence agents turn a free-text brief into a validated
 * CategoryPack — the vertical operating model that drives output quality.
 *
 * v0 generates the pack from model knowledge. The competitor archetypes are
 * REQUIRED to be disguised (no real brand names) so the downstream blind arena
 * stays free of pretraining bias. Later this grounds in mined reviews /
 * listings / ads / search demand instead of model priors.
 */
export async function buildCategoryPack(
  brief: CategoryBrief,
  llm = new LLMClient(),
): Promise<CategoryPack> {
  const raw = await llm.completeJson<Record<string, unknown>>({
    // Strategy-grade model for the pack; this runs once per category.
    messages: [
      {
        role: "system",
        content:
          "You are a Market Intelligence council (category analyst, review miner, " +
          "pricing analyst, compliance analyst). Produce a rigorous, evidence-led " +
          "category operating model. Phrase unmet needs and triggers in real " +
          "customer language. CRITICAL: competitor archetypes must be DISGUISED " +
          "with codeNames (e.g. ARCH-COMMODITY) and never name real brands.",
      },
      {
        role: "user",
        content:
          `Brief:\n${JSON.stringify(brief, null, 2)}\n\n` +
          `Produce a CategoryPack JSON with EXACTLY these keys:\n` +
          `- id (slug), name, currency, geography\n` +
          `- unmetNeeds[] (5-7, customer language)\n` +
          `- purchaseTriggers[] (4-6)\n` +
          `- rejectionReasons[] (4-6)\n` +
          `- priceBands[] of { label, lowMinor, highMinor } in MINOR units of ${brief.currency}\n` +
          `- competitorArchetypes[] (3-5) of { codeName, description, ` +
          `pricePositioning, claims[], strengths[], weaknesses[] } — DISGUISED, no real names\n` +
          `- complianceNotes[] (category-specific legal/claims constraints)\n` +
          `- buyerSegments[] of { seed, weight } where weights sum to ~1.0\n` +
          `Return ONLY the JSON object.`,
      },
    ],
    temperature: 0.5,
  });

  const id = String(raw.id ?? slug(brief.category));
  const pack = CategoryPackSchema.parse({ ...raw, id });
  pack.buyerSegments = normalizeWeights(pack.buyerSegments);
  return pack;
}

export async function savePack(pack: CategoryPack, dir = "packs"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${pack.id}.json`;
  await Bun.write(path, JSON.stringify(pack, null, 2));
  return path;
}

function normalizeWeights<T extends { weight: number }>(segs: T[]): T[] {
  const total = segs.reduce((a, s) => a + (s.weight || 0), 0);
  if (total <= 0) return segs.map((s) => ({ ...s, weight: 1 / segs.length }));
  return segs.map((s) => ({ ...s, weight: s.weight / total }));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
