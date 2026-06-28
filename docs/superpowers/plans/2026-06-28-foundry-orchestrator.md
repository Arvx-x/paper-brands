# Foundry Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `foundry` command that spawns 8 brands, runs the deep arena + moat via the existing tournament, selects the top 3 by win-rate, and emits a frontend-ready `finalists.json` artifact.

**Architecture:** New `src/pipeline/foundry.ts` — pure `selectFinalists(tournamentOutput, n)` (ranks generated concepts by win-rate, joins moat, builds `FinalistsArtifact`) + thin `runFoundry(opts, deps?)` that calls `runTournament` (candidates=8, deep, moat, cohort 80) with an injectable dep for testing, writes `finalists.json`, returns the artifact. CLI `foundry` verb.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`, `Bun.write`). Reuses `runTournament`, `TournamentOutput`, `ConceptScore`, `MoatScore`, `BrandConcept`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-28-foundry-orchestrator-design.md`

---

## File Structure

- Create `src/pipeline/foundry.ts` — `Finalist`, `FinalistsArtifact`, `FoundryOptions`, `FoundryDeps`, `selectFinalists` (pure), `runFoundry` (orchestrator).
- Create `src/pipeline/foundry.test.ts` — pure `selectFinalists` tests + `runFoundry` wiring test (injected fake tournament).
- Modify `src/cli.ts` — `foundry` verb.
- Modify `package.json` — `foundry` script.

Verified facts:
- `TournamentOutput` = `{ categoryId, concepts: BrandConcept[], report: ArenaReport, runStats?, groundingCoverage?, cohortDiversity?, calibration?, conceptDiversity?, arenaMode?, moat? }`.
- `ArenaReport.concepts: ConceptScore[]`; `ConceptScore` = `{ conceptId, name, picks, trials, winRate, winRateCiLow, winRateCiHigh, avgWtpMinor, topObjections }`.
- `MoatReport` = `{ scored, concepts: MoatScore[], degraded }`; `MoatScore` = `{ conceptId, name, axes, overall, warnings }`.
- `TournamentOptions` = `{ categoryId, candidates, cohortSize, outDir?, deep?, mode?, moat?, seed?, runs? }`. `runTournament(opts): Promise<TournamentOutput>` exported from `src/pipeline/tournament.ts`.
- `BrandConcept` has `id, name, ...`. Benchmark ids start `benchmark:`, competitor ids start `competitor:`.
- CLI: `switch(process.argv[2])`, helpers `arg(name,def?)`, `flag(name)`. Tests: `import { test, expect } from "bun:test";`, run `bun test`.

---

## Task 1: Types + pure `selectFinalists`

**Files:**
- Create: `src/pipeline/foundry.ts`
- Test: `src/pipeline/foundry.test.ts`

- [ ] **Step 1: Write failing tests `src/pipeline/foundry.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { selectFinalists } from "./foundry.ts";

function bc(id: string, name: string) {
  return { id, name, positioning: "p", targetCustomer: "t", coreInsight: "c",
    productPromise: "pp", heroSku: "sku", priceMinor: 9900, priceBand: "value", tagline: "tg",
    claims: [], packagingDirection: "x", brandVoice: "x", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [] };
}
function cs(conceptId: string, name: string, winRate: number) {
  return { conceptId, name, picks: 1, trials: 10, winRate, winRateCiLow: Math.max(0, winRate - 0.1),
    winRateCiHigh: winRate + 0.1, avgWtpMinor: 12000, topObjections: [] };
}
function tournament(over: any = {}) {
  return {
    categoryId: "lipcare-india",
    concepts: [bc("A", "Alpha"), bc("B", "Beta"), bc("C", "Gamma"), bc("D", "Delta")],
    report: {
      totalTrials: 40, concepts: [
        cs("A", "Alpha", 0.30), cs("B", "Beta", 0.20), cs("C", "Gamma", 0.10), cs("D", "Delta", 0.05),
        cs("benchmark:bm-x", "X", 0.50), cs("competitor:ARCH-Y", "Y", 0.40),
      ], winner: null,
    },
    moat: { scored: 2, degraded: false, concepts: [
      { conceptId: "A", name: "Alpha", overall: 0.55, warnings: [], axes: [] },
      { conceptId: "B", name: "Beta", overall: 0.40, warnings: [], axes: [] },
    ] },
    ...over,
  } as any;
}

test("ranks generated concepts by win-rate desc, takes top 3, excludes benchmark/competitor", () => {
  const a = selectFinalists(tournament(), 3);
  expect(a.finalists.map((f) => f.concept.id)).toEqual(["A", "B", "C"]);
  expect(a.finalists[0]!.rank).toBe(1);
  expect(a.finalists[0]!.winRate).toBe(0.30);
  expect(a.spawned).toBe(4);
  expect(a.selected).toBe(3);
  expect(a.rankedBy).toBe("winRate");
});

test("joins moat per finalist; missing moat -> undefined + warning", () => {
  const a = selectFinalists(tournament(), 3);
  expect(a.finalists.find((f) => f.concept.id === "A")!.moat!.overall).toBe(0.55);
  expect(a.finalists.find((f) => f.concept.id === "C")!.moat).toBeUndefined();
  expect(a.warnings.some((w) => w.includes("moat") && w.includes("Gamma"))).toBe(true);
});

test("carries winRate CI + avgWtp", () => {
  const a = selectFinalists(tournament(), 3);
  const f = a.finalists[0]!;
  expect(f.winRateCiLow).toBeCloseTo(0.20, 6);
  expect(f.winRateCiHigh).toBeCloseTo(0.40, 6);
  expect(f.avgWtpMinor).toBe(12000);
});

test("fewer concepts than n -> returns all + warning, no crash", () => {
  const t = tournament({ concepts: [bc("A", "Alpha")], report: { totalTrials: 10, concepts: [cs("A", "Alpha", 0.3)], winner: null }, moat: undefined });
  const a = selectFinalists(t, 3);
  expect(a.finalists).toHaveLength(1);
  expect(a.warnings.some((w) => w.toLowerCase().includes("available") || w.toLowerCase().includes("only"))).toBe(true);
});

test("deterministic tie-break by conceptId on equal win-rates", () => {
  const t = tournament({
    concepts: [bc("B", "Beta"), bc("A", "Alpha")],
    report: { totalTrials: 20, concepts: [cs("B", "Beta", 0.2), cs("A", "Alpha", 0.2)], winner: null },
    moat: undefined,
  });
  const a = selectFinalists(t, 2);
  expect(a.finalists.map((f) => f.concept.id)).toEqual(["A", "B"]); // A before B on tie
});

test("report id with no matching BrandConcept -> skipped + warning", () => {
  const t = tournament({
    concepts: [bc("A", "Alpha")],
    report: { totalTrials: 20, concepts: [cs("A", "Alpha", 0.3), cs("GHOST", "Ghost", 0.9)], winner: null },
    moat: undefined,
  });
  const a = selectFinalists(t, 3);
  expect(a.finalists.map((f) => f.concept.id)).toEqual(["A"]);
  expect(a.warnings.some((w) => w.includes("GHOST"))).toBe(true);
});

test("empty concepts -> empty finalists + warning, no throw", () => {
  const t = tournament({ concepts: [], report: { totalTrials: 0, concepts: [], winner: null }, moat: undefined });
  const a = selectFinalists(t, 3);
  expect(a.finalists).toHaveLength(0);
  expect(a.warnings.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/foundry.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement types + `selectFinalists` in `src/pipeline/foundry.ts`**

```typescript
import type { BrandConcept } from "../brand/types.ts";
import type { MoatScore } from "../moat/types.ts";
import type { TournamentOutput } from "./tournament.ts";

export interface Finalist {
  rank: number;
  concept: BrandConcept;
  winRate: number;
  winRateCiLow: number;
  winRateCiHigh: number;
  avgWtpMinor: number;
  moat?: MoatScore;
}

export interface FinalistsArtifact {
  categoryId: string;
  builtAt: string;
  spawned: number;
  selected: number;
  rankedBy: "winRate";
  finalists: Finalist[];
  warnings: string[];
}

function isCandidate(conceptId: string): boolean {
  return !conceptId.startsWith("benchmark:") && !conceptId.startsWith("competitor:");
}

/** Pure: rank generated concepts by win-rate, take top n, join moat. */
export function selectFinalists(t: TournamentOutput, n: number): FinalistsArtifact {
  const warnings: string[] = [];
  const conceptById = new Map(t.concepts.map((c) => [c.id, c]));
  const moatById = new Map((t.moat?.concepts ?? []).map((m) => [m.conceptId, m]));

  const ranked = (t.report.concepts ?? [])
    .filter((c) => isCandidate(c.conceptId))
    .slice()
    .sort((a, b) => b.winRate - a.winRate || a.conceptId.localeCompare(b.conceptId));

  const spawned = ranked.length;
  const finalists: Finalist[] = [];
  for (const score of ranked) {
    if (finalists.length >= n) break;
    const concept = conceptById.get(score.conceptId);
    if (!concept) {
      warnings.push(`report concept '${score.conceptId}' has no matching BrandConcept (skipped)`);
      continue;
    }
    const moat = moatById.get(score.conceptId);
    if (!moat) warnings.push(`moat unavailable for '${score.name}' (${score.conceptId})`);
    finalists.push({
      rank: finalists.length + 1,
      concept,
      winRate: score.winRate,
      winRateCiLow: score.winRateCiLow,
      winRateCiHigh: score.winRateCiHigh,
      avgWtpMinor: score.avgWtpMinor,
      moat,
    });
  }

  if (finalists.length < n) {
    warnings.push(`only ${finalists.length} concept(s) available; requested ${n}`);
  }

  return {
    categoryId: t.categoryId,
    builtAt: new Date().toISOString(),
    spawned,
    selected: finalists.length,
    rankedBy: "winRate",
    finalists,
    warnings,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/foundry.test.ts`
Expected: PASS (7).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/pipeline/foundry.ts src/pipeline/foundry.test.ts
git commit -m "feat(foundry): pure selectFinalists (top-3 by win-rate, moat joined)"
```

---

## Task 2: `runFoundry` orchestrator (injectable tournament dep)

**Files:**
- Modify: `src/pipeline/foundry.ts`
- Modify: `src/pipeline/foundry.test.ts`

- [ ] **Step 1: Add failing orchestrator tests (append to `src/pipeline/foundry.test.ts`)**

NOTE: TypeScript requires imports at the top of the file. Move these four `import` lines up to the existing top-of-file import block (merge `runFoundry` into the existing `./foundry.ts` import line: `import { selectFinalists, runFoundry } from "./foundry.ts";`). Append only the `test(...)` blocks below to the bottom of the file. Do NOT leave mid-file imports.

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFoundry } from "./foundry.ts";

test("runFoundry calls tournament with candidates=8/deep/moat/cohort=80 and writes finalists.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foundry-"));
  let captured: any = null;
  const fakeRun = async (o: any) => { captured = o; return tournament(); };
  const artifact = await runFoundry({ categoryId: "lipcare-india", outDir: dir }, { runTournament: fakeRun as any });

  expect(captured.candidates).toBe(8);
  expect(captured.mode).toBe("deep");
  expect(captured.moat).toBe(true);
  expect(captured.cohortSize).toBe(80);
  expect(artifact.finalists.map((f) => f.concept.id)).toEqual(["A", "B", "C"]);

  const written = await Bun.file(join(dir, "finalists.json")).json();
  expect(written.selected).toBe(3);
  await rm(dir, { recursive: true, force: true });
});

test("runFoundry respects candidates/finalists/cohort overrides", async () => {
  const dir = await mkdtemp(join(tmpdir(), "foundry-"));
  let captured: any = null;
  const fakeRun = async (o: any) => { captured = o; return tournament(); };
  const artifact = await runFoundry(
    { categoryId: "c", candidates: 6, finalists: 2, cohortSize: 40, outDir: dir },
    { runTournament: fakeRun as any },
  );
  expect(captured.candidates).toBe(6);
  expect(captured.cohortSize).toBe(40);
  expect(artifact.finalists).toHaveLength(2);
  await rm(dir, { recursive: true, force: true });
});
```

(The `tournament()` helper from Task 1's test file is reused — it's in the same file.)

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/foundry.test.ts`
Expected: FAIL (`runFoundry` not exported).

- [ ] **Step 3: Add `FoundryOptions`, `FoundryDeps`, `runFoundry` to `src/pipeline/foundry.ts`**

Add the import for `runTournament` at the top (alongside the existing type import):
```typescript
import { runTournament } from "./tournament.ts";
```
(The existing `import type { TournamentOutput } from "./tournament.ts";` can stay as a separate type-only import, or be merged — either is fine.)

Add at the end of the file:
```typescript
export interface FoundryOptions {
  categoryId: string;
  candidates?: number;
  finalists?: number;
  cohortSize?: number;
  seed?: number;
  outDir?: string;
}

export interface FoundryDeps {
  runTournament?: typeof runTournament;
}

/** Spawn N brands, run deep arena + moat, select top finalists, write finalists.json. */
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

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/foundry.test.ts`
Expected: PASS (9 total).

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
bun test
git add src/pipeline/foundry.ts src/pipeline/foundry.test.ts
git commit -m "feat(foundry): runFoundry orchestrator (deep+moat, injectable tournament dep)"
```

---

## Task 3: CLI `foundry` verb

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json`

- [ ] **Step 1: Add `foundry` script to package.json "scripts"**

```json
    "foundry": "bun run src/cli.ts foundry",
```

- [ ] **Step 2: Add import near the other pipeline imports in `src/cli.ts`**

```typescript
import { runFoundry } from "./pipeline/foundry.ts";
```

- [ ] **Step 3: Add the `foundry` case inside `switch (cmd)`** (place near the `tournament` case):

```typescript
  case "foundry": {
    const artifact = await runFoundry({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "8")),
      finalists: Number(arg("finalists", "3")),
      cohortSize: Number(arg("cohort", "80")),
      seed: Number(arg("seed", "0")),
      outDir: arg("out", "out"),
    });
    console.log(
      `\nFoundry: ${artifact.categoryId} — spawned ${artifact.spawned}, advanced ${artifact.selected} (ranked by ${artifact.rankedBy})`,
    );
    for (const f of artifact.finalists) {
      const moat = f.moat ? `moat ${f.moat.overall.toFixed(2)}` : "moat n/a";
      console.log(
        `  ${f.rank}. ${f.concept.name.padEnd(20)} win-rate ${(f.winRate * 100).toFixed(1)}% ` +
          `[${(f.winRateCiLow * 100).toFixed(0)}-${(f.winRateCiHigh * 100).toFixed(0)}%]  ${moat}`,
      );
    }
    for (const w of artifact.warnings) console.log(`\u26a0 ${w}`);
    console.log(`Wrote ${arg("out", "out")}/finalists.json`);
    console.log(`Next: build landing pages for these ${artifact.selected} (creative step)`);
    break;
  }
```

- [ ] **Step 4: Add `foundry` to the usage string in the `default:` case**

Find the usage block (the `bun run tournament ...` line) and add after it:
```typescript
        `  bun run foundry     --category=lipcare --candidates=8 --finalists=3 --cohort=80\n` +
```

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
bun test
git add src/cli.ts package.json
git commit -m "feat(cli): foundry verb (spawn-8 -> deep -> top-3 -> finalists.json)"
```

---

## Task 4: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + 9 new foundry tests).

- [ ] **Step 2: Confirm clean tree**

Run: `git status --short`
Expected: clean.

- [ ] **Step 3: Review diff vs spec**

Run: `git log --oneline foundry-orchestrator ^main`
Confirm tasks 1-3 each produced a commit and spec sections (types, selectFinalists, runFoundry, CLI) are represented.

- [ ] **Step 4: Hand back to user for review before merge. Do NOT ff-merge to main or push without explicit user go-ahead.**
```
