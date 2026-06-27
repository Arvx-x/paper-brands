# Design: Arena Mode Selection (cheap | deep)

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Repo target:** `paper-brands`
**Roadmap position:** Piece #4 — cost-aware routing (reduced scope: explicit mode selection).

---

## Context

The tournament picks an arena via a binary `--deep` flag: single-shot (cheap, noisier) or deep
negotiation (expensive ~5-10× per persona, rich WTP/confidence signal). This is functional but
inexpressive — there is no first-class notion of an arena "mode", and the cost class each arena
already advertises (`BuyerArena.costClass`) is never surfaced to the operator.

This piece replaces the bare boolean with an explicit, validated `--mode=cheap|deep`, surfaces the
chosen mode + its cost class in the report/json, and keeps `--deep` working as an alias. The default
behavior is unchanged (deep).

**Funnel (two-stage cheap→deep routing) is explicitly out of scope** for now — see Out of Scope.
This piece is the small, non-breaking foundation that a future funnel mode would extend.

### Decisions (locked during brainstorming)

- **Two modes now:** `cheap | deep`, selectable via `--mode` (frontend toggle later).
- **Default stays `deep`** (preserves current behavior; non-breaking).
- **No funnel, no auto-mode heuristic.** Operator chooses explicitly.

---

## 1. Architecture

A thin selection layer in the tournament pipeline. Both arenas already implement `BuyerArena`
(`kind`/`costClass`) and are unchanged. The only change is replacing the `opts.deep` boolean
selection with an `ArenaMode` and surfacing it.

```
TournamentOptions.mode: "cheap" | "deep"   (default "deep"; `deep:true` is an alias)
   runTournament
     ├─ "cheap" → new SingleShotArena(pack)        (existing path)
     └─ "deep"  → new DeepNegotiationArena(pack)    (existing path, current default)
   -> attach additive `arenaMode` info to TournamentOutput + formatReport line
```

**Modified files only (no new modules):**
- `src/pipeline/tournament.ts` — add `mode?: ArenaMode` to `TournamentOptions`; resolve mode
  (mode ?? deep-alias ?? "deep"); select arena from mode; add additive `arenaMode?` field to
  `TournamentOutput`; render a `formatReport` line.
- `src/cli.ts` — `--mode=cheap|deep` (validated), keep `--deep` alias; map both into `mode`.

Reuses `SingleShotArena`, `DeepNegotiationArena`. No new dependencies. No new files.

---

## 2. Data model & options

```typescript
export type ArenaMode = "cheap" | "deep";

export interface TournamentOptions {
  categoryId: string;
  candidates: number;
  cohortSize: number;
  outDir?: string;
  mode?: ArenaMode;            // default "deep"
  deep?: boolean;              // DEPRECATED alias: deep:true => mode "deep" when mode unset
  seed?: number;
  runs?: number;
}

// Additive report field on TournamentOutput (like calibration/conceptDiversity)
export interface ArenaModeInfo {
  mode: ArenaMode;
  kind: "single-shot" | "deep-negotiation";
  costClass: "cheap" | "expensive";
}
```

**Resolution rule (back-compat):**
```
resolvedMode = opts.mode ?? "deep"   // default deep; `deep:true` also resolves to "deep"
```
(`opts.deep` only matters at the CLI layer, where the legacy `--deep` flag maps to `mode:"deep"`.
Once `mode` is set, the boolean is irrelevant.)
- `--mode=cheap` → cheap; `--mode=deep` → deep.
- `--deep` (legacy) with `mode` unset → deep (unchanged).
- Neither set → deep (unchanged).
- `kind`/`costClass` are read off the constructed arena instance (`arena.kind`, `arena.costClass`)
  so they never drift from the arena's own declaration.

`arenaMode?: ArenaModeInfo` is attached to `TournamentOutput` additively (always present going
forward, but optional in the type so existing consumers/tests are unaffected).

**Non-goals (YAGNI):** funnel/two-stage routing, auto-mode heuristic, budget accounting, smaller
screen cohorts.

---

## 3. Dispatch, report & CLI

### 3a. `runTournament` dispatch
Replace the existing `const arena = opts.deep ? new DeepNegotiationArena(pack) : new SingleShotArena(pack);`
with mode resolution:
```typescript
const mode: ArenaMode = opts.mode ?? "deep";   // deep:true also resolves to "deep"
const arena = mode === "cheap" ? new SingleShotArena(pack) : new DeepNegotiationArena(pack);
const arenaMode: ArenaModeInfo = { mode, kind: arena.kind, costClass: arena.costClass };
```
Add `arenaMode` to the `out: TournamentOutput` object literal (alongside `calibration`,
`conceptDiversity`). All other tournament behavior (runOnce, replications, scoring, calibration)
is unchanged.

### 3b. `formatReport` line
Near the top of the report (after the `Category:` line is a good spot), add:
```
Arena mode: deep (deep-negotiation, expensive)
# or:
Arena mode: cheap (single-shot, cheap)
```
Driven by `out.arenaMode`; absent → nothing prints (non-breaking).

### 3c. CLI
```bash
bun run tournament --category=lipcare-india --mode=cheap   --candidates=4 --cohort=40
bun run tournament --category=lipcare-india --mode=deep    --candidates=4 --cohort=40
bun run tournament --category=lipcare-india --deep         # legacy alias => deep (unchanged)
bun run tournament --category=lipcare-india                # default deep (unchanged)
```
- Parse `--mode`: if provided, must be `cheap` or `deep`; invalid → error, exit 2.
- Keep parsing `--deep` (legacy). If both given, `--mode` wins (print a one-line warning).
- Apply to BOTH the `tournament` and `winrate` CLI cases (they share the same option shape).

---

## 4. Error handling & tests

### Error handling / QUALITY map
| Case | Behavior |
|---|---|
| invalid `--mode` value | error + usage, exit 2 (never silently fall back) |
| both `--mode` and `--deep` | `--mode` wins; warn so the operator knows the legacy flag was overridden |
| `mode` unset | default "deep" (back-compat) |

Doctrine: the chosen mode + its cost class are surfaced in report + json (the operator always knows
which arena ran and what it cost-class-wise), and an invalid mode fails loud rather than silently
guessing.

### Tests
- **Mode resolution (pure-ish, via runTournament option handling or a small helper):**
  - `mode:"cheap"` selects SingleShotArena (kind "single-shot", costClass "cheap").
  - `mode:"deep"` selects DeepNegotiationArena (kind "deep-negotiation", costClass "expensive").
  - `deep:true`, mode unset → deep.
  - neither set → deep.
  To keep this testable without running a full LLM tournament, factor mode→arena selection into a
  tiny exported pure helper `resolveArena(pack, opts)` returning `{ arena, arenaMode }`, and unit-test
  that helper directly.
- **Report (pure `formatReport`):**
  - `arenaMode` present → renders the "Arena mode: ..." line with correct kind/costClass.
  - absent `arenaMode` → no arena-mode line (non-breaking).
- **CLI smoke (light):** `--mode=cheap` and `--mode=deep` parse; invalid `--mode=foo` exits 2;
  `--deep` still maps to deep.
- Full suite stays green (additive change).

---

## Out of scope
- **Funnel / two-stage cheap→deep routing** (cheap screen → deep finalists with CI-overlap cutoff).
  This piece is the mode-selection foundation a future funnel would build on; not implemented now.
- Auto-mode heuristic (pack-confidence / candidate-count driven selection).
- Per-LLM-call budget accounting or cost ceilings.
- Measuring cheap-vs-deep rank correlation.
- Frontend mode toggle (the CLI flag is the interim surface).
