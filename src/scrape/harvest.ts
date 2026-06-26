import { mkdir } from "node:fs/promises";
import { multiResearch, availableProviders } from "./research.ts";
import { gatherPriceIntel, type PriceIntel } from "./prices.ts";
import { ANALYSTS, type Analyst } from "../intel/analysts.ts";

export interface HarvestOptions {
  category: string;
  geography?: string;
  currency?: string;
  /** Limit which analyst lenses run (by id); default: all. */
  lenses?: string[];
  concurrency?: number;
  outDir?: string;
}

export interface LensFinding {
  lens: string;
  query: string;
  content: string;
  citations: { url: string; title: string }[];
}

export interface Corpus {
  category: string;
  geography: string;
  currency: string;
  harvestedAt: string;
  lenses: Record<string, LensFinding[]>;
  price: PriceIntel;
  citationCount: number;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

/** Run one analyst's full query plan via OpenAI web search under its lens. */
async function runAnalyst(
  analyst: Analyst,
  category: string,
  geo: string,
  concurrency: number,
): Promise<LensFinding[]> {
  const queries = analyst.queries(category, geo);
  const findings: LensFinding[] = [];
  await pool(queries, concurrency, async (q) => {
    try {
      const r = await multiResearch(q, analyst.system);
      if (r.content) {
        findings.push({ lens: analyst.lens, query: q, content: r.content, citations: r.citations });
      }
    } catch {
      /* skip failed query */
    }
  });
  return findings;
}

/**
 * Multifaceted harvest: a TEAM of analyst agents, each owning a lens (social
 * chatter, X/Instagram, marketplace, editorial reviews, competitive, trends),
 * runs its own query plan over OpenAI web search. A dedicated marketplace
 * pricing pass pulls REAL SKU prices and derives sane price bands.
 */
export async function harvest(opts: HarvestOptions): Promise<Corpus> {
  const geography = opts.geography ?? "";
  const currency = opts.currency ?? "INR";
  const concurrency = opts.concurrency ?? 3;

  const providers = availableProviders();
  if (!providers.length) {
    throw new Error("Web search requires PB_API_KEY (OpenAI) and/or PB_GOOGLE_API_KEY (Gemini).");
  }

  const team = ANALYSTS.filter((a) => !opts.lenses || opts.lenses.includes(a.id));
  console.error(
    `[harvest] research team of ${team.length} analysts for "${opts.category}"` +
      `${geography ? " (" + geography + ")" : ""} via [${providers.join(", ")}]`,
  );

  // Analysts run concurrently; price intel runs alongside.
  const lensesEntries: [string, LensFinding[]][] = [];
  const work = team.map(async (a) => {
    const findings = await runAnalyst(a, opts.category, geography, concurrency);
    const cites = findings.reduce((n, f) => n + f.citations.length, 0);
    console.error(`  [${a.id}] ${findings.length} findings, ${cites} citations`);
    lensesEntries.push([a.id, findings]);
  });
  const pricePromise = gatherPriceIntel(opts.category, geography, currency)
    .then((pi) => {
      const s = pi.stats;
      console.error(
        `  [pricing] ${pi.observations.length} SKUs (${pi.dropped} trimmed)` +
          (s ? `, median ${currency}${s.median}${s.medianPerGram ? ` (${currency}${s.medianPerGram}/g)` : ""}` : ""),
      );
      for (const b of pi.buckets) {
        console.error(
          `    ${b.label}: ${currency}${b.lowMinor / 100}-${b.highMinor / 100} ` +
            `(${Math.round(b.share * 100)}%, n=${b.count}) e.g. ${b.examples[0] ?? ""}`,
        );
      }
      if (!pi.buckets.length) console.error(`    (insufficient price data)`);
      return pi;
    })
    .catch(
      () =>
        ({ currency, observations: [], dropped: 0, bands: [], buckets: [], stats: null }) satisfies PriceIntel,
    );

  const [, price] = await Promise.all([Promise.all(work), pricePromise]);

  const lenses: Record<string, LensFinding[]> = {};
  for (const [id, f] of lensesEntries) lenses[id] = f;
  const citationCount = Object.values(lenses)
    .flat()
    .reduce((n, f) => n + f.citations.length, 0);

  const corpus: Corpus = {
    category: opts.category,
    geography,
    currency,
    harvestedAt: new Date().toISOString(),
    lenses,
    price,
    citationCount,
  };

  const dir = opts.outDir ?? `data/${slug(opts.category)}`;
  await mkdir(dir, { recursive: true });
  await Bun.write(`${dir}/corpus.json`, JSON.stringify(corpus, null, 2));
  console.error(`[harvest] saved -> ${dir}/corpus.json`);
  return corpus;
}

/** Compact the multi-lens corpus into an evidence string for the intel agents. */
export function corpusToEvidence(corpus: Corpus, maxChars = 28000): string {
  const parts: string[] = [];
  for (const [id, findings] of Object.entries(corpus.lenses)) {
    if (!findings.length) continue;
    parts.push(`## LENS: ${id} — ${findings[0]!.lens}`);
    for (const f of findings) {
      parts.push(`### ${f.query}\n${f.content.slice(0, 1500)}`);
    }
  }
  if (corpus.price.observations.length) {
    const s = corpus.price.stats;
    const obs = corpus.price.observations
      .slice(0, 30)
      .map(
        (o) =>
          `${corpus.currency}${o.price} ${o.brand} ${o.product}` +
          (o.packSize ? ` (${o.packSize}${o.pricePerGram ? `, ${corpus.currency}${o.pricePerGram}/g` : ""})` : ""),
      )
      .join("; ");
    const summary = s
      ? `n=${s.n} min=${s.min} p25=${s.p25} median=${s.median} p75=${s.p75} max=${s.max}` +
        (s.medianPerGram ? ` medianPerGram=${s.medianPerGram}` : "")
      : "";
    parts.push(`## OBSERVED PRICES (${summary})\n${obs}`);
  }
  return parts.join("\n\n").slice(0, maxChars);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
