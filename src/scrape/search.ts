import { fetchRaw, sleep } from "./http.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const READER = "https://r.jina.ai/";

// SearXNG instances exposing format=json. Rotated; most rate-limit, so we try
// a few and take the first that answers.
const SEARX = [
  "https://opnxng.com",
  "https://search.rhscz.eu",
  "https://paulgo.io",
  "https://searx.tiekoetter.com",
  "https://priv.au",
];

function host(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

function isJunk(u: string): boolean {
  return /(^|\.)(duckduckgo|bing|google|microsoft|msn|yahoo|jina\.ai|marginalia|searx|w3\.org|gstatic|youtube\.com\/redirect)/i.test(
    host(u),
  );
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = r.url.replace(/[#?].*$/, "");
    if (!r.url || isJunk(r.url) || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Provider 0 (preferred): keyed search APIs. Auto-detected from env. These are
 * the quality path for harvesting at scale; the no-key providers below are a
 * best-effort fallback that mainstream sites heavily rate-limit.
 *   PB_SERPER_KEY  -> serper.dev (Google)
 *   PB_BRAVE_KEY   -> Brave Search API
 *   PB_TAVILY_KEY  -> Tavily
 */
async function viaKeyed(query: string, limit: number): Promise<SearchResult[]> {
  const serper = process.env.PB_SERPER_KEY;
  if (serper) {
    try {
      const raw = await fetchRaw("https://google.serper.dev/search", {
        method: "POST",
        timeoutMs: 15000,
        retries: 1,
        headers: { "X-API-KEY": serper, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: limit }),
      });
      const j = JSON.parse(raw) as { organic?: { title: string; link: string; snippet?: string }[] };
      const out = (j.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" }));
      if (out.length) return dedupe(out).slice(0, limit);
    } catch {
      /* fall through */
    }
  }
  const brave = process.env.PB_BRAVE_KEY;
  if (brave) {
    try {
      const raw = await fetchRaw(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
        { timeoutMs: 15000, retries: 1, headers: { "X-Subscription-Token": brave, Accept: "application/json" } },
      );
      const j = JSON.parse(raw) as { web?: { results?: { title: string; url: string; description?: string }[] } };
      const out = (j.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description ?? "" }));
      if (out.length) return dedupe(out).slice(0, limit);
    } catch {
      /* fall through */
    }
  }
  const tavily = process.env.PB_TAVILY_KEY;
  if (tavily) {
    try {
      const raw = await fetchRaw("https://api.tavily.com/search", {
        method: "POST",
        timeoutMs: 20000,
        retries: 1,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavily, query, max_results: limit, search_depth: "advanced" }),
      });
      const j = JSON.parse(raw) as { results?: { title: string; url: string; content?: string }[] };
      const out = (j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
      if (out.length) return dedupe(out).slice(0, limit);
    } catch {
      /* fall through */
    }
  }
  return [];
}

/** Provider A: SearXNG JSON (when an instance answers). */
async function viaSearx(query: string, limit: number): Promise<SearchResult[]> {
  for (const base of SEARX) {
    try {
      const u =
        `${base}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
      const raw = await fetchRaw(u, {
        timeoutMs: 12000,
        retries: 0,
        headers: { Accept: "application/json" },
      });
      const j = JSON.parse(raw) as { results?: { url: string; title: string; content?: string }[] };
      const out = (j.results ?? []).map((r) => ({
        url: r.url,
        title: r.title ?? "",
        snippet: r.content ?? "",
      }));
      if (out.length) return out.slice(0, limit);
    } catch {
      /* next instance */
    }
    await sleep(150);
  }
  return [];
}

/** Provider B: render a SERP through the Jina reader and extract markdown links. */
async function viaReaderSerp(query: string, limit: number): Promise<SearchResult[]> {
  const serps = [
    `https://search.marginalia.nu/search?query=${encodeURIComponent(query)}`,
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  ];
  for (const serp of serps) {
    try {
      const md = await fetchRaw(READER + serp, {
        timeoutMs: 30000,
        retries: 1,
        headers: { "X-With-Links-Summary": "true" },
      });
      const links = [...md.matchAll(/\[([^\]]{6,120})\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => ({
        title: cleanTitle(m[1]!),
        url: m[2]!,
        snippet: "",
      }));
      const out = dedupe(links);
      if (out.length) return out.slice(0, limit);
    } catch {
      /* next serp */
    }
  }
  return [];
}

/** Provider C: DuckDuckGo lite POST (works intermittently). */
async function viaDdgLite(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const html = await fetchRaw("https://lite.duckduckgo.com/lite/", {
      method: "POST",
      body: new URLSearchParams({ q: query, kl: "in-en" }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeoutMs: 15000,
      retries: 2,
    });
    const out: SearchResult[] = [];
    const re = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      out.push({ url: decodeUddg(m[1]!), title: cleanTitle(m[2]!), snippet: "" });
    }
    return dedupe(out).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Programmatic web search, no API key. Tries scripted providers in order and
 * returns the first non-empty, deduped result set. If all fail (heavy bot
 * gating), returns [] — the harvester then relies on snippets/other queries,
 * and agent-browser can be used as a manual fallback (see README).
 */
export async function webSearch(query: string, limit = 12): Promise<SearchResult[]> {
  for (const provider of [viaKeyed, viaSearx, viaReaderSerp, viaDdgLite]) {
    const out = await provider(query, limit).catch(() => []);
    if (out.length) return out;
  }
  return [];
}

function cleanTitle(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[\u00ad\u200b]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeUddg(href: string): string {
  try {
    if (href.startsWith("//")) href = "https:" + href;
    const u = new URL(href, "https://duckduckgo.com");
    return u.searchParams.get("uddg") ? decodeURIComponent(u.searchParams.get("uddg")!) : href;
  } catch {
    return href;
  }
}
