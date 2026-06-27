# Design: Cost-Aware Arena Routing (Funnel)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Piece #4 — cost-aware routing.

---

## Context

The tournament currently picks an arena via a binary `--deep` flag: single-shot (cheap, noisier)
or deep negotiation (expensive ~5-10× per persona, rich WTP/confidence signal). Running deep over
the full candidate slate spends the expensive arena on obvious losers.

We add a **two-stage funnel**: a cheap single-shot screen ranks all candidates, then only the
contenders advance to the deep arena. The key risk — a noisy cheap screen discarding genuinely good
ideas — is mitigated by advancing every candidate the screen *cannot statistically rule out*
(CI overlap with the leader), bounded by a floor and cap. The operator stays in control by choosing
the mode explicitly (no silent auto-routing), since cheap-vs-deep rank correlation is not yet
validated.

### Decisions (locked during brainstorming)

- **Three modes:** `cheap | deep | funnel`, selectable via CLI now (frontend toggle later).
  Default stays `deep` (preserves current behavior; non-breaking).
- **Funnel shape:** cheap single-shot screen over ALL candidates → deep negotiation over the
  survivors.
- **Survivor cutoff:** advance any candidate whose cheap Wilson CI overlaps the leader's, floored at
  `--finalists` (default 3), capped at a max (default 5). The cheap arena only eliminates
  statistically-sure losers — directly protecting good ideas from a noisy screen.
- **No auto-mode heuristic.** Operator chooses; the funnel never silently decides to over/under-spend.

---

## 1. Architecture

Routing is a thin orchestration layer in the tournament pipeline. The two arenas already implement
`BuyerArena` (`kind`/`costClass`) and are unchanged. We add a mode selector + a funnel runner whose
only genuinely new logic is a pure finalist selector.

```
TournamentOptions.mode: "cheap" | "deep" | "funnel"
   runTournament
     ├─ "cheap"  → SingleShotArena over all candidates           (existing path)
     ├─ "deep"   → DeepNegotiationArena over all candidates       (existing path, current default)
     └─ "funnel" → runFunnel(...)
                     ├─ STAGE 1: SingleShotArena over ALL candidates (small screen cohort)
                     │     → score() → Wilson CIs (existing)
                     ├─ selectFinalists(screenReport, {floor, cap})  [PURE]
                     └─ STAGE 2: DeepNegotiationArena over finalists (full cohort)
                           → score() → final report (+ funnel metadata)
```

**New module:**
```text
src/pipeline/funnel.ts
  selectFinalists(report, { floor, cap }) -> FinalistSelection   [PURE]
  runFunnel(...) orchestrator (uses existing score/arena/cohort)
src/pipeline/funnel.test.ts
```

**Modified:**
- `src/pipeline/tournament.ts` — `mode` option; dispatch; additive `funnel?` report field +
  `formatReport` lines.
- `src/cli.ts` — `--mode=cheap|deep|funnel` (keep `--deep` alias), `--finalists`,
  `--finalists-cap`, `--screen-cohort`.

Reuses `SingleShotArena`, `DeepNegotiationArena`, `score()`, `wilsonInterval`/CIs, `buildCohort`.
No new dependencies.

---

## 2. Data model & options

```typescript
export type ArenaMode = "cheap" | "deep" | "funnel";

export interface TournamentOptions {
  categoryId: string;
  candidates: number;
  cohortSize: number;          // full cohort (deep, and funnel stage 2)
  outDir?: string;
  mode?: ArenaMode;            // default "deep"
  deep?: boolean;              // DEPRECATED alias: deep:true => mode:"deep" when mode unset
  seed?: number;
  runs?: number;
  // funnel-only (ignored in cheap/deep):
  finalists?: number;          // floor for survivors (default 3)
  finalistsCap?: number;       // hard cap on survivors (default 5)
  screenCohortSize?: number;   // cheap-screen cohort (default = min(cohortSize, 20))
}

export interface FinalistSelection {
  finalistIds: string[];       // advance to deep (screen-rank order)
  eliminatedIds: string[];     // dropped at screen
  leaderId: string;
  reason: string;              // legible, e.g. "4 advanced (CI overlap); 2 eliminated (CI below leader)"
}

export interface FunnelReport {
  mode: "funnel";
  screenCohortSize: number;
  deepCohortSize: number;
  screened: number;            // candidates screened (cheap)
  advanced: number;            // finalists run deep
  eliminated: number;
  floor: number;
  cap: number;
  leaderId: string;
  finalistIds: string[];
  eliminatedIds: string[];
  screenCostClass: "cheap";
  deepCostClass: "expensive";
}
```

**Data-flow points:**
- **Screen uses a smaller cohort** (`screenCohortSize`, default `min(cohortSize, 20)`) — the saving.
  Stage 2 (deep) uses full `cohortSize` on survivors.
- **Same Council concepts + same `pack`** flow through both stages (no regeneration between stages).
- `funnel?: FunnelReport` attached to `TournamentOutput` additively (absent in cheap/deep →
  consumers unchanged), exactly like `calibration`/`conceptDiversity`.
- **Back-compat:** `deep:true` (or `--deep`) with `mode` unset → `mode:"deep"`. Neither set →
  default `"deep"` (current behavior preserved).

**Non-goals (YAGNI):** no auto-mode heuristic; no per-LLM-call budget accounting (cost lever is
cohort-size reduction + finalist count, the honest measurable knobs); no cross-stage regeneration.

---

## 3. selectFinalists (pure core)

```typescript
selectFinalists(report: ArenaReport, opts: { floor: number; cap: number }): FinalistSelection
```

Deterministic, no LLM/I/O. Operates on the screen's per-concept scores, each carrying a Wilson
interval (`winRate`, `winRateCiLow`, `winRateCiHigh` from existing `score()`).

**Algorithm:**
1. **Exclude non-candidates:** drop `conceptId` starting `benchmark:` or `competitor:`.
2. **Leader:** highest `winRate`; its `winRateCiLow` is the reference bound.
3. **CI-overlap test (quality guardrail):** a candidate advances if `winRateCiHigh >=
   leader.winRateCiLow` (its CI still overlaps the leader's — cannot be statistically ruled out).
   Candidates whose entire CI sits below the leader's lower bound are eliminated.
4. **Floor:** if fewer than `floor` pass, advance the top `floor` by `winRate` anyway (never deep
   fewer than the floor). If total candidates < floor, advance all.
5. **Cap:** if more than `cap` pass, keep top `cap` by `winRate` (budget guardrail vs a flat screen).
6. **Legible `reason`** naming which rule fired.

**Worked examples:**
- `[0.40,0.32,0.30,0.10,0.08]`, top-3 CIs overlap → top 3 advance, bottom 2 eliminated.
- `[0.55,0.12,0.10,0.08]`, only leader stands alone → overlap yields 1 → **floor=3** advances top 3
  (this answers "don't lose good ideas": a decisive screen still advances the floor).
- `[0.22,0.21,0.20,0.20,0.19,0.18]` all overlap, n=6 → **cap=5** keeps top 5.

**Why leader CI-low, not pairwise:** a single reference bound (leader's lower CI) deterministically
expresses "could this plausibly be best?"; pairwise matrices don't change the advance set here (YAGNI).

**Tests (pure, fixtures):** overlap advances mid-pack / eliminates confidently-worse; floor applied
on high-separation; cap applied on flat slate; benchmark/competitor excluded; fewer than floor →
advance all; deterministic; single candidate advances; `reason` reflects the rule fired.

---

## 4. Funnel runner, report/CLI wiring, error handling

### 4a. `runFunnel(...)`
```
1. screenCohort = (await buildCohort(pack, screenCohortSize)).personas
2. screenResults = await SingleShotArena(pack).run({ candidates, cohort: screenCohort, pack, opts: { includeCompetitors: true, seed } })
   screenReport   = score(screenResults, candidates, pack.benchmarkBrands ?? [])
3. sel = selectFinalists(screenReport, { floor, cap })                 // PURE
4. finalists = candidates.filter(c => sel.finalistIds.includes(c.id))
5. deepCohort = (await buildCohort(pack, cohortSize)).personas         // full cohort
6. deepResults = await DeepNegotiationArena(pack).run({ candidates: finalists, cohort: deepCohort, pack, opts: { includeCompetitors: true, seed: seed + 1 } })
   finalReport  = score(deepResults, finalists, pack.benchmarkBrands ?? [])
7. return { report: finalReport, funnel: FunnelReport{...sel, sizes, counts} }
```
Notes: `includeCompetitors: true` is kept in BOTH stages so the blind competitor/benchmark controls
still appear in the arena; `selectFinalists` excludes those ids from *candidacy* only. `score()` is
passed the stage's candidate set (`candidates` for screen, `finalists` for deep) plus
`pack.benchmarkBrands`.
- **Final report = deep result over finalists** — ranks the winner, gets calibration applied, is
  written to `tournament.json`. The cheap screen is internal (selection, not the headline).
- Determinism: both stages seeded off `opts.seed` (deep uses a derived seed so cohorts differ but
  reproduce). Concepts + pack identical across stages.

### 4b. `runTournament` dispatch (additive, back-compat)
```typescript
// Default is "deep". `deep:true` only matters for the alias path (it also resolves to "deep").
const mode: ArenaMode = opts.mode ?? "deep";
if (mode === "funnel") { const { report, funnel } = await runFunnel(...); out.funnel = funnel; }
else { const arena = mode === "cheap" ? new SingleShotArena(pack) : new DeepNegotiationArena(pack); /* existing path */ }
```
`funnel?: FunnelReport` attached only in funnel mode (absent otherwise → non-breaking).

### 4c. `formatReport` lines (after leaderboard, like calibration/diversity)
```
Arena mode: funnel (cheap screen → deep finalists)
  Screened 6 candidates @ cohort 20 (cheap) → advanced 4 → deep @ cohort 40 (expensive)
  Eliminated 2 (CI below leader): aromabalance, luxe-lip-solutions
```
Absent for cheap/deep → nothing prints.

### 4d. CLI
```bash
bun run tournament --category=lipcare-india --mode=funnel --candidates=6 --finalists=3 --cohort=40 [--screen-cohort=20] [--finalists-cap=5]
bun run tournament --category=lipcare-india --deep    # => mode=deep (unchanged)
bun run tournament --category=lipcare-india           # => default deep (unchanged)
```
- `--mode` validated to `cheap|deep|funnel`; bad value → error, exit 2.
- `--deep` retained as alias; if both `--mode` and `--deep` given, `--mode` wins (warn).

### 4e. Error handling / QUALITY map
| Case | Behavior |
|---|---|
| Funnel screen yields no rankable candidates (all errored/abstained) | fall back to deep on ALL candidates + warn (don't silently drop the run) |
| `floor` > candidate count | advance all candidates (no crash) |
| finalists empty after selection | guard: advance top-`floor`; if still empty, error clearly |
| invalid `--mode` | exit 2 with usage |
| screen cohort build fails | propagate as existing cohort errors |
| funnel on degraded pack | still runs (operator chose it); existing pack-degraded warning prints; no second gate (operator stays in control) |

Doctrine: the funnel never hides what it eliminated (every eliminated id + reason in report + json
— declare known-unknowns); the cheap screen only removes statistically-sure losers (CI test);
determinism preserved and measurable.

### 4f. Tests
- `selectFinalists`: the 8 pure cases from §3.
- `runFunnel` (fake arenas/fixtures, no LLM): screen→select→deep wiring; finalists subset passed to
  deep; FunnelReport counts correct; all-errored screen → deep-on-all fallback.
- dispatch: `mode` selects the right path; `deep:true`/`--deep` → deep; default deep; funnel attaches
  `funnel?` and nothing else changes for cheap/deep (non-breaking).
- report: funnel lines render; absent for cheap/deep.
- CLI smoke: `--mode=funnel` runs; bad `--mode` exits 2.

---

## Out of scope
- Auto-mode heuristic (pack-confidence / candidate-count driven selection).
- Per-LLM-call budget accounting or hard cost ceilings.
- Cross-stage concept regeneration or re-screening loops.
- Measuring cheap-vs-deep rank correlation (a future calibration-of-the-screen task; the operator
  staying in control sidesteps the need for now).
- Frontend mode toggle (the CLI flag is the interim surface).
