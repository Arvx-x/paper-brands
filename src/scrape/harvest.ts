import { mkdir } from "node:fs/promises";
import { multiResearch, availableProviders } from "./research.ts";
import { gatherPriceIntel, type PriceIntel } from "./prices.ts";
import { resolvePlan, type ResearchPlan, type ResearchLens } from "../intel/plan.ts";
import { buildSourceRegistry, sourceDiversity, type SourceDoc } from "./sources.ts";
import type { Provenance } from "../categories/types.ts";

export interface HarvestOptions {
  category: string;
  geography?: string;
  currency?: string;
  /** Limit which analyst lenses run (by id); default: all in the plan. */
  lenses?: string[];
  concurrency?: number;
  /** "auto" derives a category-tailored plan (default); "default" uses the generic one. */
  planMode?: "auto" | "default";
  outDir?: string;
  /** Optional event callback for live UI streaming. Absent = no-op. */
  onEvent?: (e: { type: string; [k: string]: unknown }) => void;
}

export interface LensFinding {
  lens: string;
  query: string;
  content: string;
  citations: { url: string; title: string; content?: string }[];
}

/** Per-lens evidence coverage — makes silent query failures visible. */
export interface LensCoverage {
  id: string;
  planned: number; // queries in the plan
  succeeded: number; // queries that returned content
  failed: number; // queries that errored or returned empty
  findings: number;
  citations: number;
}

/** Corpus-wide coverage + honesty signals. */
export interface Coverage {
  lensesPlanned: number;
  lensesSucceeded: number; // lenses with >=1 finding
  missingLenses: string[]; // planned lenses that produced nothing
  perLens: LensCoverage[];
  providersAvailable: string[];
  citationCountRaw: number; // raw additive count (usually inflated)
  distinctDomains: number; // unique real source domains (from fetched registry)
  /** Distinct domains that are independent (community/editorial/regulator). */
  independentDomains: number;
  /** Distinct sources we actually fetched raw text for (quotable). */
  fetchedSources: number;
  /** Source counts per incentive-class (the honest diversity signal). */
  sourceClassCounts: Record<string, number>;
  /** Did any surviving finding capture negative/complaint evidence? */
  negativeEvidenceCovered: boolean;
  /** Coverage fell below threshold or negative evidence is missing. */
  degraded: boolean;
}

export interface Corpus {
  category: string;
  geography: string;
  currency: string;
  harvestedAt: string;
  /** The research plan that produced this corpus (provenance). */
  plan: ResearchPlan;
  lenses: Record<string, LensFinding[]>;
  /** Fetched source documents (raw text) — claims bind to these by quote. */
  sources: SourceDoc[];
  price: PriceIntel;
  citationCount: number;
  coverage: Coverage;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, n) }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

/**
 * Run one lens's full query plan across available web-search providers.
 * Failures are COUNTED, never silently swallowed, so coverage stays honest.
 */
async function runLens(
  lens: ResearchLens,
  concurrency: number,
): Promise<{ findings: LensFinding[]; coverage: LensCoverage }> {
  const findings: LensFinding[] = [];
  let succeeded = 0;
  let failed = 0;
  await pool(lens.queries, concurrency, async (q) => {
    try {
      const r = await multiResearch(q, lens.system);
      if (r.content) {
        findings.push({ lens: lens.lens, query: q, content: r.content, citations: r.citations });
        succeeded++;
      } else {
        failed++; // empty result is a coverage gap, not a no-op
      }
    } catch {
      failed++;
    }
  });
  const citations = findings.reduce((n, f) => n + f.citations.length, 0);
  return {
    findings,
    coverage: { id: lens.id, planned: lens.queries.length, succeeded, failed, findings: findings.length, citations },
  };
}

/** A query/finding carries negative (complaint/dissatisfaction) evidence. */
const NEGATIVE_RE = /complaint|1\s*star|one star|doesn'?t work|disappoint|hate|irritat|returns?|refund|waste of money|broke|stopped working|allerg/i;

/**
 * Multifaceted harvest: a TEAM of analyst lenses (from the category's
 * ResearchPlan) each runs its own query plan over web search; a dedicated
 * marketplace pricing pass pulls REAL SKU prices and derives price bands using
 * the category's own unit-of-measure. Nothing here is category-specific — the
 * plan supplies all the vertical knowledge.
 */
export async function harvest(opts: HarvestOptions): Promise<Corpus> {
  const geography = opts.geography ?? "";
  const currency = opts.currency ?? "USD";
  const concurrency = opts.concurrency ?? 3;

  const providers = availableProviders();
  if (!providers.length) {
    throw new Error("Web search requires PB_API_KEY (OpenAI) and/or PB_GOOGLE_API_KEY (Gemini).");
  }

  const plan = await resolvePlan(
    { category: opts.category, geography, currency },
    { mode: opts.planMode },
  );
  const team = plan.lenses.filter((l) => !opts.lenses || opts.lenses.includes(l.id));
  console.error(
    `[harvest] research team of ${team.length} lenses for "${opts.category}"` +
      `${geography ? " (" + geography + ")" : ""} via [${providers.join(", ")}]` +
      `, unit-of-measure: ${plan.unitOfMeasure.kind}`,
  );

  const lensesEntries: [string, LensFinding[]][] = [];
  const perLens: LensCoverage[] = [];
  const work = team.map(async (l) => {
    const { findings, coverage } = await runLens(l, concurrency);
    console.error(
      `  [${l.id}] ${findings.length} findings, ${coverage.citations} citations` +
        (coverage.failed ? ` (${coverage.failed}/${coverage.planned} queries failed)` : ""),
    );
    opts.onEvent?.({ type: "harvest-lens-done", lensId: l.id, findings: findings.length, citations: coverage.citations });
    lensesEntries.push([l.id, findings]);
    perLens.push(coverage);
  });

  const pricePromise = gatherPriceIntel(opts.category, geography, currency, {
    retailers: plan.retailers,
    subtypes: plan.subtypes,
    unitOfMeasure: plan.unitOfMeasure,
  })
    .then((pi) => {
      const s = pi.stats;
      const u = pi.unit;
      console.error(
        `  [pricing] ${pi.observations.length} SKUs (${pi.dropped} trimmed)` +
          (s ? `, median ${currency}${s.median}${s.medianPerUnit ? ` (${currency}${s.medianPerUnit}/${u})` : ""}` : ""),
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
        ({ currency, unit: plan.unitOfMeasure.unit, observations: [], dropped: 0, bands: [], buckets: [], stats: null }) satisfies PriceIntel,
    );

  const [, price] = await Promise.all([Promise.all(work), pricePromise]);
  opts.onEvent?.({ type: "harvest-price-done", skus: price.observations.length, bands: price.buckets.map((b) => ({ label: b.label, min: b.lowMinor / 100, max: b.highMinor / 100, share: Math.round(b.share * 100) })) });

  const lenses: Record<string, LensFinding[]> = {};
  for (const [id, f] of lensesEntries) lenses[id] = f;
  const allFindings = Object.values(lenses).flat();
  const citationCount = allFindings.reduce((n, f) => n + f.citations.length, 0);

  // Fetch the cited pages: claims will bind to RAW source text, not provider
  // paraphrases. Redirect blobs resolve to their final page during fetch.
  console.error(`[harvest] fetching raw sources from ${citationCount} citations...`);
  const allCitations = allFindings.flatMap((f) => f.citations);
  const sources = await buildSourceRegistry(allCitations, { concurrency: 6, maxSources: 80 });
  const div = sourceDiversity(sources);
  console.error(
    `  [sources] ${div.fetchedCount}/${sources.length} fetched, ${div.distinctDomains} domains ` +
      `(${div.independentDomains} independent) | ` +
      Object.entries(div.byClass).map(([k, v]) => `${k}:${v}`).join(" "),
  );
  opts.onEvent?.({ type: "harvest-sources-done", fetched: div.fetchedCount, total: sources.length, domains: div.distinctDomains, independent: div.independentDomains, degraded: false });

  // Negative evidence must come from RETURNED CONTENT / fetched text, not a
  // planned query string — else a positivity-biased corpus would falsely claim it.
  const negativeEvidenceCovered =
    allFindings.some((f) => NEGATIVE_RE.test(f.content)) ||
    sources.some((s) => NEGATIVE_RE.test(s.rawText));
  const lensesSucceeded = perLens.filter((c) => c.findings > 0).length;
  const missingLenses = team.filter((l) => !lenses[l.id]?.length).map((l) => l.id);
  const skuCount = price.observations.length;
  // Degraded now keys on INDEPENDENT domains + actually-fetched (quotable)
  // sources — raw citation counts and redirect blobs can no longer inflate it.
  const degraded =
    team.length === 0 ||
    lensesSucceeded < 3 ||
    !negativeEvidenceCovered ||
    div.independentDomains < 3 ||
    div.fetchedCount < 8 ||
    skuCount < 12;

  const coverage: Coverage = {
    lensesPlanned: team.length,
    lensesSucceeded,
    missingLenses,
    perLens,
    providersAvailable: providers,
    citationCountRaw: citationCount,
    distinctDomains: div.distinctDomains,
    independentDomains: div.independentDomains,
    fetchedSources: div.fetchedCount,
    sourceClassCounts: div.byClass,
    negativeEvidenceCovered,
    degraded,
  };

  if (degraded) {
    console.error(
      `[harvest] ⚠ DEGRADED corpus: ${lensesSucceeded}/${team.length} lenses, ` +
        `${div.independentDomains} independent domains, ${div.fetchedCount} fetched sources, ` +
        `${skuCount} SKUs, negative-evidence ${negativeEvidenceCovered ? "ok" : "MISSING"}` +
        (missingLenses.length ? `, missing lenses: ${missingLenses.join(",")}` : ""),
    );
  }

  const corpus: Corpus = {
    category: opts.category,
    geography,
    currency,
    harvestedAt: new Date().toISOString(),
    plan,
    lenses,
    sources,
    price,
    citationCount,
    coverage,
  };

  const dir = opts.outDir ?? `data/${slug(opts.category)}`;
  await mkdir(dir, { recursive: true });
  await Bun.write(`${dir}/corpus.json`, JSON.stringify(corpus, null, 2));
  console.error(`[harvest] saved -> ${dir}/corpus.json`);
  return corpus;
}

/**
 * Derive the pack provenance + a confidence grade from a corpus's coverage.
 * Confidence is deliberately conservative: thin or degraded evidence is "low"
 * so downstream steps (and the user) never treat anecdote as market truth.
 */
export function corpusProvenance(
  corpus: Corpus,
  opts: { truncated?: boolean; model?: string } = {},
): Provenance {
  const cov = corpus.coverage;
  const skuCount = corpus.price.observations.length;
  // Confidence keys on INDEPENDENT, FETCHED (quotable) sources — not raw counts.
  // This is a provisional grade from coverage; market.ts lowers it further if
  // the claims' attribution rate is poor (claims not actually bound to sources).
  const strong =
    cov.lensesSucceeded >= 4 &&
    cov.independentDomains >= 8 &&
    cov.fetchedSources >= 20 &&
    skuCount >= 25 &&
    cov.negativeEvidenceCovered;
  const ok =
    cov.lensesSucceeded >= 3 && cov.independentDomains >= 3 && cov.fetchedSources >= 8 && skuCount >= 12;
  const confidence: Provenance["confidence"] =
    !cov.degraded && strong ? "high" : !cov.degraded && ok ? "medium" : "low";
  return {
    // Grounded only if the corpus actually contains FETCHED evidence — an empty
    // or all-failed-fetch corpus must NOT masquerade as grounded.
    grounded: cov.lensesSucceeded > 0 && (cov.fetchedSources > 0 || skuCount > 0),
    harvestedAt: corpus.harvestedAt,
    lensesPlanned: cov.lensesPlanned,
    lensesSucceeded: cov.lensesSucceeded,
    missingLenses: cov.missingLenses,
    distinctDomains: cov.distinctDomains,
    independentDomains: cov.independentDomains,
    fetchedSources: cov.fetchedSources,
    sourceClassCounts: cov.sourceClassCounts,
    citationCountRaw: cov.citationCountRaw,
    // Attribution is computed later by market.ts once claims exist; 0 here.
    attributionRate: 0,
    attributedItems: 0,
    totalItems: 0,
    independentItems: 0,
    skuCount,
    providersUsed: cov.providersAvailable,
    truncated: opts.truncated ?? false,
    degraded: cov.degraded,
    model: opts.model,
    userVoices: 0,
    userSkus: 0,
    overridesApplied: [],
    confidence,
  };
}

/**
 * Compact the multi-lens corpus into an evidence string for the intel agents.
 * Returns whether the evidence was truncated so provenance can flag lost facts.
 */
export function corpusToEvidence(
  corpus: Corpus,
  maxChars = 32000,
): { text: string; truncated: boolean } {
  const parts: string[] = [];

  // RAW SOURCES — the quotable substrate. Independent sources (community /
  // editorial / regulator) are listed FIRST so honest/negative signal is not
  // crowded out of the budget by brand/affiliate copy.
  const fetched = corpus.sources.filter((s) => s.fetched && s.rawText);
  const ordered = [...fetched].sort((a, b) => Number(b.independent) - Number(a.independent));
  const srcBudget = Math.floor(maxChars * 0.8);
  let used = 0;
  const srcParts: string[] = [];
  for (const s of ordered) {
    const tag = s.independent ? "INDEPENDENT" : s.sourceClass;
    const block = `[${s.id}] (${tag} | ${s.domain} | ${s.finalUrl})\n${s.rawText.slice(0, 1100)}`;
    if (used + block.length > srcBudget) break;
    srcParts.push(block);
    used += block.length;
  }
  if (srcParts.length) {
    parts.push(
      `# RAW SOURCES — quote VERBATIM and cite the URL. Sources tagged (INDEPENDENT) are ` +
        `genuine customer/editorial voice; use those for needs/triggers/rejections.\n\n` +
        srcParts.join("\n\n"),
    );
  }

  // Lens summaries: orientation only. NOT quotable (they are provider paraphrase).
  const lensParts: string[] = [];
  for (const [id, findings] of Object.entries(corpus.lenses)) {
    if (!findings.length) continue;
    lensParts.push(`## ${id}\n` + findings.map((f) => f.content.slice(0, 400)).join(" | ").slice(0, 700));
  }
  if (lensParts.length) {
    parts.push(`# LENS SUMMARIES (orientation only — do NOT quote these)\n\n` + lensParts.join("\n\n"));
  }

  if (corpus.price.observations.length) {
    const s = corpus.price.stats;
    const u = corpus.price.unit;
    const obs = corpus.price.observations
      .slice(0, 30)
      .map(
        (o) =>
          `${corpus.currency}${o.price} ${o.brand} ${o.product}` +
          (o.packSize ? ` (${o.packSize}${o.pricePerUnit ? `, ${corpus.currency}${o.pricePerUnit}/${u}` : ""})` : ""),
      )
      .join("; ");
    const summary = s
      ? `n=${s.n} min=${s.min} p25=${s.p25} median=${s.median} p75=${s.p75} max=${s.max}` +
        (s.medianPerUnit ? ` medianPerUnit=${s.medianPerUnit}/${u}` : "")
      : "";
    parts.push(`## OBSERVED PRICES (${summary})\n${obs}`);
  }
  const full = parts.join("\n\n");
  return { text: full.slice(0, maxChars), truncated: full.length > maxChars };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
