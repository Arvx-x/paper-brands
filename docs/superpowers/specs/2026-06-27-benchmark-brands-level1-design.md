# Design: Real-Brand Benchmarking (Level 1) — calibration anchors in the arena

**Date:** 2026-06-27
**Status:** Approved (design phase)
**Repo target:** `paper-brands`
**Piece:** Level 1 of the calibration track (precursor to piece #2 Calibration).

---

## Context — why this exists

The deep arena (just merged) scores candidate brands against **disguised competitor
archetypes** — *synthetic abstractions* mined from the market. So a win-rate means
"beat a generic commodity archetype," and the archetypes carry no real-world metric.

The owner wants the win-rate to be **market-relative**: measured against *real,
known products* with *real public metrics*, so a candidate's number can eventually be
read as an implied market position. With only **public data** available, the real
metric is a **composite traction score (review volume + rating)** — an honest
*popularity proxy*, not true market share.

**Level 1 vs Level 2 (why Level 1 first):** Calibration (Level 2 / piece #2) fits
`arenaWinRate → realMetric` using known brands as anchors. To produce the *synthetic*
side of each anchor pair, the known brand must actually compete in the arena. That
"make real brands compete, disguised" step **is Level 1**. Level 2 consumes Level 1's
output. They are sequential stages of one pipeline, not alternatives.

**Scope of this spec:** Level 1 only — put disguised real brands in the arena, attach
an audit-only traction score, and emit a calibration-ready `(arenaWinRate,
tractionScore)` table. It does NOT fit a calibration curve (that is piece #2).

---

## Critical risk this design must surface early (not assume away)

Including real brands as calibration anchors carries a **real validity risk** that
could make the whole calibration direction unworkable — and the design must *detect*
it, not paper over it:

> **Blindness fights the real brand's real advantage.** A large part of why real brands
> win (name recognition, trust, shelf presence) is exactly what the blind disguise
> *strips off* (OPTION-X, no name). So a disguised real brand competes in the arena on
> **attributes only** — which is NOT how it wins in the real market. Therefore a real
> brand's *arena* win-rate may correlate **poorly** with its *real* traction, for
> reasons baked into our own method.

Additional validity holes (declared as known-unknowns below): public traction is a
*cumulative-popularity / brand-age* proxy, not current demand; public review data is
noisy (fake reviews, channel/language skew). Fitting a calibration curve to such anchors
risks **false confidence** — the exact QUALITY.md failure mode.

**Design response — make Level 1 a self-checking experiment, not an act of faith.**
Level 1 must compute and report an **early correlation sanity-check**: the **Spearman
rank correlation** between the benchmark brands' *arena win-rate* and their *traction
score*, across the benchmark set. This answers, cheaply and immediately, the gating
question — *does arena performance track real-world traction at all?* — BEFORE any
investment in Level 2 curve-fitting.

Interpretation contract (shipped with the result, so it can't be over-read):
- **Strong positive** (e.g. Spearman ρ ≳ 0.6) → real-brand calibration is plausible;
  proceed to Level 2.
- **Weak/none/negative** ρ → a *finding*, not a failure: the blind arena cannot predict
  real-brand outcomes; do NOT build Level 2 on public traction — pivot to first-party
  conversion ground truth (Level 3), where the disguise problem does not exist (you
  measure your own products' real outcomes).
- The sample is tiny (N≈5), so ρ ships with N and an explicit "directional only, not
  significant at this N" caveat. It is a **smoke alarm, not a proof**.

This makes "is including real brands a good idea?" an empirically answered question
rather than an assumption.

---

## Existing-code findings that shape the design

- `CompetitorArchetypeSchema` already has an audit-only `realExamples: string[]` and an
  `evidence` array — the disguise/audit pattern already exists.
- The hand-seeded `packs/lipcare.json` archetypes have `realExamples` **empty** and no
  metrics — no real anchors today.
- The harvest/prices step (`src/scrape/prices.ts`) **already scrapes real per-SKU data**:
  `brand`, `product`, `retailer`, `MRP`, current price, and price-bucket `share` with
  real example brands. The raw material for benchmarks already flows through harvest.
- `score()` groups by `pickedConceptId` prefix; a new `benchmark:` prefix slots in with
  no scoring rewrite.

---

## Architecture — three units

```
harvest corpus ─► benchmarkHarvest ─► pack.benchmarkBrands[]
                                       (audit-only: name, claims, price, tractionScore, evidence)
                                              │
deep/single arena ─► slate = candidates(OPTION-A…) + disguised archetypes + disguised benchmarks
                                              ▼
              score() ─► per-benchmark winRate ── paired with ──► tractionScore
                                              ▼
              ArenaReport.calibrationPairs: [{ auditId, realName, arenaWinRate, tractionScore, picks, trials }]
                                              ▼
                            (handoff to piece #2 Calibration)
```

1. **`benchmarkHarvest`** (extends `src/scrape/`) — from the harvested SKU corpus: dedupe
   to one SKU per brand, compute traction, select top-N stratified by price band, emit
   `BenchmarkBrand[]` (audit-only). Pure-ish data step.
2. **`cardFromBenchmark`** (in `src/arena/`) — turn a `BenchmarkBrand` into a disguised
   `BlindCard` (`OPTION-X`, faithful claims/price/format, **no name/metric**). Mirrors
   the existing `cardFromArchetype` neutralization. This is the blind-control guarantee.
3. **Arena + scoring integration** — benchmarks join the shuffled blind slate with
   `conceptId = "benchmark:<auditId>"`; `score()` handles them unchanged; an additive
   step builds `calibrationPairs`.

**Benchmarks COEXIST with archetypes.** Archetypes give structural market coverage
(even where no single brand dominates); benchmarks are the concrete real anchors that
carry a traction score and feed calibration. Only benchmarks produce `calibrationPairs`.

Blind invariant: the buyer agent only ever sees neutral `OPTION-X` cards. Real names +
traction live in audit-only fields the prompt never reads.

---

## Data schema (all additive — nothing existing changes)

```typescript
export const BenchmarkBrandSchema = z.object({
  auditId: z.string(),          // stable id; conceptId becomes "benchmark:<auditId>"
  realName: z.string(),         // AUDIT-ONLY — never shown to the buyer agent
  claims: z.array(z.string()),  // faithful real claims (shown, disguised)
  priceMinor: z.number(),       // real street price, minor units (shown)
  format: z.string(),           // e.g. "4.25g stick" (shown)
  // traction inputs (audit-only):
  reviewCount: z.number().default(0),
  rating: z.number().default(0),       // 0..5
  retailer: z.string().default(""),    // provenance of the metric
  // derived anchor (audit-only):
  tractionScore: z.number().default(0),// 0..1 composite — the calibration anchor
  evidence: z.array(EvidencedItemSchema).default([]),  // quote+url backing claims/metrics
});

// additive on CategoryPackSchema:
benchmarkBrands: z.array(BenchmarkBrandSchema).default([]),
benchmarksDegraded: z.boolean().default(false),
benchmarkKnownUnknowns: z.array(z.string()).default([]),

// calibration-ready output:
export interface CalibrationPair {
  auditId: string;
  realName: string;       // audit-only, for the operator reading the report
  arenaWinRate: number;   // synthetic side
  tractionScore: number;  // real side (public proxy)
  picks: number;
  trials: number;
}
// optional on ArenaReport, populated only when benchmarks present:
calibrationPairs?: CalibrationPair[];

// early self-check (the smoke alarm), populated when >= 3 evidenced benchmark pairs exist:
export interface CorrelationCheck {
  n: number;                 // number of benchmark pairs used
  spearmanRho: number;       // rank correlation of arenaWinRate vs tractionScore, -1..1
  verdict: "plausible" | "weak" | "none-or-negative" | "insufficient-n";
  note: string;              // human-readable caveat incl. "directional only, low N"
}
correlationCheck?: CorrelationCheck;
```

`.default([])` keeps every existing pack valid with zero benchmarks (non-breaking).

Decisions:
1. `realName`/metrics are **audit-only**; `cardFromBenchmark` reads only
   `claims`/`format`/`priceMinor`. A test asserts no leak.
2. `conceptId = "benchmark:<auditId>"` — third prefix alongside candidates and
   `competitor:`; scoring needs no rewrite.
3. Each benchmark carries `evidence` (verbatim quote + URL); unevidenced → low-confidence,
   excluded from `calibrationPairs`.

---

## Traction score math + top-N selection

```
volumeSignal = log10(reviewCount + 1)            // compress heavy review-count skew
volumeNorm   = volumeSignal / maxVolumeSignal    // 0..1, normalized within the harvested set
qualityNorm  = clamp((rating - 3.0) / 2.0, 0, 1) // useful 3.0–5.0 band → 0..1
tractionScore = W_VOL * volumeNorm + W_QUAL * qualityNorm   // defaults W_VOL=0.7, W_QUAL=0.3
```

Rationale:
- `log10(reviews)` — without it the leader's volume zeroes out everyone (standard skew fix).
- Normalize volume **within the category's harvested set** → `1.0` = most-reviewed brand
  found in this category (category-relative, comparable).
- Rating mapped from **3.0–5.0**, not 0–5 — real ratings rarely dip below 3.0; the 3.0–5.0
  window is where real variation lives.
- **70/30 toward volume** — volume is the stronger demand signal; rating is a quality
  modifier. (A tunable knob; calibration will later reveal the right value.)

**Defaults are env/param-overridable** (`PB_TRACTION_W_VOL`, `PB_TRACTION_RATING_FLOOR`,
etc.); NOT first-class pack config (YAGNI until needed).

**Top-N selection (default N=5):**
- Dedupe harvested SKUs to **one entry per brand** (keep the brand's most-reviewed SKU —
  no pseudo-replication).
- Rank by `tractionScore`; take top N.
- **Stratify across discovered price bands** — ensure ≥1 benchmark per tier where
  available, so the anchor set spans the market (calibration curve not valid only for
  cheap brands).
- Fewer than N available → use what exists; record the actual count; never pad with junk.

`tractionScore` is explicitly a **public-popularity proxy**, stored with provenance
(`retailer`, `reviewCount`, `rating`, evidence). Raw inputs are kept so the score can be
recomputed without re-harvesting if better data arrives.

---

## Arena integration, disguise & scoring

**Disguise** (mirrors `cardFromArchetype`):
```typescript
export function cardFromBenchmark(b: BenchmarkBrand, label: string): BlindCard {
  return {
    label,
    headline: normalizeLen(b.claims[0] ?? "Established option", HEAD),
    body: normalizeLen(b.claims.join(". "), BODY),  // faithful claims, NO name
    claims: b.claims.slice(0, 5),
    format: b.format,
    priceMinor: b.priceMinor,                        // real street price
    pitch: "",
  };
}
```
Reads ONLY `claims`/`format`/`priceMinor`. Never `realName`/`tractionScore`/`reviewCount`/
`rating`. A unit test asserts the rendered card contains none of those.

**Slate:** `candidates + disguised archetypes + disguised benchmarks`, all seeded-shuffled,
all neutral labels. Benchmarks get `conceptId = "benchmark:<auditId>"`. Included only when
`includeCompetitors` is on (same flag).

**Scoring:** benchmarks flow through `score()` unchanged (grouped by `pickedConceptId`).
One additive step builds `calibrationPairs`: for each `benchmark:*` concept, join its
`winRate`/`picks`/`trials` with the audit-only `tractionScore`/`realName` from
`pack.benchmarkBrands`. Benchmarks with `tractionScore:0` or no evidence are excluded.

**Correlation sanity-check (the smoke alarm):** from `calibrationPairs`, compute the
**Spearman rank correlation** between `arenaWinRate` and `tractionScore` (rank both,
Pearson on the ranks; tie-aware average ranks). Populate `correlationCheck` with `n`,
`spearmanRho`, a `verdict`, and a low-N caveat `note`. Verdict thresholds (on |ρ| sign):
- `n < 3` → `insufficient-n`.
- `ρ ≥ 0.6` → `plausible`.
- `0.3 ≤ ρ < 0.6` → `weak`.
- `ρ < 0.3` (incl. negative) → `none-or-negative`.
This is a pure function (`spearman(pairs)`), unit-tested without network.

**Report** (`formatReport`) gains an audit-only section (operator may see real names):
```
Benchmark anchors (audit-only — real brands, disguised in arena):
   real win-rate  traction   brand
        42.0%       0.91     Burt's Bees
        31.0%       0.74     Vaseline
```
And below it, the computed verdict:
```
Calibration smoke-check: Spearman ρ = 0.70  (n=5, plausible — directional only, low N)
   -> arena win-rate tracks real traction; Level 2 calibration worth pursuing.
```
(or `ρ = 0.10 (none-or-negative)` → "arena does NOT track real traction; do not build
Level 2 on public traction — pivot to first-party conversion ground truth.")

Lets the operator answer the gating question — "does this whole direction hold?" —
immediately, before the formal curve (piece #2) exists.

Existing abstention / no-silent-drops / Wilson-CI machinery applies to benchmarks
unchanged. A benchmark losing to your candidate is the *good* outcome.

---

## Error handling, QUALITY.md gates & known-unknowns

**Degradation (fallback, never fabricate):**
- Harvest finds no usable review data → `benchmarkBrands:[]`, `benchmarksDegraded:true`;
  arena runs WITHOUT benchmarks (candidates + archetypes, as today).
- A brand has claims but no metrics → may be a blind competitor but `tractionScore:0`,
  **excluded from calibrationPairs** (no real anchor = can't calibrate against it).
- Fewer than N qualify → use available, record count, don't pad.
- A benchmark errors mid-run → existing per-option `errored` tolerance; one bad benchmark
  never aborts the run.

**QUALITY.md gate map:**
| Principle | How satisfied |
|---|---|
| Plausibility ≠ truth; bind to raw sources | each benchmark's claims+metrics carry `evidence` (quote+URL); unevidenced excluded from calibration |
| Weight by reality, not catalog count | traction from real review volume+rating, deduped 1-SKU-per-brand (no pseudo-replication) |
| Missing ≠ null (F7/F10) | empty/failed harvest → run without benchmarks + `benchmarksDegraded`, never fabricate |
| Stated ≠ revealed (F10) | traction labeled a **public-popularity proxy**, not demand/share |
| Survivorship (F9) | review counts over-weight old/surviving brands → declared known-unknown |
| Known-unknowns (#15) | pack ships `benchmarkKnownUnknowns[]` |
| Blind control (arena core) | disguise reads only safe fields; test asserts no name/metric leak |

**Declared known-unknowns (shipped on the pack):**
- Traction is a **cumulative-popularity proxy**, not current share/conversion (survivorship).
- Review data is **channel/geo/language-skewed** (whatever retailers the harvest reached).
- The 70/30 weighting + 3.0–5.0 band are **uncalibrated assumptions** until piece #2.
- `calibrationPairs` is a **handoff artifact**; Level 1 does NOT fit a curve (piece #2).

**The honest boundary:** Level 1 makes the win-rate *more meaningful* (beat disguised real
brands, not abstractions), produces the calibration-ready pairs + an eyeball-able audit
report, and ships the **Spearman correlation smoke-check** that says whether Level 2 is
even worth building. It does NOT itself produce a calibrated / implied-share number — that
is Level 2 / piece #2, explicitly out of scope. Level 1's value (harder, more realistic
arena) stands **regardless** of how the correlation check turns out; a weak ρ is a
valuable finding that redirects Level 2 toward first-party data, not a failure.

---

## Testing strategy

**Unit (pure, no network):**
- Traction math — log-normalization handles 100k-vs-200 skew; rating from 3.0–5.0 band;
  70/30 weight; 4.8★/50-review < 4.2★/80k-review (volume dominates).
- Top-N + stratification — dedupe to 1 SKU/brand; top-5; spread across price bands;
  "fewer than N" path without padding.
- **Blind disguise (critical)** — `cardFromBenchmark` output contains real claims/price/
  format but NONE of realName/tractionScore/reviewCount/rating.
- `calibrationPairs` assembly — correct `(arenaWinRate, tractionScore)` join; tractionScore:0/
  unevidenced excluded.
- **Spearman `correlationCheck`** — known monotonic pairs → ρ≈1 (`plausible`); reversed →
  ρ≈-1 (`none-or-negative`); ties handled via average ranks; `n<3` → `insufficient-n`.
- Degradation — empty harvest → `benchmarkBrands:[]` + `benchmarksDegraded:true`; arena
  still runs.
- Schema back-compat — pack with no `benchmarkBrands` parses (`.default([])`).

**Smoke (one cheap live run, keys required):**
- harvest produces `benchmarkBrands[]` with real names + traction + evidence.
- a small deep tournament with benchmarks present → report shows the audit-only benchmark
  section; `calibrationPairs` populated in `tournament.json`.

**Verification gate (before done):** `tsc --noEmit` clean + unit suite green + one live run
that (a) produces evidenced benchmark brands, (b) shows no name leak in any card, (c) emits
`calibrationPairs`. Evidence before claims.

---

## Out of scope (deferred)

- Fitting the calibration curve / implied-share number (Level 2 / piece #2).
- Non-public metrics (real sales, your marketplace/dermat conversion) — Level 3.
- Defensibility objective (piece #5), creative-factory connection.
- Per-category tunable traction weights as pack config (YAGNI).
