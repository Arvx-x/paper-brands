import { loadConfig } from "../config.ts";
import type { ResearchResult } from "./openaiSearch.ts";

/**
 * Gemini grounded web search via the `google_search` tool. Returns synthesized
 * text plus grounding citations (real retailer/domain titles). Complements
 * OpenAI search — Google's index surfaces Shopping/marketplace results well.
 */
export async function geminiResearch(query: string, system?: string): Promise<ResearchResult> {
  const cfg = loadConfig();
  const key = cfg.providers.google?.apiKey;
  if (!key) throw new Error("Gemini search requires PB_GOOGLE_API_KEY");
  const model = process.env.PB_GEMINI_SEARCH_MODEL ?? "gemini-2.5-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: query }] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        tools: [{ google_search: {} }],
      }),
    },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini search failed (${res.status}): ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
    }[];
  };
  const c = data.candidates?.[0];
  const content = (c?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const seen = new Set<string>();
  const citations: { url: string; title: string }[] = [];
  for (const ch of c?.groundingMetadata?.groundingChunks ?? []) {
    const url = ch.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({ url, title: ch.web?.title ?? "" });
  }
  return { query, content, citations };
}

export function isGeminiSearchAvailable(): boolean {
  return !!loadConfig().providers.google?.apiKey;
}
