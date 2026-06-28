import { mkdir } from "node:fs/promises";
import { LLMClient } from "../llm/client.ts";
import { loadConfig } from "../config.ts";
import {
  CategoryPackSchema,
  type CategoryPack,
  type Provenance,
  type EvidencedItem,
} from "../categories/types.ts";
import { tagGrievancesToSegments } from "../personas/grievances.ts";
import { extractGroundedGrievances } from "../personas/grievanceExtract.ts";

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
   * Fetched sources — the quotable substrate. A claim is attributed only if its
   * quote literally appears in one of these; customer-voice claims additionally
   * require the matched source to be INDEPENDENT (not brand/affiliate/marketplace).
   */
  sources?: EvidenceSource[];
  /** Data-derived price bands (from real SKU prices); overrides LLM guess. */
  priceBands?: { label: string; lowMinor: number; highMinor: number }[];
  /** Real scraped SKU observations (incl. reviews/rating) for benchmark anchors. */
  observations?: import("../scrape/prices.ts").PriceObservation[];
  /**
   * Compact real market-structure signal (price-tier shares + observed product
   * subtypes) used to GROUND buyer-segment weights in the actual assortment
   * instead of inventing them. Supply-proxy, not measured demand.
   */
  marketSignal?: string;
  /** Real SKU clusters that ground competitor archetypes (one archetype each). */
  competitorClusters?: { tier: string; subtype: string; share: number; brands: string[]; medianPrice: number }[];
  /** Provenance/confidence stamped onto the resulting pack. */
  provenance?: Provenance;
}

/** A fetched source the pack may quote from (subset of the corpus SourceDoc). */
export interface EvidenceSource {
  finalUrl: string;
  sourceClass: string;
  independent: boolean;
  rawText: string;
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
  onEvent?: (e: { type: string; [k: string]: unknown }) => void,
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
          `Brief:\n${JSON.stringify({ ...brief, evidence: undefined, sources: undefined, provenance: undefined }, null, 2)}\n\n` +
          `EVERY need/trigger/rejection is an EvidencedItem: ` +
          `{ "text": <claim in customer language>, "quote": <a VERBATIM phrase copied ` +
          `exactly from a RAW SOURCE that supports it>, "sourceUrl": <that source's URL> }.\n` +
          `Rules for quotes: copy the quote EXACTLY (character-for-character) from the ` +
          `RAW SOURCES section only — NEVER from LENS SUMMARIES, and never paraphrase. ` +
          `For unmetNeeds / wellMetNeeds / purchaseTriggers / rejectionReasons the quote MUST ` +
          `come from a source tagged (INDEPENDENT) — genuine customer/editorial voice, NOT ` +
          `brand, marketing, or marketplace-listing copy (those will be rejected). Competitor ` +
          `evidence may quote any source. ` +
          `If you cannot find a supporting verbatim quote in an appropriate RAW SOURCE, OMIT the ` +
          `item rather than invent one. An empty list is an honest, valid answer.\n\n` +
          `Produce a CategoryPack JSON with EXACTLY these keys:\n` +
          `- id (slug), name, currency, geography\n` +
          `- unmetNeeds[] (0-7 EvidencedItems; ONLY genuinely underserved needs a quote supports)\n` +
          `- wellMetNeeds[] (3-6 EvidencedItems: needs incumbents ALREADY serve well)\n` +
          `- purchaseTriggers[] (4-6 EvidencedItems)\n` +
          `- rejectionReasons[] (4-6 EvidencedItems)\n` +
          `- priceBands[] of { label, lowMinor, highMinor } in MINOR units of ${brief.currency} ` +
          `(MINOR = x100; e.g. ${brief.currency} 250 => 25000, ${brief.currency} 800 => 80000)\n` +
          (brief.competitorClusters?.length
            ? `REAL COMPETITOR CLUSTERS — build ONE archetype per cluster below, IN ORDER. The ` +
              `example brands are for YOUR grounding only; NEVER output a real brand name.\n` +
              brief.competitorClusters
                .map((c, i) => `  ${i + 1}. ${c.tier} tier · ${c.subtype} · ~${Math.round(c.share * 100)}% of SKUs · median ${brief.currency}${c.medianPrice} · e.g. ${c.brands.join(", ")}`)
                .join("\n") +
              "\n"
            : "") +
          `- competitorArchetypes[] (${brief.competitorClusters?.length ? "one per cluster above" : "3-5"}) of ` +
          `{ codeName, description, pricePositioning, claims[], strengths[], weaknesses[], ` +
          `evidence[] (EvidencedItems backing the claims) } — DISGUISED codeNames, no real brand names. ` +
          (brief.priceBands?.length
            ? `pricePositioning MUST be one of these tier labels: ${brief.priceBands.map((b) => b.label).join(", ")}.\n`
            : `\n`) +
          `- complianceNotes[] (category-specific legal/claims constraints)\n` +
          (brief.marketSignal ? `OBSERVED MARKET SIGNAL (real assortment): ${brief.marketSignal}\n` : "") +
          `- buyerSegments[] (4-7) of { seed, weight, basis }. seed = a NEED / JOB-TO-BE-DONE ` +
          `segment (e.g. "chronic dry-lips relief seeker", "tint+care beauty buyer", "SPF/outdoor ` +
          `user", "ingredient-conscious minimalist", "budget marketplace buyer") — NOT a demographic ` +
          `age band. weight = estimated 0..1 share GROUNDED in the observed market signal above (price ` +
          `tiers + subtypes) and the needs; these are honest ESTIMATES, do not fabricate precision. ` +
          `basis = one line stating what the weight is derived from. Weights should sum to ~1.0.\n` +
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
  // Attach audit-only real brands per archetype (by cluster order) so each
  // disguised archetype is falsifiable against actual SKUs. Never reaches the arena.
  if (brief.competitorClusters?.length) {
    pack.competitorArchetypes.forEach((a, i) => {
      a.realExamples = brief.competitorClusters?.[i]?.brands ?? [];
    });
  }
  // Prefer data-derived bands from real SKU prices; else guard the LLM guess.
  pack.priceBands =
    brief.priceBands && brief.priceBands.length
      ? brief.priceBands
      : normalizePriceBands(pack.priceBands);

  // Benchmark anchors (audit-only). Only when real SKU observations with reviews exist.
  if (brief.observations && brief.observations.length) {
    const { benchmarksFromObservations } = await import("../benchmark/harvest.ts");
    const { benchmarkBrands, degraded } = benchmarksFromObservations(
      brief.observations, pack.priceBands, Number(process.env.PB_BENCHMARK_N ?? "5"),
    );
    pack.benchmarkBrands = benchmarkBrands;
    pack.benchmarksDegraded = degraded;
  } else {
    pack.benchmarksDegraded = true;
  }
  pack.benchmarkKnownUnknowns = [
    "Traction is a cumulative-popularity proxy (review volume + rating), NOT current market share or conversion; old brands are over-weighted (survivorship).",
    "Review data is channel/geo/language-skewed to whatever retailers the harvest reached.",
    "Traction weighting (volume/quality) and rating band are uncalibrated assumptions until calibration (piece #2) fits them.",
  ];

  // ATTRIBUTION — two gates, then DROP failures so the pack carries only real
  // findings:
  //  1) containment — the quote literally appears in fetched source text;
  //  2) entailment  — an INDEPENDENT model (different family from the generator)
  //     confirms the quote actually SUBSTANTIATES the claim. A real quote that
  //     doesn't support its claim (e.g. a positive line filed as a rejection
  //     reason) fails here. Containment proves the quote is real; entailment
  //     proves it's relevant.
  // Pre-normalize each source once. We match a quote to a SPECIFIC source so we
  // know its incentive-class: a "customer need" quoted from a brand's own blog is
  // marketing, not customer voice, and must NOT count.
  const sources = (brief.sources ?? []).map((s) => ({ ...s, norm: normalizeForMatch(s.rawText) }));
  const haveSources = sources.length > 0;
  const verifier = new LLMClient();
  const verifierModel = process.env.PB_VERIFY_MODEL ?? loadConfig().simModel;

  // requireIndependent: customer-voice claims (need/trigger/rejection) only count
  // when quoted from an independent source. Competitor claims may cite any source
  // (a brand's own marketing IS valid evidence of what that competitor claims).
  const bind = async (
    items: EvidencedItem[],
    kind: string,
    requireIndependent: boolean,
  ): Promise<EvidencedItem[]> => {
    const contained = verifyAgainstSources(items, sources, requireIndependent);
    const entailed = haveSources
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

  // Demand/supply tier: unmetNeeds + rejectionReasons are DEMAND-pain claims —
  // they must come from independent customer voice (a brand can't define your
  // unmet need). wellMetNeeds + purchaseTriggers are supply/observable and may
  // cite any source, but each item is still TAGGED with its independence so the
  // pack reports an honest customer-voice ratio rather than shipping empty.
  const [un, wm, pt, rr] = await Promise.all([
    bind(pack.unmetNeeds, "unmet need", true),
    bind(pack.wellMetNeeds, "well-met need", false),
    bind(pack.purchaseTriggers, "purchase trigger", false),
    bind(pack.rejectionReasons, "rejection reason", true),
  ]);
  pack.unmetNeeds = un.filter((i) => i.verified);
  pack.wellMetNeeds = wm.filter((i) => i.verified);
  pack.purchaseTriggers = pt.filter((i) => i.verified);
  pack.rejectionReasons = rr.filter((i) => i.verified);

  // Ground persona anxieties in REAL review/complaint voice.
  // Prefer the dedicated raw-source extractor (containment-only, high recall). If it
  // finds nothing, fall back to the older verified rejectionReasons/unmetNeeds path.
  if (brief.sources?.length && pack.buyerSegments.length) {
    pack.groundedGrievances = await extractGroundedGrievances(brief.sources, pack.buyerSegments, llm);
  }

  if (!pack.groundedGrievances.length) {
    // Fallback: use the pre-independence-filter `rr`/`un` arrays (containment+entailment verified).
    // Marketplace reviews ARE real fears, even if not independent; independence is preserved on each item.
    const grievanceItems = [...rr, ...un].filter((i) => i.verified);
    if (grievanceItems.length && pack.buyerSegments.length) {
      const segList = pack.buyerSegments.map((s) => s.seed).join("\n- ");
      const assignRaw = await llm.completeJson<{ assignments: { text: string; segment: string }[] }>({
        messages: [{ role: "user", content:
          `Assign each shopper complaint to the single best-fit buyer segment.\n` +
          `Segments:\n- ${segList}\n\nComplaints (one per line):\n` +
          grievanceItems.map((g, i) => `${i}. ${g.text}`).join("\n") +
          `\n\nReturn JSON { "assignments": [ { "text": <exact complaint text>, "segment": <exact segment seed> } ] }.`,
        }],
      }).catch(() => ({ assignments: [] as { text: string; segment: string }[] }));
      const segMap = new Map(assignRaw.assignments.map((a) => [a.text, a.segment]));
      pack.groundedGrievances = tagGrievancesToSegments(
        grievanceItems,
        pack.buyerSegments,
        (text) => segMap.get(text) ?? pack.buyerSegments[0]!.seed,
      );
    }
  }

  // Distribution grounding: blend supply proxy (existing LLM-estimate weights = supply signal)
  // with demand proxy (grievance count per segment = review-activity signal).
  // Uses the grievances just tagged above as the demand proxy.
  {
    const { blendWeights } = await import("../personas/distribution.ts");
    const totalGrievances = pack.groundedGrievances.length || 1; // avoid /0
    const blended = blendWeights(
      pack.buyerSegments.map((s) => ({
        seed: s.seed,
        estimateWeight: s.weight,
        supplyShare: s.weight,   // supply proxy = the existing normalized weight
        demandShare: pack.groundedGrievances.filter((g) => g.segment === s.seed).length / totalGrievances,
      })),
      Number(process.env.PB_DISTRIBUTION_ALPHA ?? "0.5"),
    );
    pack.buyerSegments = pack.buyerSegments.map((s) => {
      const b = blended.find((x) => x.seed === s.seed);
      return b ? { ...s, weight: b.weight, basis: b.basis } : s;
    });
  }

  pack.personaGroundingKnownUnknowns = [
    "Grievances are STATED complaints from vocal/dissatisfied reviewers (survivorship), not a representative buyer sample.",
    "Segment weights blend supply proxy (what's stocked) and review-activity proxy (what's discussed) — neither is measured demand.",
    "Review corpus is channel/geo/language-skewed to whatever the harvest reached.",
    "Grounding improves INPUT realism only; it does NOT make win-rates calibrated or representative of true market share.",
  ];

  await Promise.all(
    pack.competitorArchetypes.map(async (a) => {
      a.evidence = (await bind(a.evidence, "competitor claim", false)).filter((i) => i.verified);
    }),
  );

  const kept: EvidencedItem[] = [
    ...pack.unmetNeeds,
    ...pack.wellMetNeeds,
    ...pack.purchaseTriggers,
    ...pack.rejectionReasons,
    ...pack.competitorArchetypes.flatMap((a) => a.evidence),
  ];
  const attributedItems = kept.length;
  const independentItems = kept.filter((i) => i.independent).length;
  const attributionRate = totalItems ? attributedItems / totalItems : 0;

  // Stamp provenance. Confidence = min(coverage grade, attribution grade): a
  // well-covered corpus whose claims don't survive the two gates is NOT
  // high-confidence. (No source text => ungrounded prior pack, low confidence.)
  const base: Provenance =
    brief.provenance ??
    ({ grounded: false, confidence: "low", lensesPlanned: 0, lensesSucceeded: 0, missingLenses: [], distinctDomains: 0, independentDomains: 0, fetchedSources: 0, sourceClassCounts: {}, citationCountRaw: 0, attributionRate: 0, attributedItems: 0, totalItems: 0, independentItems: 0, skuCount: 0, providersUsed: [], truncated: false, degraded: !brief.evidence } satisfies Provenance);
  const attrConf: Provenance["confidence"] =
    attributedItems === 0 ? "low" : attributionRate >= 0.7 ? "high" : attributionRate >= 0.4 ? "medium" : "low";
  pack.provenance = {
    ...base,
    attributionRate: round2(attributionRate),
    attributedItems,
    totalItems,
    independentItems,
     verifierModel: haveSources ? verifierModel : undefined,
     confidence: haveSources ? minConfidence(base.confidence, attrConf) : base.confidence,
   };
   onEvent?.({ type: "intel-done", confidence: pack.provenance.confidence, grounded: pack.provenance.grounded, attribution: Math.round(attributionRate * 100), segments: pack.buyerSegments?.length ?? 0, competitors: pack.competitorArchetypes?.length ?? 0, degraded: pack.provenance.degraded });
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
 * Containment gate. Mark an item verified iff its quote (normalized, >=15 chars)
 * literally appears in a SPECIFIC fetched source — and, when requireIndependent
 * is set, that source is independent (community/editorial/regulator). Also
 * corrects the item's sourceUrl to the actually-matched source, so a claim can't
 * cite a source it didn't come from.
 */
function verifyAgainstSources(
  items: EvidencedItem[],
  sources: { finalUrl: string; independent: boolean; norm: string }[],
  requireIndependent: boolean,
): EvidencedItem[] {
  if (!sources.length) return items.map((i) => ({ ...i, verified: false, independent: false }));
  return items.map((i) => {
    const q = normalizeForMatch(i.quote);
    if (q.length < 15) return { ...i, verified: false, independent: false };
    const match = sources.find((s) => s.norm.includes(q));
    const ok = !!match && (!requireIndependent || match.independent);
    return {
      ...i,
      verified: ok,
      independent: !!match && match.independent,
      sourceUrl: match ? match.finalUrl : i.sourceUrl,
    };
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
  // Round to whole-percent: these are estimates, so false precision (0.40000001)
  // would misrepresent the confidence we actually have.
  if (total <= 0) return segs.map((s) => ({ ...s, weight: Math.round((100 / segs.length)) / 100 }));
  return segs.map((s) => ({ ...s, weight: Math.round((s.weight / total) * 100) / 100 }));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
