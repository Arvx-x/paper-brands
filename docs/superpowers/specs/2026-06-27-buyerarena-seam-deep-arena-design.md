# Design: `BuyerArena` seam + deep-negotiation arena adaptation

**Date:** 2026-06-27
**Status:** Approved (design phase)
**Repo target:** `paper-brands` (the foundry). Prototyped in `paper-brands-research`.
**Piece:** #1 of a 4-part decomposition (see "Context").

---

## Context — the bigger picture

`paper-brands` is an agentic brand foundry: turn a category into evidence-ranked,
launchable private-label brands **before inventory exists**, via the spine
`Pack → Council → Arena → Optimizer` (plus a Creative Factory on the same spine).
Its own thesis (README / QUALITY.md): **"win-rate from the synthetic arena is a
hypothesis filter, not proof of demand. The moat is the calibration loop, not
'we use agents.'"**

The owner's strategic decisions that frame this spec:
- The repo is **ours**; this is an in-place upgrade, not a greenfield rebuild.
- **Calibration is the moat.** Arena depth is a means to that end, not the end.
- The end-to-end foundry is the product; the arena is one (currently weakest) component.

Four-part decomposition (each its own spec → plan → build cycle):
1. **`BuyerArena` interface + adapt the deep negotiation arena to the blind
   N-option format.** ← THIS SPEC.
2. Calibration layer (source-agnostic): `(syntheticScore, realOutcome)` → fitted
   correction + residual + CI + QUALITY gate. *(The moat — deferred to its own cycle.)*
3. Ground-truth adapters (smoke-test / analog / first-party data) feeding #2.
4. Cost-aware arena routing (cheap single-shot for breadth, deep for finalists).

**Scope of this spec:** piece #1 only. Calibration (#2–#4) is explicitly deferred.

---

## Problem

The existing arena (`src/arena/arena.ts`) asks each persona a **single-shot
relative choice**: "given N blind options, pick ONE." The research-repo engine asks
a different question: a **multi-turn, single-product absolute decision** with WTP
elasticity and engine-gated (non-sycophantic) buying.

The foundry fundamentally needs a **relative** signal (win-rate vs. *disguised*
competitors, to control for LLM pretraining/name bias — a correct, load-bearing
methodological choice). So the deep arena must produce a relative pick, not just a
yes/no purchase. This spec reconciles the two.

Secondary problem: the current arena violates several of the repo's own QUALITY.md
principles — most notably **F2 (silent degradation)** and **F7 (missing ≠ null)**:
a persona that fails to answer is silently dropped (`if (!choice) return`), and
there is no uncertainty quantification on win-rate.

---

## Central decision: how a negotiation engine produces a pick among N options

**Chosen: Approach (A) — sequential consideration → best affordable option.**
Each persona negotiates against each option on the slate independently; the engine
picks the affordable option with the highest post-negotiation **conviction**.

Rationale: most faithful to real shopping (evaluate options one at a time), reuses
the engine's per-product elasticity/pressure dynamics (its actual value), and keeps
the relative signal the foundry needs. Rejected alternatives:
- (B) shortlist-then-deep-negotiate — deferred to the cost router (piece #4); the
  seam is built ready for it.
- (C) single multi-option negotiation — discards the engine's core strength and
  reintroduces the single-shot flattening we're trying to fix.

**Cost is acknowledged:** (A) is `cohort × slate × ~7 calls` (e.g. 40×8×7 ≈ 2,240
calls/run vs ~40 single-shot). This is exactly why `costClass: "expensive"` exists
and why piece #4 will reserve the deep arena for finalists. Piece #1 builds it
correct-first; routing is deferred.

---

## The `BuyerArena` interface (the seam)

New `src/arena/types.ts`. Both arenas implement one contract so the tournament,
optimizer, and (future) calibration layer depend on the abstraction.

```typescript
export interface ArenaInput {
  candidates: BrandConcept[];
  cohort: Persona[];
  pack: CategoryPack;
  opts?: { includeCompetitors?: boolean; seed?: number };
}

/** Superset of today's MatchResult — existing fields BYTE-IDENTICAL (non-breaking). */
export interface MatchResult {
  personaId: string;
  segment: string;
  pickedConceptId: string;        // "competitor:" prefix allowed
  pickedLabel: string;
  willingnessToPayMinor: number;
  reason: string;
  topObjection: string;
  // NEW, optional enrichment (richer arenas populate; scorer tolerates absence):
  confidence?: number;            // 0..1 engine conviction behind the pick
  abstained?: boolean;            // persona made NO pick (buy-none) — NOT a competitor win
  errored?: boolean;             // persona failed to resolve (LLM/parse) — separate from abstained
  perOptionWtpMinor?: Record<string, number>;
  turnsToDecision?: number;
}

export interface BuyerArena {
  readonly kind: "single-shot" | "deep-negotiation";
  readonly costClass: "cheap" | "expensive";
  run(input: ArenaInput): Promise<MatchResult[]>;
}
```

Decisions:
1. `MatchResult` is a **superset** — `score.ts`, `tournament.ts`, optimizer keep
   working untouched; new fields are optional.
2. `kind` + `costClass` live on the **contract** (calibration calibrates each arena
   separately; the router needs cost) — avoids `instanceof` checks.
3. `abstained` / `errored` are **first-class** — kills the silent-drop (F2) and lets
   "queried, buy-none" be distinguished from "failed" (F7/F10).

The existing `Arena` becomes `SingleShotArena implements BuyerArena` (rename + two
readonly fields + set `abstained`/`errored` instead of dropping the persona).

---

## `DeepNegotiationArena` internals

```
for each persona (concurrency-capped pool):
  traits = deriveTraits(persona, pack)              // deterministic + seeded jitter
  slate  = shuffle([...candidates, ...disguisedCompetitors])   // blind OPTION-x
  for each option in slate:
     result = negotiate(persona+traits, option, seed)   // adapted 4-turn engine
     // result: { conviction, finalWTP, affordable, turns }
  affordable = options where listedPrice ≤ finalWTP(option)
  pick = argmax(conviction) over affordable
         ties → max headroom (wtp−price) → seeded coin-flip
  if no affordable option → abstained = true
  emit MatchResult
```

### Three adaptations

**1. Persona-shape bridge — `deriveTraits(persona, pack)`.**
Maps the foundry `Persona` (segment, `budgetSensitivity` low|med|high, `anxieties[]`,
`decisionStyle`) to the engine's 0–1 traits:
- `budgetSensitivity` → `priceConsciousness` + seeds `basePMax` from the pack's price
  bands.
- `anxieties[]` → `reluctancePrior`.
- `decisionStyle` → `skepticism` / `impulsivity` priors.
Assignment is **deterministic mapping + small seeded jitter** so personas within a
segment are not clones (counters the documented variance-collapse failure mode) while
staying reproducible by seed. Grounding these in real data is piece #3, not here.

**2. No sales agent; the brand's own claims are the stimulus (fixed price).**
DTC landing pages do not haggle. So:
- **Removed:** the Sales Agent, `handleObjection`, **`p_min`** (margin floor) and ALL
  discounting. `p_min` only ever existed to bound haggling; with no haggle it is
  unnecessary. Removing the agent changes nothing about the buyer's WTP.
- **Kept, unchanged:** the elastic **`p_max`/WTP** math
  (`base + trust + value + impulse − pressure`), the conviction gate, the cumulative
  pressure accumulator, and the seeded RNG.
- **Rewired:** the per-turn stimulus changes from "salesman's rebuttal" → "the brand's
  own `claims[]` / `productPromise` evaluated against the objection the persona
  surfaced this turn." Turns model a shopper's **deliberation** (reading the page,
  sitting with doubts), not a negotiation.
- **Price:** fixed at `option.priceMinor`; it never moves. Only the buyer's WTP moves —
  up if claims resolve the anxiety, down if claims feel like empty hype (`pressureScore`
  rises). **Over-claiming brands get punished**, which is the honest signal the foundry
  wants (ties to QUALITY.md "stated ≠ revealed").

**3. Conviction is the cross-option comparator.** The engine's existing `conviction`
scalar (not a binary buy) ranks options for the pick — making "which would I actually
buy" a graded comparison rather than N independent coin-flips.

### Known property (write into limitations)
Without a salesman, an objection can only be resolved by what is **already on the
card**. A persona whose anxiety the brand never addresses will never gain conviction.
This is a feature (rewards brands that pre-empt real objections) but means the deep
arena's discriminating power depends on how rich `BlindCard.pitch` is.

---

## Competitor pricing & relative-scoring reconciliation

**Competitor price:** each disguised competitor is judged at its band's **deterministic
mid price** (reuse the existing `midPrice()` helper). Deterministic (not random within
band) preserves reproducibility and apples-to-apples comparison. The price each option
was judged at is recorded (`perOptionWtpMinor` / audit) so it is inspectable.

**Relative pick:** the persona "shops the slate" and picks the best affordable option —
genuinely relative, matching foundry win-rate semantics. **Abstention is NOT
redistributed to competitors.** A "buy none" is an honest category-level signal: a high
abstention rate means the whole slate (candidate included) failed to convince.

**Scoring changes to `score.ts` (additive, not a rewrite):**
- Win-rate computed over **deciding** personas; `abstentionRate` and `errorRate`
  reported separately (satisfies F7 — missing/none ≠ a competitor win).
- Every win-rate carries a **Wilson 95% interval** (replaces bare proportions;
  satisfies "no aggregate without a CI", QUALITY #6).
- Multi-seed replication (via `ArenaInput.opts.seed`) → report **mean ± 1σ** at the
  tournament level (satisfies "reproducibility measured, not asserted", QUALITY #11).

**Moat relevance:** the deep arena emits three signals the single-shot cannot — graded
conviction, per-option WTP, category-level abstention. These become the richer
**summary statistics / pattern vector** that the calibration layer (piece #2) will
match against real data. Piece #1 therefore also "produces the pattern vector
calibration needs," not merely "swaps the arena."

---

## Data flow

```
CategoryPack ─▶ Council ─▶ candidates[]
                              │
Cohort ───────────────────────┤
                              ▼
   DeepNegotiationArena.run(ArenaInput)
     per persona (pooled): deriveTraits → negotiate vs each option → pick|abstain
   → MatchResult[] (+confidence, abstained, errored, perOptionWtp)
                              ▼
   score() → ArenaReport (+abstentionRate, errorRate, Wilson CI, degraded flag)
                              ▼
   tournament.json / optimizer hill-climb   (unchanged consumers)
```

Only the arena swaps; everything up/downstream is untouched.

---

## Error handling (resolving current QUALITY.md violations)

- **Per-option failure** (LLM/parse error on one option): that option →
  `conviction=0, affordable=false`, logged. The persona still picks among the others.
  One bad option ≠ a lost persona.
- **Whole-persona failure** (every option errored): `errored=true` with reason —
  distinguished from a genuine buy-none (`abstained`). Report surfaces `errorRate`
  separately. Eliminates silent degradation (F2).
- **Resilience:** add timeout + exponential backoff (with jitter) into the foundry's
  `LLMClient.completeJson` (which already has a repair retry) so **both** arenas
  benefit. Ported from the research repo's hardened `callGemini`.
- **`degraded` propagation:** high error/abstention rate sets `ArenaReport.degraded =
  true` so downstream gating sees it (QUALITY #17), not just a log line.

---

## Uncertainty

- Wilson 95% interval on every win-rate in `score.ts`.
- `ArenaInput.opts.seed` enables multi-seed replication → mean ± 1σ reported at the
  tournament level.

---

## QUALITY.md compliance map

| Principle / failure mode | How piece #1 satisfies it |
|---|---|
| F2 silent degradation | per-option + per-persona errors logged & counted, never dropped |
| F7 missing ≠ null | `abstained` (buy-none) and `errored` separate from competitor wins |
| F10 stated ≠ revealed | engine-gated decision (not self-reported pick) is the core mechanism |
| #6 no aggregate w/o CI | Wilson interval on every win-rate |
| #11 reproducibility measured | seeded RNG + multi-seed std, not `temperature:0` |
| #17 degraded propagates | high error/abstention → `degraded:true` on the report |
| #15 declare known-unknowns | limitation below is stated explicitly |

---

## Explicit limitation (known-unknown)

This piece makes the arena **more sophisticated and more QUALITY-compliant**, but it
remains **uncalibrated**: its absolute win-rates are a hypothesis until piece #2 ties
them to real outcomes. The deliverable is "a better-instrumented, swappable, honest
hypothesis generator that emits the richer pattern vector calibration needs" — NOT a
validated demand predictor. A more elaborate engine has more ways to be confidently
wrong until calibrated; sophistication is not the moat.

---

## Testing strategy

**Unit (pure, no API):**
- `deriveTraits()` — fixed input → expected ranges; same seed identical; different
  seeds → bounded spread.
- Pick logic — argmax-affordable; all-unaffordable → abstained; tie-break order.
- WTP/conviction math — value-stretch, impulse gated by trait, pressure backfire
  (port existing dry-run assertions into real tests).
- Scoring — abstention/error not counted as wins; Wilson bounds; multi-seed std.
- Interface conformance — shared test both arenas pass.

**Smoke (one cheap real run):** 2 candidates + 1 competitor × 3 personas end-to-end →
no crash, every persona resolves to pick-or-abstain, `degraded` flags when forced.

**Verification gate (before "done"):** `tsc --noEmit` clean + unit suite green + one
live smoke run yields a coherent `tournament.json`. No success claim without that
evidence.

---

## Out of scope (deferred)

- Calibration layer and ground-truth adapters (pieces #2–#3).
- Cost-aware routing / shortlist mode (piece #4).
- Grounding personas or traits in first-party (dermat/marketplace) data.
- Changes to Council, harvester, Creative Factory.
```
