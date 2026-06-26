import { mkdir } from "node:fs/promises";
import { webSearch, type SearchResult } from "./search.ts";
import { fetchReadable, sleep } from "./http.ts";

export interface HarvestOptions {
  category: string;
  geography?: string;
  /** Queries per intent template; more = broader corpus. */
  resultsPerQuery?: number;
  /** How many result pages to fetch full text for (the slow part). */
  pagesToFetch?: number;
  concurrency?: number;
  outDir?: string;
}

export interface HarvestDoc {
  url: string;
  title: string;
  snippet: string;
  query: string;
  text?: string; // full-page extracted text (truncated)
}

export interface Corpus {
  category: string;
  geography: string;
  harvestedAt: string;
  queries: string[];
  docs: HarvestDoc[];
}

/** Intent-driven query plan — what a category analyst would actually search. */
function queryPlan(category: string, geo: string): string[] {
  const c = category;
  const g = geo ? ` ${geo}` : "";
  return [
    `best ${c}${g} 2024`,
    `${c} reviews complaints problems`,
    `${c} not worth it disappointed review`,
    `${c} buying guide what to look for`,
    `${c}${g} price comparison`,
    `${c} ingredients to avoid`,
    `why ${c} doesn't work`,
    `${c} reddit recommendations`,
    `top ${c} brands${g}`,
    `${c} customer reviews amazon`,
  ];
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]!, idx);
      }
    }),
  );
}

/**
 * Immense, programmatic harvest for a category:
 *  1) run an intent-driven query plan via webSearch (scripted, no API key)
 *  2) dedupe results into candidate docs
 *  3) fetch + extract full text for the top docs (scripted fetch + HTMLRewriter)
 *  4) save the corpus to data/<id>/corpus.json
 *
 * Agent-browser is intentionally NOT used here — this is the scripted path.
 * Blocked / JS-only pages simply contribute their search snippet.
 */
export async function harvest(opts: HarvestOptions): Promise<Corpus> {
  const geography = opts.geography ?? "";
  const resultsPerQuery = opts.resultsPerQuery ?? 10;
  const pagesToFetch = opts.pagesToFetch ?? 25;
  const concurrency = opts.concurrency ?? 5;
  const queries = queryPlan(opts.category, geography);

  console.error(`[harvest] ${queries.length} queries for "${opts.category}"...`);
  const all: HarvestDoc[] = [];
  // Sequential search to be polite to the search endpoint.
  for (const q of queries) {
    const results: SearchResult[] = await webSearch(q, resultsPerQuery).catch(() => []);
    for (const r of results) all.push({ ...r, query: q });
    console.error(`  "${q}" -> ${results.length} results`);
    await sleep(300 + Math.random() * 300);
  }

  // Dedupe by URL.
  const byUrl = new Map<string, HarvestDoc>();
  for (const d of all) if (!byUrl.has(d.url)) byUrl.set(d.url, d);

  // Relevance filter: drop off-topic junk from noisy no-key search by requiring
  // at least one meaningful category token in the title/snippet.
  const tokens = relevanceTokens(opts.category);
  const relevant = [...byUrl.values()].filter((d) => {
    const hay = `${d.title} ${d.snippet}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
  const docs = relevant.length >= 5 ? relevant : [...byUrl.values()];
  console.error(
    `[harvest] ${byUrl.size} unique, ${relevant.length} relevant; fetching top ${pagesToFetch}...`,
  );

  // Fetch full text for the top N docs concurrently.
  const toFetch = docs.slice(0, pagesToFetch);
  let ok = 0;
  await pool(toFetch, concurrency, async (doc) => {
    const text = await fetchReadable(doc.url, 12000).catch(() => "");
    if (text.length > 200) {
      doc.text = text.slice(0, 6000);
      ok++;
    }
  });
  console.error(`[harvest] fetched full text for ${ok}/${toFetch.length} docs`);

  const corpus: Corpus = {
    category: opts.category,
    geography,
    harvestedAt: new Date().toISOString(),
    queries,
    docs,
  };

  const dir = opts.outDir ?? `data/${slug(opts.category)}`;
  await mkdir(dir, { recursive: true });
  await Bun.write(`${dir}/corpus.json`, JSON.stringify(corpus, null, 2));
  console.error(`[harvest] saved -> ${dir}/corpus.json`);
  return corpus;
}

/** Compact the corpus into an evidence string for the intel agents. */
export function corpusToEvidence(corpus: Corpus, maxChars = 24000): string {
  const parts: string[] = [];
  for (const d of corpus.docs) {
    const body = d.text ?? d.snippet;
    if (!body) continue;
    parts.push(`### ${d.title}\n(${hostname(d.url)}) [q: ${d.query}]\n${body.slice(0, 1200)}`);
    if (parts.join("\n\n").length > maxChars) break;
  }
  return parts.join("\n\n").slice(0, maxChars);
}

/** Meaningful tokens from the category for relevance filtering. */
function relevanceTokens(category: string): string[] {
  const stop = new Set(["the", "and", "for", "with", "best", "face", "skin"]);
  return category
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !stop.has(t));
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
