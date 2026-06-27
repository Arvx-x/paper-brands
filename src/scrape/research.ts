import { openaiResearch, isOpenAISearchAvailable, type ResearchResult } from "./openaiSearch.ts";
import { geminiResearch, isGeminiSearchAvailable } from "./geminiSearch.ts";
import { webSearch, type SearchResult } from "./search.ts";

export type { ResearchResult };
export type Provider = "openai" | "gemini";

export function availableProviders(): Provider[] {
  const out: Provider[] = [];
  if (isOpenAISearchAvailable()) out.push("openai");
  if (isGeminiSearchAvailable()) out.push("gemini");
  return out;
}

/**
 * Pure merge of multiple ResearchResults plus keyed-search (Tavily/Brave/Serper)
 * results. Dedupes citations by url; appends each web result's cleaned snippet to
 * the content so it becomes quotable text for the grounding pipeline.
 */
export function mergeResearch(
  query: string,
  results: ResearchResult[],
  web: SearchResult[],
): ResearchResult {
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

  for (const w of web) {
    if (!seen.has(w.url)) {
      seen.add(w.url);
      citations.push({ url: w.url, title: w.title });
    }
    // Tavily returns cleaned content in `snippet` — append so it is quotable.
    if (w.snippet && w.snippet.trim().length > 0) {
      contents.push(`[${w.title}] ${w.snippet}`);
    }
  }

  return { query, content: contents.join("\n\n"), citations };
}

/**
 * Run a query across all available web-search providers and merge. Two LLM-grounded
 * indexes (OpenAI + Gemini) surface different sources; keyed search (Tavily/Brave/
 * Serper, when a key is set) adds real review/community URLs the grounded indexes
 * miss and returns cleaned content directly. All additive: with no keyed-search key,
 * behavior is identical to the LLM-only path.
 */
export async function multiResearch(query: string, system?: string): Promise<ResearchResult> {
  const fns: Promise<ResearchResult>[] = [];
  if (isOpenAISearchAvailable()) fns.push(openaiResearch(query, system).catch(emptyFor(query)));
  if (isGeminiSearchAvailable()) fns.push(geminiResearch(query, system).catch(emptyFor(query)));
  const results = await Promise.all(fns);
  // Keyed search runs only when a provider key (PB_TAVILY_KEY/PB_BRAVE_KEY/PB_SERPER_KEY)
  // is set; otherwise webSearch returns [] and this is a no-op.
  const web = await webSearch(query).catch(() => [] as SearchResult[]);
  return mergeResearch(query, results, web);
}

function emptyFor(query: string) {
  return (): ResearchResult => ({ query, content: "", citations: [] });
}
