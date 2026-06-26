import { multiResearch } from "../scrape/research.ts";
import type { BrandConcept } from "../brand/types.ts";

export interface CreativeResearch {
  category: string;
  /** Distilled observations about how strong competitor creatives look + read. */
  notes: string;
  citationCount: number;
}

/**
 * Competitor-creative research: find what high-quality creatives in this
 * category actually look like — palettes, photography styles, hooks, layouts,
 * and the tropes that signal "cheap" — so the BrandKit can deliberately match
 * the quality bar while differentiating. Reuses the multi-provider web search.
 */
export async function researchCreatives(
  concept: BrandConcept,
  category: string,
): Promise<CreativeResearch> {
  const lensSystem =
    "You are a creative/art-direction analyst studying advertising and packaging " +
    "visuals. Describe concretely: dominant palettes, photography vs illustration, " +
    "lighting, typography styles, layout patterns, the hooks/claims used in ad copy, " +
    "and visual tropes that look premium vs cheap. Be specific and visual.";

  const queries = [
    `best ${category} brand advertising creative examples visual style`,
    `${category} packaging design trends premium aesthetic`,
    `high performing ${category} social media ad creative hooks`,
    `${category} brand photography art direction color palette`,
  ];

  const results = await Promise.all(
    queries.map((q) => multiResearch(q, lensSystem).catch(() => ({ query: q, content: "", citations: [] }))),
  );

  const seen = new Set<string>();
  let citationCount = 0;
  for (const r of results) for (const c of r.citations) if (!seen.has(c.url)) (seen.add(c.url), citationCount++);

  const notes = results
    .filter((r) => r.content)
    .map((r) => `## ${r.query}\n${r.content}`)
    .join("\n\n")
    .slice(0, 12000);

  return { category, notes, citationCount };
}
