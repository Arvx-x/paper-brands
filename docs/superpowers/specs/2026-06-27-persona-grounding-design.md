# Design: Persona Grounding (Silicon Sampling from Public Review Data)

**Date:** 2026-06-27
**Status:** Approved (design phase)
**Repo target:** `paper-brands`
**Piece:** "Best general-market arena" track — persona realism via grounding.

---

## Context — why this exists

The deep arena's cohort personas are currently **invented by the LLM** from a one-line
segment seed (`buyerSegments[].seed`) + a weight. The `cohort.ts` system prompt *claims*
they are "grounded in real purchase behavior," but they are not — the file's own comment
admits grounding in "mined reviews / search queries / CRM" is the intended-but-unbuilt
state.

The research consensus (Argyle, "Out of One, Many" — *silicon sampling*) is that the
single biggest realism lever is conditioning personas on **real backstories / distributions**
rather than demographic stereotypes. The harvest **already scrapes** the raw material —
review, community-voice, and complaint lenses (`src/intel/plan.ts`) — it just never reaches
persona generation. This piece connects that real review corpus into the cohort builder.

Scope decision (owner): **C — ground BOTH the "who" (cohort composition / segment weights)
AND the "what" (each persona's anxieties), with blended proxies and explicit provenance.**
A future verbatim-anchored mode (**D**) is kept open as a deferred seam (see §4).

**Why this and not calibration:** a prior experiment (real-brand benchmarking + Spearman
self-check) showed public-data *calibration* tops out at "weak" (ρ≈0.5) because the blind
arena can't see brand equity. The honest pivot is to first make the *synthetic input* as
realistic as possible. Persona grounding improves input realism; it does NOT calibrate
the output (out of scope).

---

## Critical risk this design must guard against

Silicon sampling has two documented failure modes (Dominguez-Olmedo, "Questioning the
Survey Responses of LLMs") that, unguarded, make grounded personas *worse* than invented
ones:
1. **Variance collapse** — every persona in a segment becomes the *same* person.
2. **Caricature** — a persona becomes nothing but its one vivid grievance.

The design must make both **visible and bounded** (§4), not assume them away. We do NOT
claim the grounded cohort is statistically representative — only that it is *grounded in
real, verified shopper voice*, with diversity/coverage measured so an operator sees how
much grounding actually happened.

---

## Existing-code findings that shape the design

- `src/personas/cohort.ts` `buildCohort(pack, size)` invents personas per-segment from the
  seed; weight → n per segment; already seeded? No — uses temperature 0.9, no seed.
- `pack.buyerSegments[]` already carries `{ seed, weight, basis }` where `basis` is a
  provenance string and weights are a "supply-proxy estimate" (`normalizeWeights` in
  `src/intel/market.ts`). The provenance pattern already exists.
- Harvest captures real review/complaint text via `consumer-reviews`, `community-voice`,
  `complaints` lenses; raw sources are stored (containment-verifiable).
- `EvidencedItemSchema` (containment + independence) already exists in `categories/types.ts`.

---

## Architecture — two grounding tracks + an upgraded consumer

```
harvest corpus (already captured)
  ├─ review/complaint text ─► grievanceExtractor ─► pack.groundedGrievances[]
  │                                                  (anxiety + verbatimQuote + sourceUrl + segment + verified)
  └─ marketplace SKU data  ─► distributionGrounder ─► pack.buyerSegments[].weight + basis
                                                       (blended supply + review-activity proxy)
                                        │
                                        ▼
   buildCohort (upgraded, backward-compatible):
     per segment: sample (seeded, without-replacement) a VERIFIED grievance
     → condition persona's anxieties/primaryNeed/language on the real grievance
     → fall back to invention where no verified grievance exists
                                        ▼
                       Persona[]  (+ groundingCoverage, cohortDiversity metrics)
```

Three units, one job each:

1. **`grievanceExtractor`** (intel/harvest time) — raw review corpus + segment list →
   `GroundedGrievance[]` (segment-tagged real grievances, each with a verbatim quote +
   source, containment-verified). The "what."
2. **`distributionGrounder`** (extends `normalizeWeights` in intel) — blends supply proxy
   (price-tier/subtype shares) + demand proxy (review-activity per segment) into
   `buyerSegments[].weight` with a `basis` string. The "who."
3. **`buildCohort` (upgraded)** — consumes `pack.groundedGrievances[]` + weights; samples
   real grievances into personas; falls back to invention when grounding is absent.

**Key boundary:** grounding data lives **on the pack**, produced at intel time; `buildCohort`
only *consumes* it at tournament time (mirrors the Level-1 pattern). An ungrounded pack →
`buildCohort` behaves exactly as today (non-breaking).

---

## §2 Grievance grounding (the "what" — the high-payoff half)

The deep arena's core mechanic is the buyer grading a card against their **anxiety**, so
grounding anxieties in real complaints is the biggest realism win for *this* arena.

```typescript
export const GroundedGrievanceSchema = z.object({
  segment: z.string(),          // buyer-segment seed this grievance belongs to
  anxiety: z.string(),          // distilled real fear, e.g. "balm wore off within an hour"
  verbatimQuote: z.string(),    // the ACTUAL review text (mode D anchors on this)
  sourceUrl: z.string().default(""),
  sourceClass: z.string().default(""),  // community / marketplace / editorial (incentive class)
  verified: z.boolean().default(false), // quote literally found in stored raw corpus
});
export type GroundedGrievance = z.infer<typeof GroundedGrievanceSchema>;
// additive on the pack:
groundedGrievances: z.array(GroundedGrievanceSchema).default([]),
```

**Extraction:**
1. Feed harvested review/complaint text + the pack's segment list to an LLM.
2. Extract real, specific grievances, each tagged to its best-fit segment, with the
   verbatim quote.
3. **Containment-verify:** `verified:true` only if `verbatimQuote` literally appears in a
   stored raw source. Unverified grievances are kept but **excluded from grounding**.
4. Weight by incentive-class independence (QUALITY #5); exclude affiliate/brand text as
   customer voice.

**Consumption in buildCohort (synthesized mode = default):** for each persona, sample
(seeded, without-replacement within a segment) a verified grievance and condition the LLM:
*"Here is a real concern a shopper expressed: '[quote]'. Build a realistic, distinct person
who, among other things, carries this kind of worry."* The LLM fleshes out the person
*around* the real grievance; it does not invent the grievance.

**Fallback:** a segment with no verified grievances → personas invented as today
(per-segment, not all-or-nothing).

---

## §3 Distribution grounding (the "who" — blended, the shakier half)

Grounds cohort *composition* in real data. Two public proxies, each honestly labeled:

- **Supply proxy** — price-tier + subtype shares from harvested SKUs (already computed).
  Caveat: supply ≠ demand.
- **Demand proxy** — review-activity volume per segment (count of segment-tagged
  `groundedGrievances`). Caveat: review bias (vocal/dissatisfied over-represented).

```
rawWeight(segment) = α · supplyShare + (1 − α) · demandShare      (α default 0.5, env PB_DISTRIBUTION_ALPHA)
```
Normalized to sum 1. Each weight carries a `basis` string, e.g.
`"blend: 0.5 supply (price-tier shares) + 0.5 review-activity (n=212)"`. Never presented
as measured demand.

**Honesty guard:** a segment with neither proxy → weight falls back to the existing LLM
estimate with `basis:"estimate (no grounding data)"` — **never zeroed** (a segment must
not vanish). Runs in/after `normalizeWeights` at intel time; `buildCohort` consumes final
weights unchanged.

**Stated boundary:** distribution grounding is the *shakier* half (supply≠demand, review
bias); hence per-weight `basis` + fallback-to-estimate. It nudges the cohort toward reality;
it does not claim to be reality. (Note: mode D does NOT help here — D is a grievance-half
mode and is orthogonal to composition.)

---

## §4 Variance-collapse & caricature guards + the D seam

**Variance-collapse guards:**
- Sample **distinct** grievances per persona within a segment (seeded, without-replacement
  until pool exhausted) — N personas draw up to N distinct real complaints.
- Retain the existing seeded trait jitter (skepticism/impulsivity spread).
- Keep generation temperature 0.9 for the synthesized fleshing-out.
- **Measure:** emit `cohortDiversity` = distinct grievances used / distinct anxieties
  produced, so collapse is visible.

**Caricature guards:**
- Prompt frames the grievance as *one concern among a full life*, not the defining trait.
- Grievance shapes `anxieties`/`primaryNeed` only; `age`/`context`/`decisionStyle` vary
  independently.

**Uniform-baseline humility:** we do not claim representativeness; only "grounded in real
grievances," with `cohortDiversity` + `basis` letting an operator see *how* grounded.

**The D seam (deferred mode):**
```typescript
buildCohort(pack, size, { groundingMode = "synthesized" })
//   "synthesized" (C, default): LLM fleshes a person AROUND a sampled real grievance
//   "verbatim"    (D, deferred): persona's reluctancePrior = the verbatim quote, minimal embellishment
```
Both modes read the same `pack.groundedGrievances[]`. Only `"synthesized"` is implemented;
`"verbatim"` is a documented `throw new Error("groundingMode 'verbatim' not yet implemented")`
stub + this spec note — so the data/seam exist with zero retrofit when D is built.

---

## §5 Error handling, QUALITY.md gates & known-unknowns

**Degradation (fallback, never fabricate):**
- No corpus / ungrounded pack → `groundedGrievances:[]`; full legacy invention path.
- Segment with zero verified grievances → per-segment fallback to invention.
- Grievance whose quote isn't in raw corpus → `verified:false`, excluded from grounding.
- Distribution: neither proxy for a segment → estimate weight (`basis:"estimate"`), not zero.
- Extraction LLM error → that lens contributes nothing; proceed with verified grievances;
  flag degraded if coverage low.

**QUALITY.md gate map:**
| Principle | How satisfied |
|---|---|
| Plausibility ≠ truth; bind to raw sources | every grounded grievance carries verbatimQuote+sourceUrl, containment-verified; unverified excluded |
| Weight by independence/incentive (#5) | grievances weighted by incentive-class; affiliate/brand excluded |
| Stated ≠ revealed (F10) | grievances are stated complaints — labeled as such |
| Missing ≠ null (F7/F10) | missing grievances/weights → fall back, never fabricate/zero |
| Survivorship (F9) | review data over-represents vocal/dissatisfied → known-unknown |
| Reproducibility measured (#11) | seeded sampling → reproducible cohort; cohortDiversity emitted |
| Construct validity (F3) | grievances extracted from RAW review text, not an LLM summary |
| Known-unknowns (#15) | pack ships `personaGroundingKnownUnknowns[]` |

**Declared known-unknowns (on the pack):**
- Grievances are stated complaints from vocal/dissatisfied reviewers (survivorship), not a
  representative buyer sample.
- Distribution weights blend a supply proxy + a review-activity proxy — neither is measured
  demand.
- Review corpus is channel/geo/language-skewed to whatever the harvest reached.
- Grounding improves INPUT realism; it does NOT make win-rates calibrated or
  representative of true market share.

**Honest boundary:** makes the synthetic cohort demonstrably more grounded in real,
verified shopper voice (measurable diversity/coverage) — the stated goal. It does NOT
claim statistical representativeness and does NOT touch calibration. Low
`groundingCoverage`/`cohortDiversity` is surfaced, not hidden.

---

## §6 Testing strategy

**Unit (pure, no network):**
- Containment verification: quote-in-corpus → verified; not-in-corpus → excluded.
- Without-replacement sampling: N personas → N distinct grievances when pool≥N; pool<N
  maximizes distinctness; same seed → identical sampling.
- `cohortDiversity` computed correctly; flags low diversity.
- Distribution blend: α·supply+(1−α)·demand normalized to 1; neither-proxy segment →
  estimate weight, never zero.
- `groundingCoverage`: fraction grounded vs fallback-invented.
- Fallback: empty groundedGrievances → valid cohort via legacy path; schema back-compat.
- D seam: `groundingMode:"verbatim"` throws documented error; `"synthesized"` works.

**Smoke (one cheap live run, keys):**
- `intel --ground` → pack carries verified `groundedGrievances[]` + blended weights w/ basis.
- small tournament → personas' anxieties reflect real grievances; report shows
  `groundingCoverage` + `cohortDiversity`.

**Verification gate (before done):** `tsc --noEmit` clean + unit suite green + one live run
where (a) grounded grievances are containment-verified, (b) some personas carry
real-grievance anxieties, (c) coverage/diversity emitted, (d) an ungrounded pack still
yields a working cohort. Evidence before claims.

---

## Out of scope (deferred)

- Verbatim-anchored mode D (seam + schema ready; not implemented).
- Calibration of win-rate to any real outcome (separate track).
- First-party (prescription/marketplace) data — incl. prescription-image OCR.
- Better demand proxies (search-volume/trend) — current blend uses supply + review-activity.
- Defensibility objective; creative-factory connection.
