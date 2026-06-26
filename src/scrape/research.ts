import { openaiResearch, isOpenAISearchAvailable, type ResearchResult } from "./openaiSearch.ts";
import { geminiResearch, isGeminiSearchAvailable } from "./geminiSearch.ts";

export type Provider = "openai" | "gemini";

export function availableProviders(): Provider[] {
  const out: Provider[] = [];
  if (isOpenAISearchAvailable()) out.push("openai");
  if (isGeminiSearchAvailable()) out.push("gemini");
  return out;
}

/**
 * Run a query across all available web-search providers and merge. Two indexes
 * (OpenAI + Google/Gemini) surface different sources, which widens coverage —
 * critical for finding "as many options as possible" when sampling prices.
 */
export async function multiResearch(query: string, system?: string): Promise<ResearchResult> {
  const fns: Promise<ResearchResult>[] = [];
  if (isOpenAISearchAvailable()) fns.push(openaiResearch(query, system).catch(emptyFor(query)));
  if (isGeminiSearchAvailable()) fns.push(geminiResearch(query, system).catch(emptyFor(query)));
  const results = await Promise.all(fns);

  const seen = new Set<string>();
  const citations: { url: string; title: string }[] = [];
  const contents: string[] = [];
  for (const r of results) {
    if (r.content) contents.push(r.content);
    for (const c of r.citations) {
      if (seen.has(c.url)) continue;
      seen.add(c.url);
      citations.push(c);
    }
  }
  return { query, content: contents.join("\n\n"), citations };
}

function emptyFor(query: string) {
  return (): ResearchResult => ({ query, content: "", citations: [] });
}
