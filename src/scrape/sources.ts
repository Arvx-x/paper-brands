import { fetchPage, domainOf, unwrapRedirect, type FetchedPage } from "./fetch.ts";

/**
 * Source incentive-class. Diversity must be measured over these CLASSES, not
 * raw domain count: 63 affiliate-SEO domains pushing the same sponsored top-5
 * are one viewpoint in 63 hats. `independent` marks classes that are not
 * commercially incentivized to push a product (used to weight need/trigger
 * claims and to compute honest source diversity).
 */
export type SourceClass =
  | "regulator"
  | "community"
  | "editorial"
  | "marketplace"
  | "brand"
  | "affiliate"
  | "market-report"
  | "unknown";

export interface SourceDoc {
  id: string; // stable label, e.g. "S1"
  requestedUrl: string;
  finalUrl: string;
  domain: string;
  title: string;
  sourceClass: SourceClass;
  independent: boolean;
  rawText: string;
  fetched: boolean;
  status: number;
}

const RULES: { cls: SourceClass; test: RegExp }[] = [
  { cls: "regulator", test: /\.gov(\.|$)|cdsco|fssai|fda\.gov|ec\.europa|legalmetrology|ayush|asci\b|bis\.gov/i },
  { cls: "community", test: /reddit\.com|quora\.com|mouthshut|stackexchange|(^|\.)forum|makeupalley/i },
  { cls: "marketplace", test: /amazon\.|flipkart|nykaa|myntra|meesho|purplle|tatacliq|bigbasket|blinkit|zepto|1mg\.|apollopharmacy|pharmeasy|ebay\.|walmart|jiomart|snapdeal/i },
  { cls: "market-report", test: /marketresearch|grandviewresearch|indexbox|researchandmarkets|360researchreports|persistencemarketresearch|mordorintelligence|imarcgroup|factmr|fortunebusinessinsights|marketsandmarkets/i },
  { cls: "affiliate", test: /marketing91|brandchanakya|hangar-?12|dial4trade|listicle|top-?\d+-|best-.*-(brands|review)|coupon|deals?\./i },
  { cls: "editorial", test: /vogue|cosmopolitan|elle|healthline|byrdie|allure|nytimes|theguardian|hindustantimes|timesofindia|indianexpress|ndtv|femina|thequint|vox|wirecutter|nykaa\.com\/beauty-book|magazine/i },
];

export function classifyDomain(domain: string): SourceClass {
  for (const r of RULES) if (r.test.test(domain)) return r.cls;
  return "unknown";
}

/** Independent = not commercially incentivized to push a specific product. */
export function isIndependent(cls: SourceClass): boolean {
  return cls === "regulator" || cls === "community" || cls === "editorial";
}

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>): Promise<void> {
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
 * Fetch every distinct cited URL, extract raw text, classify, and assign stable
 * ids. Dedups by FINAL url (after redirect unwrap) so the same page cited via
 * different redirect blobs collapses to one source — the basis for an honest
 * effective sample size.
 */
export async function buildSourceRegistry(
  citations: { url: string; title?: string }[],
  opts: { concurrency?: number; maxChars?: number; timeoutMs?: number; maxSources?: number } = {},
): Promise<SourceDoc[]> {
  // Dedup requested URLs first (cheap), then fetch, then dedup again by finalUrl.
  // Cap fetches: best-effort page fetching can't be unbounded (time, bot walls).
  const uniqueRequested = Array.from(
    new Map(citations.map((c) => [unwrapRedirect(c.url), c])).values(),
  ).slice(0, opts.maxSources ?? 80);

  const fetched: { page: FetchedPage; title: string }[] = [];
  await pool(uniqueRequested, opts.concurrency ?? 6, async (c) => {
    const page = await fetchPage(c.url, { maxChars: opts.maxChars, timeoutMs: opts.timeoutMs });
    fetched.push({ page, title: c.title ?? "" });
  });

  // Collapse to one SourceDoc per final URL; prefer a successful fetch.
  const byFinal = new Map<string, { page: FetchedPage; title: string }>();
  for (const f of fetched) {
    const key = f.page.finalUrl || f.page.requestedUrl;
    const existing = byFinal.get(key);
    if (!existing || (!existing.page.ok && f.page.ok)) byFinal.set(key, f);
  }

  let n = 0;
  const docs: SourceDoc[] = [];
  for (const { page, title } of byFinal.values()) {
    const domain = page.domain || domainOf(page.requestedUrl);
    const sourceClass = classifyDomain(domain);
    docs.push({
      id: `S${++n}`,
      requestedUrl: page.requestedUrl,
      finalUrl: page.finalUrl,
      domain,
      title,
      sourceClass,
      independent: isIndependent(sourceClass),
      rawText: page.text,
      fetched: page.ok,
      status: page.status,
    });
  }
  return docs;
}

/** Counts per source-class + independence — the honest diversity signal. */
export function sourceDiversity(docs: SourceDoc[]): {
  byClass: Record<string, number>;
  distinctDomains: number;
  independentDomains: number;
  fetchedCount: number;
} {
  const byClass: Record<string, number> = {};
  const domains = new Set<string>();
  const indepDomains = new Set<string>();
  let fetchedCount = 0;
  for (const d of docs) {
    byClass[d.sourceClass] = (byClass[d.sourceClass] ?? 0) + 1;
    if (d.domain) {
      domains.add(d.domain);
      if (d.independent) indepDomains.add(d.domain);
    }
    if (d.fetched) fetchedCount++;
  }
  return {
    byClass,
    distinctDomains: domains.size,
    independentDomains: indepDomains.size,
    fetchedCount,
  };
}
