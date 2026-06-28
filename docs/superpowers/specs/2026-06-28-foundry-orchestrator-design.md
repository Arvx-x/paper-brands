# Design: Foundry Orchestrator (spawn-8 → deep → top-3)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Pipeline piece #1 — orchestrator. Backbone for the
spawn → arena → top-3 → creative → smoke-test loop. (Creative-as-PDP and funnel are later pieces.)

---

## Context

The platform has all the parts (council, diversity, deep arena, moat, calibration, smoke-test) but
no single command that runs the foundry loop end-to-end. The intended product flow is: spawn 6-8
distinct brands in a category, run the deep arena on all of them, take the top 3 by win-rate, and
hand those finalists to the creative factory to build real (smoke-test-ready) landing pages.

This piece builds the **backbone**: a thin `foundry` orchestrator that spawns 8, runs the existing
deep-arena+moat tournament, selects the top 3 by win-rate, and emits a clean `finalists.json`
artifact the creative step (next piece) will consume.

**Why deep on all 8, not a cheap funnel:** the cheap single-shot screen is unvalidated — we have not
measured whether it ranks consistently with the deep arena (and the deep arena itself shows weak/
negative correlation to real-brand traction). Adopting an unvalidated screen would violate the
QUALITY doctrine. So this piece runs deep on all 8; a measured funnel is a future optimization.

### Decisions (locked during brainstorming)

- **Spawn 8, advance top 3.**
- **Rank by win-rate only**; moat is recorded in the artifact but NOT used to rank (never blend
  two soft signals).
- **Thin wrapper over `runTournament`** (candidates=8, deep, moat on) — no pipeline duplication.
- **Output a `finalists.json` artifact** (top-3 concepts + win-rate/CI/WTP + moat).
- **Frontend-shaped seam:** `runFoundry` returns the `FinalistsArtifact` object (a future thin
  frontend calls it and renders the artifact; the CLI just prints it). Everything a UI needs lives
  in the artifact — no consumer re-reads `tournament.json`.

---

## 1. Architecture

```
runFoundry(opts)                                  [thin orchestrator, returns FinalistsArtifact]
   ├─ runTournament({ ...opts, candidates: 8, mode: "deep", moat: true })   [REUSED, unchanged]
   │      → TournamentOutput (report.concepts win-rates, moat, concepts)
   ├─ selectFinalists(tournamentOutput, n=3)       [PURE]
   │      → top-3 generated concepts by win-rate, each joined to its moat
   └─ write out/finalists.json  +  return the artifact
```

**New module:**
```text
src/pipeline/foundry.ts
  types:  Finalist, FinalistsArtifact, FoundryOptions
  selectFinalists(tournamentOutput, n)  -> FinalistsArtifact   [PURE]
  runFoundry(opts, deps?)               -> Promise<FinalistsArtifact>   [orchestrator]
src/pipeline/foundry.test.ts
```

**Modified:**
- `src/cli.ts` — `foundry` verb calling `runFoundry`, prints the artifact summary.
- `package.json` — `foundry` script.

Reuses `runTournament` wholesale, `TournamentOutput`, `ConceptScore`, `MoatScore`/`MoatReport`,
`BrandConcept`. No new dependencies. The only genuinely new logic is the pure `selectFinalists`
(fixture-tested, no LLM); `runFoundry` is thin glue with an injectable tournament dependency for
testability.

---

## 2. Data model

```typescript
import type { BrandConcept } from "../brand/types.ts";
import type { MoatScore } from "../moat/types.ts";

export interface Finalist {
  rank: number;              // 1..n by win-rate (1 = best)
  concept: BrandConcept;     // full concept (creative step needs all fields)
  winRate: number;           // 0..1, deep arena
  winRateCiLow: number;
  winRateCiHigh: number;
  avgWtpMinor: number;
  moat?: MoatScore;          // 4 axes + overall + rationales; optional (moat off/degraded)
}

export interface FinalistsArtifact {
  categoryId: string;
  builtAt: string;           // ISO
  spawned: number;           // generated concepts considered
  selected: number;          // advanced
  rankedBy: "winRate";       // explicit: cut criterion (moat NOT used to rank)
  finalists: Finalist[];     // rank-ordered
  warnings: string[];        // e.g. "moat unavailable for X", "only 2 concepts available"
}

export interface FoundryOptions {
  categoryId: string;
  candidates?: number;       // spawn count, default 8
  finalists?: number;        // advance count, default 3
  cohortSize?: number;       // default 80 (production default)
  seed?: number;
  outDir?: string;           // default "out"
}
```

**Why the artifact carries what it does:** the full `BrandConcept` per finalist (creative step
needs every field), win-rate + CI + WTP (arena signals, no recomputation), `moat?` joined by
`conceptId`, `rankedBy` to encode the honest contract in the data, `spawned`/`selected` for funnel
transparency, `warnings` to surface degraded states.

**Selection / join rules:**
- Only generated concepts ranked (exclude `benchmark:`/`competitor:` ids).
- Rank by `winRate` desc; ties broken by `conceptId` asc (deterministic).
- `n = min(requestedFinalists, availableConcepts)`; fewer than n → take all + warning (never pad).
- Moat join best-effort: no matching moat → `moat: undefined` + warning (never fabricated).
- A `report.concepts` id with no matching `BrandConcept` in `tournamentOutput.concepts` → skip +
  warn (cannot build creative for a concept we don't have).

**Non-goals (YAGNI):** no blended score; no calibration in the artifact (finalist win-rate is
uncalibrated pre-smoke-test by definition; the tournament report already carries the calibration
line — the artifact is about *which* concepts advance); no landing-page data (creative step).

---

## 3. selectFinalists (pure) + runFoundry + CLI

### 3a. `selectFinalists(tournamentOutput, n): FinalistsArtifact` — pure
```
1. candidates = report.concepts.filter(c => !id startsWith "benchmark:"/"competitor:")
2. sort by winRate desc, ties by conceptId asc
3. take top min(n, candidates.length)
4. each -> join BrandConcept (by id from tournamentOutput.concepts)
          + join moat (from tournamentOutput.moat?.concepts by conceptId, best-effort)
          + rank (1-based)
   (if no matching BrandConcept -> skip + warn)
5. warnings: moat absent for a finalist; candidates.length < n
6. return { categoryId, builtAt, spawned: candidates.length, selected, rankedBy:"winRate", finalists, warnings }
```

**Tests (pure, fixtures):** ranks win-rate desc (top-3 of 8); excludes benchmark/competitor;
moat joined per finalist, missing moat → undefined + warning; fewer than n → all + warning; tie
deterministic; spawned/selected/rankedBy correct; empty concepts → empty + warning, no throw;
report id with no concept → skipped + warning.

### 3b. `runFoundry(opts, deps?)` — thin orchestrator
```typescript
export interface FoundryDeps {
  runTournament?: typeof import("./tournament.ts").runTournament;  // injectable for tests
}

export async function runFoundry(opts: FoundryOptions, deps: FoundryDeps = {}): Promise<FinalistsArtifact> {
  const run = deps.runTournament ?? runTournament;
  const outDir = opts.outDir ?? "out";
  const t = await run({
    categoryId: opts.categoryId,
    candidates: opts.candidates ?? 8,
    cohortSize: opts.cohortSize ?? 80,
    mode: "deep",
    moat: true,
    seed: opts.seed,
    outDir,
  });
  const artifact = selectFinalists(t, opts.finalists ?? 3);
  await Bun.write(`${outDir}/finalists.json`, JSON.stringify(artifact, null, 2));
  return artifact;
}
```
- Reuses `runTournament` (deep + moat forced on — this pipeline always wants rich signal + moat).
- Returns the artifact (frontend-ready); also writes `finalists.json` beside `tournament.json`.
- `cohortSize` default 80 (production default), overridable.
- **Injectable `deps.runTournament`** (test seam, same pattern as the Council `__tagFn`) so
  `runFoundry` is unit-testable without a live LLM run.

### 3c. CLI `foundry` verb
```bash
bun run foundry --category=lip-balm-india [--candidates=8] [--finalists=3] [--cohort=80] [--seed=0]
```
Prints:
```
Foundry: lip-balm-india — spawned 8, advanced 3 (ranked by win-rate)
  1. MyLipMix          win-rate 11.4% [6-20%]  moat 0.55
  2. AromaBalm         win-rate 11.4% [6-20%]  moat 0.50
  3. Hydration-Plus    win-rate  1.3% [0-7%]   moat n/a
⚠ moat unavailable for: UrbanShield        # only if warnings
Wrote out/finalists.json
Next: build landing pages for these 3 (creative step)
```
Add `foundry` to package.json scripts.

### 3d. Error handling / QUALITY map
| Case | Behavior |
|---|---|
| Council produces <3 concepts | advance all available + warning (never pad) |
| moat off/degraded for a finalist | `moat: undefined` + warning; finalist still advances (win-rate is the cut) |
| report id with no matching BrandConcept | skip + warn |
| empty/no concepts | empty finalists + warning, no throw |
| runTournament throws (no pack, etc.) | propagates (unchanged) |

Doctrine: the cut is **win-rate only** (`rankedBy`); moat shown not blended; `spawned`/`selected`
make the funnel transparent; degraded states are surfaced warnings, never silent.

### 3e. Tests (orchestrator)
- `runFoundry` with an injected fake `runTournament` returning a fixture `TournamentOutput`: asserts
  it requests candidates=8/deep/moat=true/cohort=80; writes `finalists.json` (temp dir); returns the
  artifact with the right top-3. Light — `runTournament` itself is already tested; this verifies
  wiring + artifact, no live LLM.

---

## Out of scope
- Creative-as-smoke-test-PDP (next pipeline piece — builds real landing pages for the finalists).
- Cheap-screen funnel + measurement mode (future optimization, only after the screen is validated).
- Any frontend (the artifact + `runFoundry` return value are the frontend-ready seam; UI is later).
- Calibration of the finalists' win-rates (requires smoke-test data; not part of selection).
