import { loadConfig, resolveModel } from "../config.ts";

export interface Citation {
  title: string;
  url: string;
  /** Cleaned snippet from keyed search (e.g. Tavily) — fallback content when the
   * page itself is bot-walled (Reddit). Optional. */
  content?: string;
}

export interface ResearchResult {
  query: string;
  /** Model-synthesized answer grounded in live web results. */
  content: string;
  citations: Citation[];
}

/**
 * Native OpenAI web search via the `*-search-preview` models. Returns a
 * synthesized, citation-grounded answer plus the source URLs — far higher
 * signal than scraping bot-gated SERPs. The synthesized text is itself usable
 * as evidence; the citations point at real review/complaint/guide sources.
 */
const DEFAULT_RESEARCH_SYSTEM =
  "You are a market researcher. Answer with concrete, specific findings " +
  "grounded in the web results — real customer complaints, unmet needs, " +
  "price points (with currency), and brand/product patterns. Quote real " +
  "phrasing where useful. Be dense and factual, not generic.";

export async function openaiResearch(
  query: string,
  system: string = DEFAULT_RESEARCH_SYSTEM,
): Promise<ResearchResult> {
  const cfg = loadConfig();
  const searchRef = process.env.PB_SEARCH_MODEL ?? "openai:gpt-4o-mini-search-preview";
  const { model, conf } = resolveModel(searchRef, cfg);

  const res = await fetch(`${conf.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conf.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      web_search_options: {},
      messages: [
        { role: "system", content: system },
        { role: "user", content: query },
      ],
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI web search failed (${res.status}): ${t.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: {
      message?: {
        content?: string;
        annotations?: { type: string; url_citation?: { url: string; title?: string } }[];
      };
    }[];
  };
  const msg = data.choices?.[0]?.message;
  const content = msg?.content ?? "";
  const seen = new Set<string>();
  const citations: Citation[] = [];
  for (const a of msg?.annotations ?? []) {
    const c = a.url_citation;
    if (!c?.url || seen.has(c.url)) continue;
    seen.add(c.url);
    citations.push({ url: c.url, title: c.title ?? "" });
  }
  return { query, content, citations };
}

export function isOpenAISearchAvailable(): boolean {
  const cfg = loadConfig();
  return !!cfg.providers.openai?.apiKey;
}
