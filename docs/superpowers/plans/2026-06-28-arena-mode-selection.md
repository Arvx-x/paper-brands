# Arena Mode Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary `--deep` arena toggle with an explicit, validated `--mode=cheap|deep` (default deep, `--deep` kept as alias), surfacing the chosen mode + cost class in the tournament report and JSON.

**Architecture:** A tiny exported pure helper `resolveArena(pack, opts)` picks the arena from an `ArenaMode` and returns `{ arena, arenaMode }`. `runTournament` uses it instead of the inline `opts.deep ?` ternary, attaches an additive `arenaMode` field, and `formatReport` renders one line. CLI parses/validates `--mode`. No new modules, non-breaking.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`). Reuses `SingleShotArena`, `DeepNegotiationArena`.

**Spec:** `docs/superpowers/specs/2026-06-28-cost-aware-routing-design.md`

---

## File Structure

- Modify `src/pipeline/tournament.ts` — add `ArenaMode`, `ArenaModeInfo`, `resolveArena()`; add `mode?` to `TournamentOptions`; add `arenaMode?` to `TournamentOutput`; use `resolveArena` in `runTournament`; render a `formatReport` line.
- Create `src/pipeline/arena-mode.test.ts` — pure tests for `resolveArena` + the report line.
- Modify `src/cli.ts` — parse/validate `--mode` for the `tournament` and `winrate` cases; keep `--deep` alias.

Verified facts:
- `src/pipeline/tournament.ts`: `TournamentOptions` has `categoryId, candidates, cohortSize, outDir?, deep?, seed?, runs?` (and now `mode?`). `runTournament` builds the arena at `const arena = opts.deep ? new DeepNegotiationArena(pack) : new SingleShotArena(pack);`. The `out: TournamentOutput` literal includes `calibration, conceptDiversity`. `formatReport(out)` starts with `Category:` line then `Candidate share vs field:`.
- `BuyerArena` (src/arena/types.ts) has `readonly kind: "single-shot" | "deep-negotiation"` and `readonly costClass: "cheap" | "expensive"`. `SingleShotArena` = kind "single-shot"/cost "cheap"; `DeepNegotiationArena` = kind "deep-negotiation"/cost "expensive".
- CLI (`src/cli.ts`): `tournament` and `winrate` cases build options with `deep: arg("deep","")==="true"||arg("deep","")==="deep"`. Helpers `arg(name,def?)`, `flag(name)` exist. Dispatch is `switch(process.argv[2])`.
- Tests: `import { test, expect } from "bun:test";`, run `bun test`.

---

## Task 1: `ArenaMode` types + `resolveArena` helper

**Files:**
- Modify: `src/pipeline/tournament.ts`
- Test: `src/pipeline/arena-mode.test.ts`

- [ ] **Step 1: Write failing tests — create `src/pipeline/arena-mode.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { resolveArena, type TournamentOptions } from "./tournament.ts";

const pack: any = { id: "p", name: "P", priceBands: [], buyerSegments: [], competitorArchetypes: [] };

function opts(over: Partial<TournamentOptions> = {}): TournamentOptions {
  return { categoryId: "c", candidates: 4, cohortSize: 40, ...over };
}

test("mode=cheap -> SingleShotArena (single-shot, cheap)", () => {
  const { arena, arenaMode } = resolveArena(pack, opts({ mode: "cheap" }));
  expect(arena.kind).toBe("single-shot");
  expect(arena.costClass).toBe("cheap");
  expect(arenaMode).toEqual({ mode: "cheap", kind: "single-shot", costClass: "cheap" });
});

test("mode=deep -> DeepNegotiationArena (deep-negotiation, expensive)", () => {
  const { arena, arenaMode } = resolveArena(pack, opts({ mode: "deep" }));
  expect(arena.kind).toBe("deep-negotiation");
  expect(arena.costClass).toBe("expensive");
  expect(arenaMode).toEqual({ mode: "deep", kind: "deep-negotiation", costClass: "expensive" });
});

test("deep:true with mode unset -> deep", () => {
  const { arenaMode } = resolveArena(pack, opts({ deep: true }));
  expect(arenaMode.mode).toBe("deep");
});

test("neither set -> default deep", () => {
  const { arenaMode } = resolveArena(pack, opts());
  expect(arenaMode.mode).toBe("deep");
});

test("mode wins over deep when both set", () => {
  const { arenaMode } = resolveArena(pack, opts({ mode: "cheap", deep: true }));
  expect(arenaMode.mode).toBe("cheap");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/arena-mode.test.ts`
Expected: FAIL (`resolveArena` / `ArenaMode` not exported).

- [ ] **Step 3: Add types + helper to `src/pipeline/tournament.ts`**

Near the top (after existing imports; `SingleShotArena` and `DeepNegotiationArena` are already imported):

```typescript
export type ArenaMode = "cheap" | "deep";

export interface ArenaModeInfo {
  mode: ArenaMode;
  kind: "single-shot" | "deep-negotiation";
  costClass: "cheap" | "expensive";
}
```

Add `mode?: ArenaMode;` to the `TournamentOptions` interface (after `deep?: boolean;`).

Add the helper (place it just above `runTournament`):

```typescript
import type { BuyerArena } from "../arena/types.ts";
import type { CategoryPack } from "../categories/types.ts";

/** Resolve the arena from the requested mode. Default "deep"; `deep:true` is a legacy alias. */
export function resolveArena(
  pack: CategoryPack,
  opts: Pick<TournamentOptions, "mode" | "deep">,
): { arena: BuyerArena; arenaMode: ArenaModeInfo } {
  const mode: ArenaMode = opts.mode ?? "deep";
  const arena: BuyerArena = mode === "cheap" ? new SingleShotArena(pack) : new DeepNegotiationArena(pack);
  return { arena, arenaMode: { mode, kind: arena.kind, costClass: arena.costClass } };
}
```

(If `BuyerArena`/`CategoryPack` are already imported in the file, do not duplicate the imports — reuse them.)

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/arena-mode.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/pipeline/tournament.ts src/pipeline/arena-mode.test.ts
git commit -m "feat(pipeline): ArenaMode + resolveArena helper (cheap|deep)"
```

---

## Task 2: Use `resolveArena` in `runTournament` + attach `arenaMode`

**Files:**
- Modify: `src/pipeline/tournament.ts`

- [ ] **Step 1: Replace the inline arena selection in `runTournament`.**

Find:
```typescript
  const arena = opts.deep ? new DeepNegotiationArena(pack) : new SingleShotArena(pack);
```
Replace with:
```typescript
  const { arena, arenaMode } = resolveArena(pack, opts);
```

- [ ] **Step 2: Add `arenaMode` to the `TournamentOutput` interface.**

In the `TournamentOutput` interface, after `conceptDiversity?: DiversityReport;` add:
```typescript
  arenaMode?: ArenaModeInfo;
```

- [ ] **Step 3: Add `arenaMode` to the `out` object literal.**

Find the line constructing `const out: TournamentOutput = { categoryId: opts.categoryId, concepts, report, runStats, groundingCoverage, cohortDiversity, calibration, conceptDiversity };`
and append `arenaMode`:
```typescript
  const out: TournamentOutput = { categoryId: opts.categoryId, concepts, report, runStats, groundingCoverage, cohortDiversity, calibration, conceptDiversity, arenaMode };
```

- [ ] **Step 4: Typecheck + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; full suite green (the existing tournament tests still pass; arenaMode is additive).

- [ ] **Step 5: Commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
git add src/pipeline/tournament.ts
git commit -m "feat(pipeline): select arena via mode + attach arenaMode to output"
```

---

## Task 3: `formatReport` arena-mode line

**Files:**
- Modify: `src/pipeline/tournament.ts`
- Modify: `src/pipeline/arena-mode.test.ts`

- [ ] **Step 1: Add failing report tests (append to `src/pipeline/arena-mode.test.ts`)**

```typescript
import { formatReport, type TournamentOutput } from "./tournament.ts";

function baseOut(arenaMode?: TournamentOutput["arenaMode"]): TournamentOutput {
  return {
    categoryId: "lipcare-india",
    concepts: [],
    report: { totalTrials: 40, concepts: [], candidateShareVsField: 0.5, abstentionRate: 0, errorRate: 0, degraded: false, winner: null } as any,
    arenaMode,
  };
}

test("formatReport renders the arena-mode line for deep", () => {
  const txt = formatReport(baseOut({ mode: "deep", kind: "deep-negotiation", costClass: "expensive" }));
  expect(txt).toContain("Arena mode: deep (deep-negotiation, expensive)");
});

test("formatReport renders the arena-mode line for cheap", () => {
  const txt = formatReport(baseOut({ mode: "cheap", kind: "single-shot", costClass: "cheap" }));
  expect(txt).toContain("Arena mode: cheap (single-shot, cheap)");
});

test("formatReport omits the arena-mode line when absent (non-breaking)", () => {
  const txt = formatReport(baseOut(undefined));
  expect(txt).not.toContain("Arena mode:");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/arena-mode.test.ts`
Expected: FAIL (line not rendered).

- [ ] **Step 3: Render the line in `formatReport`.**

In `formatReport`, immediately after the existing line:
```typescript
  lines.push(`\nCategory: ${out.categoryId}  |  trials: ${report.totalTrials}`);
```
add:
```typescript
  if (out.arenaMode) {
    lines.push(`Arena mode: ${out.arenaMode.mode} (${out.arenaMode.kind}, ${out.arenaMode.costClass})`);
  }
```

- [ ] **Step 4: Run report tests + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/arena-mode.test.ts`
Expected: PASS (8 total in file).
Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test`
Expected: full suite green.

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/pipeline/tournament.ts src/pipeline/arena-mode.test.ts
git commit -m "feat(pipeline): render arena-mode line in tournament report"
```

---

## Task 4: CLI `--mode` parsing (tournament + winrate)

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Read `src/cli.ts` to confirm the `tournament` and `winrate` cases and the `arg`/`flag` helpers. Both cases currently set `deep: arg("deep","")==="true"||arg("deep","")==="deep"`.**

- [ ] **Step 2: Add a mode-parsing helper near the other CLI helpers (after `arg`/`flag`/`slugify`):**

```typescript
function parseArenaMode(): "cheap" | "deep" | undefined {
  const raw = arg("mode");
  if (raw === undefined) return undefined;
  if (raw !== "cheap" && raw !== "deep") {
    console.error(`invalid --mode='${raw}'; expected cheap|deep`);
    process.exit(2);
  }
  const legacyDeep = arg("deep", "") === "true" || arg("deep", "") === "deep";
  if (legacyDeep) console.error(`note: --mode overrides legacy --deep`);
  return raw;
}
```

- [ ] **Step 3: Wire it into BOTH the `tournament` and `winrate` cases.**

In each case's `runTournament({ ... })` options object, replace:
```typescript
      deep: arg("deep", "") === "true" || arg("deep", "") === "deep",
```
with:
```typescript
      mode: parseArenaMode(),
      deep: arg("deep", "") === "true" || arg("deep", "") === "deep",
```
(Keep the `deep` line for back-compat; `resolveArena` uses `mode` first, so the legacy flag only takes effect when `--mode` is absent.)

- [ ] **Step 4: Manual smoke test**

Run (no LLM needed to verify arg validation — bad mode must exit 2 before any tournament work):
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run src/cli.ts tournament --category=__nope --mode=banana ; echo "exit=$?"
```
Expected: prints `invalid --mode='banana'; expected cheap|deep` and `exit=2`.

(A full `--mode=cheap` run requires a pack + LLM; not required for this task. The validation path is the testable part.)

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
bun test
git add src/cli.ts
git commit -m "feat(cli): --mode=cheap|deep for tournament + winrate (keeps --deep alias)"
```

---

## Task 5: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + new arena-mode tests).

- [ ] **Step 2: Confirm clean tree**

Run: `git status --short`
Expected: clean.

- [ ] **Step 3: Review diff vs spec**

Run: `git log --oneline cost-aware-routing ^main`
Confirm tasks 1-4 each produced a commit and the spec sections (mode type, resolveArena, dispatch, report line, CLI) are represented.

- [ ] **Step 4: Hand back to user for review before merge. Do NOT ff-merge to main or push without explicit user go-ahead.**
