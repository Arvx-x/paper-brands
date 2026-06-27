# Design: Calibration Layer (Win-Rate + Brand Equity → Real-World Outcome)

**Date:** 2026-06-27
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Piece #2 of the 5-part BuyerArena decomposition (the "moat").
**Model:** Bivariate — `real ≈ a·blind_appeal + b·equity + c`, both coefficients learned, equity
optional and per-coefficient uncalibrated-until-data.

---

## Context

The deep arena (piece #1) emits a **win-rate**: the share of buyers who pick a candidate
under forced blind comparison. This is a *relative hypothesis filter*, not a demand forecast.

Level-1 benchmarking proved the honest ceiling: calibrating win-rate against the **public
traction of established real brands** tops out at Spearman ρ≈0.5 (n≈80). The blind arena strips
brand equity, so it structurally cannot predict outcomes that are dominated by brand equity.

Therefore: win-rate must never be presented as a real-world forecast **unless it has been
calibrated against an observed real-world outcome** — and we must be honest, on every reported
number, about whether that calibration exists.

This layer builds the **vessel and the math** for that calibration: a persistent store of
`(synthetic, real)` observation pairs + an on-demand fit engine + an honesty gate wired into the
report. It does **not** acquire real outcomes itself — that is piece #3.

### Calibration target (decided)

With no first-party sales data available, the primary real-world proxy is **fake-door PDP
click-through (intent CTR)**: one landing page per surviving concept, equal traffic, measure
click-to-notify/buy. This is the real-world analog of the arena's "which option gets picked,"
isolated from brand equity. Piece #3 (ground-truth adapters) will stage these smoke tests and feed
pairs into this layer; the operator funds the micro-tests. This layer is source-agnostic, so the
deeper funnel (lead → conversion → buy) calibrates later as new `source`s without code change.

### Brand equity (decided — bivariate)

The arena is structurally **blind to brand equity**, which is the dominant reason public-traction
calibration caps at ρ≈0.5: the missing ~0.5 is mostly equity. We therefore model equity as a
**separate, separately-sourced, separately-reported covariate** — never folded back into the
blind win-rate:

```
real_estimate ≈ a·blind_concept_appeal  +  b·brand_equity  +  c
                └─ arena win-rate ─┘         └─ external composite input ─┘
                   (unchanged, honest)          (search + distribution + social)
```

Non-negotiable rules (the "carefully"):
- The arena keeps emitting its blind win-rate exactly as today; equity is only ever an
  **adjustment on top**, shown as a decomposition so the operator sees appeal-vs-equity split.
- `b` is **learned from real observation pairs**, never hand-set. With no equity variance in the
  data, `b → 0` and the model degrades exactly to the univariate fit (uncalibrated-until-data,
  applied **per coefficient**).
- `equityScore` is composite and **attributable** (its components are stored), itself a declared
  modeling choice until real pairs validate it.

---

## 1. Architecture

Two pure concerns + one orchestrator, source-agnostic, additive, uncalibrated-until-data.

```
data/<category>/calibration.json        (append-only observation log)
        |
   CalibrationStore   (disk I/O: record / read / dedupe-by-id)
        |
   CalibrationModel   (pure: fit obs -> {a, b, c, rmse, r2, status, equityStatus})
        |
   calibrate(category, rawWinRate, equityScore?)  -> CalibrationResult
        |                                              (status, raw, calibrated, lo, hi, n,
        |                                               method, realMetric, appealContribution,
        |                                               equityContribution, equityStatus)
        |
   formatReport + tournament.json   (one honesty label + equity disclosure per win-rate)
```

New module dir:

```text
src/calibration/
  types.ts      CalibrationObservation, CalibrationFile, CalibrationResult
  store.ts      CalibrationStore  (record/read/dedupe, fail-to-empty)
  model.ts      CalibrationModel  (pure fit + apply)
  calibrate.ts  calibrate() orchestrator
```

No new dependencies. Reuse `src/arena/stats.ts` (`mean`, `stddev`). Fit strength uses **R²** of the
bivariate OLS fit (and per-coefficient identifiability, below), via a small self-contained OLS
helper in `model.ts` — distinct from the rank-based `spearman` used in level-1 benchmarking. The
solver is a 2-predictor normal-equations / closed-form least squares (no matrix lib needed for two
covariates).

---

## 2. Data model

```typescript
export type CalibrationSource = "smoke-test" | "analog" | "manual" | "first-party";
export type CalibrationUnit = "brand" | "concept";

export interface EquityComponents {       // attributable composite (each 0..1, optional)
  search?: number;                        // brand-name search/keyword demand
  distribution?: number;                  // retail/marketplace breadth
  social?: number;                        // social following
}

export interface CalibrationObservation {
  id: string;                 // stable; dedupe key
  category: string;
  syntheticScore: number;     // 0..1  (the arena BLIND win-rate at observation time)
  realOutcome: number;        // 0..1  (observed proxy, e.g. fake-door CTR)
  equityScore?: number;       // 0..1  composite brand equity; OPTIONAL (absent = pure blind concept)
  equityComponents?: EquityComponents;   // provenance of equityScore
  source: CalibrationSource;
  unit: CalibrationUnit;      // brand = UnitA, concept = UnitB
  label: string;              // human tag, e.g. "EcoLips wk1"
  realMetric: string;         // e.g. "landing CTR"
  recordedAt: string;         // ISO
  notes?: string;
}

export interface CalibrationFile {
  category: string;
  observations: CalibrationObservation[];
}

export interface CalibrationResult {
  status: "uncalibrated" | "weak" | "calibrated";   // status of the APPEAL fit
  raw: number;                // input blind win-rate, passthrough
  calibrated: number;         // full estimate (appeal + equity contributions)
  lo: number;                 // CI lower (== calibrated when uncalibrated)
  hi: number;                 // CI upper
  residualRmse: number | null;
  n: number;
  r2: number | null;          // R² of the bivariate fit
  method: "passthrough" | "linear" | "bivariate";
  realMetric: string | null;
  // decomposition (the "carefully" — appeal and equity reported separately)
  appealContribution: number; // a·appeal
  equityContribution: number; // b·equity  (0 when equity not learned)
  equityStatus: "not-learned" | "learned";  // per-coefficient honesty
  warnings: string[];         // mixed-metric, negative-slope, equity-unidentifiable, ...
}
```

Today only `analog` and `manual` are recordable; `smoke-test` arrives with piece #3,
`first-party` is future. **Manual-record only at seed** — do NOT auto-ingest weak analog pairs.
`equityScore` is optional: observations without it are valid (pure blind concept tests) and simply
don't contribute to learning `b`.

Store path follows the existing harvest convention: `data/<category>/calibration.json`
(gitignored). Append-only; dedupe by `id`.

### Composite equity score (declared construction)

`equityScore` ∈ [0,1] blends three normalized observable components — `search` (brand-name search/
keyword demand), `distribution` (retail/marketplace breadth), `social` (following). At seed the
blend is an **equal-weight mean of the present components** (missing components are omitted, not
zero-filled), stored alongside its components for attribution. The weights are an explicit declared
modeling choice (see known-unknowns); once enough real pairs exist, `b` is what's actually learned,
not the internal blend weights.

---

## 3. Fit method

**Bivariate linear OLS** over the category's observations:
`realOutcome ≈ a·syntheticScore + b·equityScore + c`. Closed-form two-predictor least squares; no
matrix lib. Deliberately simple for small N; `method` flags it so isotonic/nonlinear is a future
swap. When no observation carries `equityScore`, the fit collapses to univariate
(`real ≈ a·syntheticScore + c`, `method="linear"`); the bivariate path is `method="bivariate"`.

### Appeal honesty ladder (governs `status`)

The headline `status` reflects the **blind-appeal** fit — the thing the arena actually measures:

| Condition | status | behaviour |
|---|---|---|
| n < 3 | `uncalibrated` | passthrough: `calibrated = raw`, no CI, `method="passthrough"` |
| n ≥ 3 but R² < 0.25 (\|r\| < 0.5), incl. negative appeal slope | `weak` | apply fit, **widen CI**, flag "directional only" |
| n ≥ 3 and R² ≥ 0.25 | `calibrated` | apply fit + RMSE-derived CI |

### Equity honesty (governs `equityStatus`, INDEPENDENT of appeal)

This is the careful part — equity is policed **per-coefficient**, so we can be calibrated on appeal
yet honest that equity isn't learned:

- **No equity variance / unidentifiable** (no observation has `equityScore`, or all equal, or
  collinear with appeal) → `b := 0`, `equityStatus:"not-learned"`, `equityContribution:0`,
  warning `equity-unidentifiable`. The model **silently degrades to the univariate estimate** —
  it never invents an equity effect from nothing.
- **Equity identifiable** (≥3 observations with varying `equityScore`) → learn `b`,
  `equityStatus:"learned"`. A negative or near-zero `b` is reported honestly, never suppressed.

### Shared rules

- **CI = `calibrated ± 1.96·rmse`**, clamped `[0,1]` (residual RMSE of the fit, not Wilson; Wilson
  stays in the arena layer for the raw win-rate's sampling error).
- **Weak widening:** weak fits inflate the CI (×2) — never a tight band on a bad fit.
- **Negative-slope guard:** an anti-correlated *appeal* slope → `weak`, surfaced, never inverted
  into a perverse "improvement."
- **Degenerate input** (zero appeal variance) → `uncalibrated`, no NaN/Inf.
- **The blind win-rate is never mutated.** `raw` always equals the arena's blind win-rate; equity
  only ever appears as the separate `equityContribution` term.

---

## 4. Reporting & the QUALITY gate (the moat made visible)

### CLI (the manual ingest + inspect path)

```bash
bun run calibrate:record --category=lip-care-india \
  --synthetic=0.40 --real=0.031 --source=smoke-test --unit=concept \
  --metric="landing CTR" --label="EcoLips wk1" \
  --equity=0.12 --equity-search=0.2 --equity-distribution=0.05 --equity-social=0.10

bun run calibrate:status --category=lip-care-india
#   n=6 | method=bivariate | R²=0.74 | rmse=0.014 | status=calibrated | equity=learned
#   real ≈ 0.061·appeal + 0.090·equity − 0.003
```

`--equity*` flags are optional; omit them to record a pure blind-concept observation.

### Tournament report (additive lines, driven by `calibrate(category, winRate, equityScore?)`)

```
# uncalibrated (default today)
Best candidate: EcoLips @ 40.0%
⚠ UNCALIBRATED — win-rate is a relative hypothesis, not a demand forecast (0 real observations).

# calibrated, equity not yet learned (degrades to univariate, honestly)
Best candidate: EcoLips @ 40.0%
Calibrated estimate: 3.1% real (landing CTR) ± 1.4%  [n=4, linear, R²=0.55]
  ├ blind concept appeal: +3.1%
  └ brand equity:         +0.0%  (no equity data yet)

# calibrated, equity learned (bivariate)
Best candidate: EcoLips @ 40.0%
Calibrated estimate: 3.1% real (landing CTR) ± 1.4%  [n=6, bivariate, R²=0.74]
  ├ blind concept appeal: +2.4%   (a·appeal)
  └ brand equity:         +0.7%   (b·equity, learned, n=6)

# weak
Best candidate: EcoLips @ 40.0%
Calibrated estimate: 3.1% ± 4.2%  [WEAK fit, n=4, R²=0.14 — directional only]
```

### The QUALITY gate (the contract)

Every reported win-rate ships with **exactly one** of three honest appeal labels —
`UNCALIBRATED` / `WEAK` / `CALIBRATED (±residual)` — **plus** an explicit equity disclosure
(`learned` with its contribution, or `no equity data yet`). There is **no path** where a raw arena
number is printed as a bare real-world forecast, and **no path** where an equity effect is implied
without being learned from real pairs.

### Machine output (`tournament.json`, additive/optional)

```typescript
calibration?: {
  status: "uncalibrated" | "weak" | "calibrated";
  raw: number; calibrated: number; lo: number; hi: number;
  residualRmse: number | null; n: number; method: string; realMetric: string | null;
  appealContribution: number; equityContribution: number;
  equityStatus: "not-learned" | "learned";
}
```

Non-breaking: when absent/uncalibrated, existing consumers see the raw win-rate exactly as today.

---

## 5. Error handling, QUALITY gates & known-unknowns

### Fail to the honest default (uncalibrated)

- No file / empty store → `uncalibrated`, passthrough. (Normal state today, not an error.)
- Corrupt/unparseable `calibration.json` → treat as empty + warn; never crash a tournament.
- `record` with out-of-range values (synthetic/real/equity or any equity component not in 0..1) →
  reject at CLI with clear error; never store.
- Degenerate appeal fit (zero appeal variance) → `uncalibrated`, no divide-by-zero.
- Negative-slope / anti-correlated *appeal* → `weak` + widened CI, surfaced, never applied as
  correction.
- Mixed `realMetric` in one category → fit proceeds; `calibrate:status` warns "mixed metrics".
- **Equity unidentifiable** (no `equityScore` present, all equal, or collinear with appeal) →
  `b:=0`, `equityStatus:"not-learned"`, warn `equity-unidentifiable`; estimate degrades to the
  univariate fit. Never a fabricated equity effect.
- **Collinearity** (equity nearly proportional to appeal) → equity coefficient is unstable; we
  detect near-singular normal equations and fall back to `equityStatus:"not-learned"` rather than
  emit a wild `b`.

### QUALITY.md gate map

| Principle | Satisfied by |
|---|---|
| Plausibility ≠ truth; calibrate against real outcomes | the layer's entire purpose |
| Declare known-unknowns | every result carries `status` (uncalibrated/weak/calibrated) |
| No aggregate without uncertainty | calibrated estimate always ships with RMSE-derived CI |
| Reproducibility measured | append-only, dedupe-by-id log; deterministic fit |
| Fail loud, propagate degraded | status propagates into report + json, not just a log line |
| Separate observation from inference | store holds raw pairs; model holds inferred fit |
| Bind to source / weight by trust | observation carries source + unit + realMetric + equity provenance |
| No invented signal | equity contributes 0 until `b` is learned from real pairs (per-coefficient) |
| Decompose, don't blend | report splits appeal vs equity; blind win-rate never mutated |

### Declared known-unknowns

- Only as good as the observations recorded; most categories will sit `uncalibrated`. Correct.
- Analog (public-traction) pairs are weak (ρ≈0.5 proven) → produce `weak` fits; don't over-trust.
- Linear fit can't capture nonlinearity for small N; `method` flags it; isotonic is future.
- Mixing units/metrics dilutes the fit; layer warns, does not yet enforce separation.
- This layer does **not** acquire real outcomes — that is piece #3.
- **Equity composite weights are a declared modeling choice** (equal-weight at seed). They are not
  empirically validated; only the learned `b` is. Treat the internal blend as a convenience, not
  truth — its weighting is a known-unknown until per-component data justifies otherwise.
- **Equity needs variance to be learnable.** Fake-door concepts for not-yet-launched brands have
  ~zero equity, so early on `b` will usually be `not-learned` — correct, not broken. Equity becomes
  learnable only once observations span a real equity range (e.g. recording established analogs
  alongside fresh concepts).
- **Bivariate fit at small N is fragile** (2 predictors + intercept needs n≥3 just to identify, and
  more to be stable). The R²/identifiability gates guard against over-reading a tiny sample.

### Honest boundary statement

This builds the vessel and the math for the moat. It does not, by itself, make win-rates true; it
makes them **honestly labeled** and **ready to become true** the moment real outcomes are recorded
— manually today, via the fake-door smoke-test adapter (piece #3), via first-party data later.

---

## 6. Testing strategy

Pure functions except the store's disk I/O. Deterministic; no LLM, no network. TDD, red-first.

**A. CalibrationModel — appeal fit (pure):**
- uncalibrated below threshold (n=0,1,2) → passthrough, no CI.
- calibrated on clean linear set `y=0.08x−0.004` (n≥3, no equity) → recovered slope/intercept
  within ε, `method="linear"`, `rmse≈0`, CI≈0.
- weak fit on noisy data (R²<0.25) → `weak`, widened CI, estimate still returned.
- RMSE→CI mapping → `±1.96·rmse`, clamped [0,1] (assert both clamp ends).
- negative appeal slope → `weak`, flagged, never perverse.
- degenerate input (zero appeal variance) → `uncalibrated`, no NaN/Inf.
- monotonic sanity: higher raw → higher-or-equal calibrated.

**A2. CalibrationModel — equity / bivariate (pure, the careful part):**
- **no equity present** → `method="linear"`, `equityStatus:"not-learned"`,
  `equityContribution===0`, estimate identical to univariate; warning `equity-unidentifiable`.
- **clean bivariate set** `y=0.06·appeal+0.09·equity−0.003` (n≥3, varying equity) → recovered
  a/b/c within ε, `method="bivariate"`, `equityStatus:"learned"`, contributions sum (+intercept)
  to `calibrated`.
- **equity constant across obs** → `b:=0`, `not-learned` (no variance to identify b).
- **equity collinear with appeal** → near-singular detected → `not-learned`, no wild `b`.
- **negative learned b** → reported honestly (not suppressed, not flagged as error).
- **appeal calibrated + equity not-learned simultaneously** → `status:"calibrated"`,
  `equityStatus:"not-learned"` (independence of the two ladders).
- **blind win-rate immutability:** `raw` always equals the input win-rate regardless of equity.

**B. CalibrationStore (temp-dir I/O):**
- round-trip identical (incl. optional `equityScore`/`equityComponents`); append-only; dedupe by
  id; missing file → empty (no throw); corrupt JSON → empty + warn (no throw); range rejection at
  record (synthetic/real/equity/components all guarded).

**C. calibrate() orchestrator:**
- empty category → uncalibrated passthrough.
- seeded calibrated category → correct estimate + CI + status/n/method/realMetric + decomposition.
- bivariate seeded category → `equityStatus:"learned"` with non-zero `equityContribution`.
- mixed-metric warning surfaces.

**D. Report contract (the gate — most important):**
- three-label invariant: exactly one of UNCALIBRATED/WEAK/CALIBRATED, never a bare forecast.
- equity disclosure invariant: report always states equity as `learned (+x%)` or `no equity data
  yet` — never implies an equity effect that wasn't learned.
- decomposition sums: appeal + equity contributions (+ intercept) reconcile to the printed
  `calibrated` value.
- additive json: `calibration` (incl. `appealContribution`/`equityContribution`/`equityStatus`)
  present only when applicable; absent ⇒ consumers unchanged.

**E. CLI smoke (light):** `record` validates + writes (with/without `--equity*` flags); `status`
renders one-line summary incl. equity state; bad args exit non-zero with clear message.

---

## Out of scope

- Acquiring real outcomes / staging smoke tests (piece #3 — fake-door PDP CTR adapter).
- **Harvesting the equity components** (search volume / distribution / social) — this layer
  *consumes* an `equityScore` if recorded; sourcing it automatically is a follow-on (folds into
  piece #3 / a dedicated equity-harvest task). At seed, equity is supplied manually via CLI flags.
- Isotonic / nonlinear fits; >2 covariates.
- Per-metric segregation within a category.
- Cost-aware arena routing (piece #4), defensibility (piece #5).
