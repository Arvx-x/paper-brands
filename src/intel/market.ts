import { mkdir } from "node:fs/promises";
import { LLMClient } from "../llm/client.ts";
import { loadConfig } from "../config.ts";
import {
  CategoryPackSchema,
  type CategoryPack,
  type Provenance,
  type EvidencedItem,
} from "../categories/types.ts";

export interface CategoryBrief {
  category: string;
  geography: string;
  currency: string;
  channel?: string;
  priceAmbition?: string;
  notes?: string;
  /** Harvested real-world corpus excerpts to ground the pack in evidence. */
  evidence?: string;
  /**
   * Concatenated RAW fetched source text — the quotable substrate. Every claim's
   * `quote` must literally appear here to be marked verified (attribution).
   */
  sourceText?: string;
  /** Data-derived price bands (from real SKU prices); overrides LLM guess. */
  priceBands?: { label: string; lowMinor: number; highMinor: number }[];
  /** Provenance/confidence stamped onto the resulting pack. */
  provenance?: Provenance;
}

/**
 * Market Intelligence agents turn a free-text brief into a validated
 * CategoryPack — the vertical operating model that drives output quality.
 *
 * v0 generates the pack from model knowledge. The competitor archetypes are
 * REQUIRED to be disguised (no real brand names) so the downstream blind arena
 * stays free of pretraining bias. Later this grounds in mined reviews /
 * listings / ads / search demand instead of model priors.
 */
export async function buildCategoryPack(
  brief: CategoryBrief,
  llm = new LLMClient(),
): Promise<CategoryPack> {
  const raw = await llm.completeJson<Record<string, unknown>>({
    // Strategy-grade model for the pack; this runs once per category.
    messages: [
      {
        role: "system",
        content:
          "You are a Market Intelligence council (category analyst, review miner, " +
          "pricing analyst, compliance analyst). Produce a rigorous, evidence-led " +
          "category operating model. Phrase findings in real customer language. " +
          "Be NEUTRAL and falsifiable: do NOT assume a market gap exists. Report " +
          "what incumbents already do WELL (wellMetNeeds) with equal rigor to what " +
          "is underserved (unmetNeeds). If the evidence does not support a genuine " +
          "unmet need, return fewer — an empty unmetNeeds list is a valid, honest " +
          "answer. When an EVIDENCE corpus is provided, ground every claim in it and " +
          "prefer real phrasing from reviews/complaints over generic priors; do not " +
          "invent needs, prices, or competitors the evidence does not support. " +
          "CRITICAL: competitor archetypes must be DISGUISED with codeNames " +
          "(e.g. ARCH-COMMODITY) and never name real brands, even if the evidence does.",
      },
      {
        role: "user",
        content:
          (brief.evidence
            ? `EVIDENCE corpus (real harvested reviews/listings/guides):\n` +
              `"""\n${brief.evidence}\n"""\n\n`
            : "") +
          `Brief:\n${JSON.stringify({ ...brief, evidence: undefined }, null, 2)}\n\n` +
          `EVERY need/trigger/rejection is an EvidencedItem: ` +
          `{ "text": <claim in customer language>, "quote": <a VERBATIM phrase copied ` +
          `exactly from a RAW SOURCE that supports it>, "sourceUrl": <that source's URL> }.\n` +
          `Rules for quotes: copy the quote EXACTLY (character-for-character) from the ` +
          `RAW SOURCES section only — NEVER from LENS SUMMARIES, and never paraphrase. ` +
          `If you cannot find a supporting verbatim quote in a RAW SOURCE, OMIT the item ` +
          `rather than invent one. An empty list is an honest, valid answer.\n\n` +
          `Produce a CategoryPack JSON with EXACTLY these keys:\n` +
          `- id (slug), name, currency, geography\n` +
          `- unmetNeeds[] (0-7 EvidencedItems; ONLY genuinely underserved needs a quote supports)\n` +
          `- wellMetNeeds[] (3-6 EvidencedItems: needs incumbents ALREADY serve well)\n` +
          `- purchaseTriggers[] (4-6 EvidencedItems)\n` +
          `- rejectionReasons[] (4-6 EvidencedItems)\n` +
          `- priceBands[] of { label, lowMinor, highMinor } in MINOR units of ${brief.currency} ` +
          `(MINOR = x100; e.g. ${brief.currency} 250 => 25000, ${brief.currency} 800 => 80000)\n` +
          `- competitorArchetypes[] (3-5) of { codeName, description, pricePositioning, ` +
          `claims[], strengths[], weaknesses[], evidence[] (EvidencedItems backing the claims) } ` +
          `— DISGUISED codeNames, no real brand names. ` +
          (brief.priceBands?.length
            ? `pricePositioning MUST be one of these tier labels: ${brief.priceBands.map((b) => b.label).join(", ")}.\n`
            : `\n`) +
          `- complianceNotes[] (category-specific legal/claims constraints)\n` +
          `- buyerSegments[] of { seed, weight } where weights sum to ~1.0\n` +
          `Return ONLY the JSON object.`,
      },
    ],
    // Deterministic structuring: the pack must be reproducible from the same
    // evidence, so a re-run does not invent different "truths".
    temperature: 0,
  });

  const id = String(raw.id ?? slug(brief.category));
  const pack = CategoryPackSchema.parse({ ...raw, id });
  pack.buyerSegments = normalizeWeights(pack.buyerSegments);
  // Prefer data-derived bands from real SKU prices; else guard the LLM guess.
  pack.priceBands =
    brief.priceBands && brief.priceBands.length
      ? brief.priceBands
      : normalizePriceBands(pack.priceBands);

  // ATTRIBUTION — two gates, then DROP failures so the pack carries only real
  // findings:
  //  1) containment — the quote literally appears in fetched source text;
  //  2) entailment  — an INDEPENDENT model (different family from the generator)
  //     confirms the quote actually SUBSTANTIATES the claim. A real quote that
  //     doesn't support its claim (e.g. a positive line filed as a rejection
  //     reason) fails here. Containment proves the quote is real; entailment
  //     proves it's relevant.
  const normSource = normalizeForMatch(brief.sourceText ?? "");
  const verifier = new LLMClient();
  const verifierModel = process.env.PB_VERIFY_MODEL ?? loadConfig().simModel;
  const bind = async (items: EvidencedItem[], kind: string): Promise<EvidencedItem[]> => {
    const contained = verifyItems(items, normSource); // verified = contained
    const entailed = brief.sourceText
      ? await verifyEntailment(contained, kind, verifier, verifierModel)
      : contained.map(() => false);
    return contained.map((it, i) => ({ ...it, verified: it.verified && entailed[i]! }));
  };

  const totalItems =
    pack.unmetNeeds.length +
    pack.wellMetNeeds.length +
    pack.purchaseTriggers.length +
    pack.rejectionReasons.length +
    pack.competitorArchetypes.reduce((n, a) => n + a.evidence.length, 0);

  const [un, wm, pt, rr] = await Promise.all([
    bind(pack.unmetNeeds, "unmet need"),
    bind(pack.wellMetNeeds, "well-met need"),
    bind(pack.purchaseTriggers, "purchase trigger"),
    bind(pack.rejectionReasons, "rejection reason"),
  ]);
  pack.unmetNeeds = un.filter((i) => i.verified);
  pack.wellMetNeeds = wm.filter((i) => i.verified);
  pack.purchaseTriggers = pt.filter((i) => i.verified);
  pack.rejectionReasons = rr.filter((i) => i.verified);
  await Promise.all(
    pack.competitorArchetypes.map(async (a) => {
      a.evidence = (await bind(a.evidence, "competitor claim")).filter((i) => i.verified);
    }),
  );

  const attributedItems =
    pack.unmetNeeds.length +
    pack.wellMetNeeds.length +
    pack.purchaseTriggers.length +
    pack.rejectionReasons.length +
    pack.competitorArchetypes.reduce((n, a) => n + a.evidence.length, 0);
  const attributionRate = totalItems ? attributedItems / totalItems : 0;

  // Stamp provenance. Confidence = min(coverage grade, attribution grade): a
  // well-covered corpus whose claims don't survive the two gates is NOT
  // high-confidence. (No source text => ungrounded prior pack, low confidence.)
  const base: Provenance =
    brief.provenance ??
    ({ grounded: false, confidence: "low", lensesPlanned: 0, lensesSucceeded: 0, missingLenses: [], distinctDomains: 0, independentDomains: 0, fetchedSources: 0, sourceClassCounts: {}, citationCountRaw: 0, attributionRate: 0, attributedItems: 0, totalItems: 0, skuCount: 0, providersUsed: [], truncated: false, degraded: !brief.evidence } satisfies Provenance);
  const attrConf: Provenance["confidence"] =
    attributedItems === 0 ? "low" : attributionRate >= 0.7 ? "high" : attributionRate >= 0.4 ? "medium" : "low";
  pack.provenance = {
    ...base,
    attributionRate: round2(attributionRate),
    attributedItems,
    totalItems,
    verifierModel: brief.sourceText ? verifierModel : undefined,
    confidence: brief.sourceText ? minConfidence(base.confidence, attrConf) : base.confidence,
  };
  return pack;
}

/**
 * Independent entailment check: does each (already-contained) quote actually
 * SUBSTANTIATE its claim? Uses a model family distinct from the generator so
 * the auditor doesn't merely share the generator's blind spots. Strict: a
 * merely-on-topic quote, or a positive quote under a negative claim, fails.
 */
async function verifyEntailment(
  items: EvidencedItem[],
  kind: string,
  llm: LLMClient,
  model: string,
): Promise<boolean[]> {
  const idxs = items.map((it, i) => ({ it, i })).filter((x) => x.it.verified);
  const result = items.map(() => false);
  if (!idxs.length) return result;
  const negNote = /rejection/.test(kind)
    ? " For a rejection reason, the quote MUST express dissatisfaction, a complaint, or a negative experience — a positive or neutral statement does NOT support it."
    : "";
  const list = idxs
    .map((x, n) => `${n + 1}. CLAIM (${kind}): ${x.it.text}\n   QUOTE: "${x.it.quote}"`)
    .join("\n");
  const res = await llm
    .completeJson<{ verdicts: { n: number; supports: boolean }[] }>({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You are a strict, independent evidence auditor. For each item decide " +
            "if the QUOTE genuinely SUBSTANTIATES the CLAIM. A quote that is only " +
            "loosely on-topic, or whose sentiment contradicts the claim, does NOT " +
            "substantiate it." + negNote,
        },
        {
          role: "user",
          content: `Judge each. Return {"verdicts":[{"n":1,"supports":true|false}, ...]}.\n\n${list}`,
        },
      ],
    })
    .catch(() => ({ verdicts: [] as { n: number; supports: boolean }[] }));
  const map = new Map((res.verdicts ?? []).map((v) => [v.n, v.supports]));
  idxs.forEach((x, n) => {
    result[x.i] = map.get(n + 1) === true;
  });
  return result;
}

const CONF_RANK: Record<Provenance["confidence"], number> = { low: 0, medium: 1, high: 2 };
function minConfidence(a: Provenance["confidence"], b: Provenance["confidence"]): Provenance["confidence"] {
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

/** Normalize for verbatim containment: lowercase, strip punctuation, collapse ws. */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Mark an item verified iff its quote (normalized) literally appears in the raw
 * source text. A short quote (<15 chars) is too weak to count as attribution.
 */
function verifyItems(items: EvidencedItem[], normSource: string): EvidencedItem[] {
  if (!normSource) return items.map((i) => ({ ...i, verified: false }));
  return items.map((i) => {
    const q = normalizeForMatch(i.quote);
    return { ...i, verified: q.length >= 15 && normSource.includes(q) };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function savePack(pack: CategoryPack, dir = "packs"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${pack.id}.json`;
  await Bun.write(path, JSON.stringify(pack, null, 2));
  return path;
}

/**
 * Guard against the common LLM error of emitting price bands in MAJOR units
 * (whole currency) when MINOR is required. If the largest band high is < 5000
 * minor (i.e. < 50 of the currency for a physical product), assume major units
 * were given and scale x100. Logged so it's never silent.
 */
function normalizePriceBands<T extends { lowMinor: number; highMinor: number; label: string }>(
  bands: T[],
): T[] {
  if (!bands.length) return bands;
  const maxHigh = Math.max(...bands.map((b) => b.highMinor));
  if (maxHigh > 0 && maxHigh < 5000) {
    console.error(`[intel] price bands look like major units (max ${maxHigh}); scaling x100.`);
    return bands.map((b) => ({ ...b, lowMinor: b.lowMinor * 100, highMinor: b.highMinor * 100 }));
  }
  return bands;
}

function normalizeWeights<T extends { weight: number }>(segs: T[]): T[] {
  const total = segs.reduce((a, s) => a + (s.weight || 0), 0);
  if (total <= 0) return segs.map((s) => ({ ...s, weight: 1 / segs.length }));
  return segs.map((s) => ({ ...s, weight: s.weight / total }));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
