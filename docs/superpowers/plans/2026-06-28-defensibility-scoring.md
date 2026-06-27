# Defensibility / Moat Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in (`--moat`) per-concept defensibility score: an LLM rubric rates each generated concept on 4 axes (0..1 + rationale), rolled up to an equal-weight overall, reported side-by-side with win-rate and never blended.

**Architecture:** New `src/moat/` module — pure `rollUp` core + impure batched fail-clean `scoreMoat` (constructs its own `LLMClient`; tests inject a fake). `runTournament` calls it when `opts.moat` is set and attaches an additive `moat?: MoatReport`; `formatReport` renders a per-concept block. Mirrors calibration/diversity.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`). Reuses `BrandConcept`, `pack.competitorArchetypes`, `LLMClient`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-28-defensibility-scoring-design.md`

---

## File Structure

- Create `src/moat/types.ts` — `MoatAxisName`, `MOAT_AXES`, `MoatAxis`, `MoatScore`, `MoatReport`.
- Create `src/moat/rollup.ts` — `rollUp(axes)` (pure).
- Create `src/moat/rubric.ts` — `scoreMoat(concepts, pack, llm)` (impure, batched, fail-clean).
- Create `src/moat/*.test.ts`.
- Modify `src/pipeline/tournament.ts` — `moat?: boolean` option; call `scoreMoat`; additive `moat?: MoatReport`; `formatReport` block.
- Modify `src/cli.ts` — `--moat` flag on `tournament` case.

Verified facts:
- `BrandConcept` fields: id, name, positioning, targetCustomer, coreInsight, productPromise, heroSku, priceMinor, priceBand, tagline, claims[], packagingDirection, brandVoice, landingHeadline, topAdAngles[], objections[], launchRisks[].
- `CompetitorArchetype`: codeName, description, pricePositioning, claims[], strengths[], weaknesses[], evidence[], realExamples[].
- `LLMClient` imported from `../llm/client.ts`; has `completeJson({ messages, temperature })`. Tests fake via `{ completeJson: async () => ({...}) } as any`.
- `src/pipeline/tournament.ts`: `out` literal = `{ categoryId, concepts, report, runStats, groundingCoverage, cohortDiversity, calibration, conceptDiversity, arenaMode }`. `formatReport(out)` builds a `lines[]`. `TournamentOptions` has `mode?, deep?, seed?, runs?` etc.
- CLI `tournament` case builds options with `mode: parseArenaMode(), deep: ..., seed: ..., runs: ...`; helpers `arg`, `flag` exist.
- Tests: `import { test, expect } from "bun:test";`, run `bun test`.

---

## Task 1: Types + pure `rollUp`

**Files:**
- Create: `src/moat/types.ts`
- Create: `src/moat/rollup.ts`
- Test: `src/moat/rollup.test.ts`

- [ ] **Step 1: Write the types file `src/moat/types.ts`**

```typescript
export type MoatAxisName =
  | "copyability"
  | "proprietaryInsight"
  | "distributionWedge"
  | "brandTrustDurability";

export const MOAT_AXES: MoatAxisName[] = [
  "copyability",
  "proprietaryInsight",
  "distributionWedge",
  "brandTrustDurability",
];

export interface MoatAxis {
  name: MoatAxisName;
  score: number;       // 0..1
  rationale: string;
}

export interface MoatScore {
  conceptId: string;
  name: string;
  axes: MoatAxis[];
  overall: number;     // 0..1, equal-weight mean
  warnings: string[];
}

export interface MoatReport {
  scored: number;
  concepts: MoatScore[];
  degraded: boolean;
}
```

- [ ] **Step 2: Write failing test `src/moat/rollup.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { rollUp } from "./rollup.ts";
import type { MoatAxis } from "./types.ts";

function axis(name: any, score: number): MoatAxis {
  return { name, score, rationale: "r" };
}

test("equal-weight mean of axis scores", () => {
  const axes = [axis("copyability", 0.2), axis("proprietaryInsight", 0.4), axis("distributionWedge", 0.6), axis("brandTrustDurability", 0.8)];
  expect(rollUp(axes)).toBeCloseTo(0.5, 6);
});

test("empty axes -> 0", () => {
  expect(rollUp([])).toBe(0);
});

test("single axis -> itself", () => {
  expect(rollUp([axis("copyability", 0.37)])).toBeCloseTo(0.37, 6);
});

test("clamps result into [0,1]", () => {
  expect(rollUp([axis("copyability", 5), axis("proprietaryInsight", 5)])).toBe(1);
  expect(rollUp([axis("copyability", -5), axis("proprietaryInsight", -5)])).toBe(0);
});
```

- [ ] **Step 3: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/moat/rollup.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement `src/moat/rollup.ts`**

```typescript
import type { MoatAxis } from "./types.ts";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Equal-weight mean of axis scores, clamped to [0,1]. Empty -> 0. */
export function rollUp(axes: MoatAxis[]): number {
  if (axes.length === 0) return 0;
  const sum = axes.reduce((a, x) => a + x.score, 0);
  return clamp01(sum / axes.length);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/moat/rollup.test.ts`
Expected: PASS (4).

- [ ] **Step 6: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/moat/types.ts src/moat/rollup.ts src/moat/rollup.test.ts
git commit -m "feat(moat): types + pure equal-weight rollUp"
```

---

## Task 2: `scoreMoat` (impure, batched, fail-clean)

**Files:**
- Create: `src/moat/rubric.ts`
- Test: `src/moat/rubric.test.ts`

- [ ] **Step 1: Write failing tests `src/moat/rubric.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { scoreMoat } from "./rubric.ts";

function concept(id: string, name: string) {
  return { id, name, positioning: "p", targetCustomer: "t", coreInsight: "c",
    productPromise: "pp", heroSku: "sku", priceMinor: 59900, priceBand: "premium",
    tagline: "tag", claims: ["a"], packagingDirection: "x", brandVoice: "x",
    landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [] };
}
const pack: any = { competitorArchetypes: [{ codeName: "ARCH-A", description: "d", pricePositioning: "pp", claims: [], strengths: ["s"], weaknesses: ["w"], evidence: [], realExamples: [] }] };

function fullAxes(c = 0.3, i = 0.5, w = 0.6, t = 0.4) {
  return [
    { name: "copyability", score: c, rationale: "rc" },
    { name: "proprietaryInsight", score: i, rationale: "ri" },
    { name: "distributionWedge", score: w, rationale: "rw" },
    { name: "brandTrustDurability", score: t, rationale: "rt" },
  ];
}

test("well-formed batch -> 4 axes per concept + correct overall, no warnings", async () => {
  const llm = { completeJson: async () => ({ scores: [
    { conceptId: "A", axes: fullAxes(0.2, 0.4, 0.6, 0.8) },
    { conceptId: "B", axes: fullAxes(0.1, 0.1, 0.1, 0.1) },
  ] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha"), concept("B", "Beta")], pack, llm);
  expect(out).toHaveLength(2);
  const a = out.find((m) => m.conceptId === "A")!;
  expect(a.axes.map((x) => x.name)).toEqual(["copyability", "proprietaryInsight", "distributionWedge", "brandTrustDurability"]);
  expect(a.overall).toBeCloseTo(0.5, 6);
  expect(a.warnings).toHaveLength(0);
});

test("orientation preserved: a low copyability stays low (no sign flip)", async () => {
  const llm = { completeJson: async () => ({ scores: [{ conceptId: "A", axes: fullAxes(0.1, 0.5, 0.5, 0.5) }] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha")], pack, llm);
  expect(out[0]!.axes.find((x) => x.name === "copyability")!.score).toBeCloseTo(0.1, 6);
});

test("missing axis -> neutral 0.5 default + warning", async () => {
  const llm = { completeJson: async () => ({ scores: [{ conceptId: "A", axes: [
    { name: "copyability", score: 0.2, rationale: "rc" },
    { name: "proprietaryInsight", score: 0.4, rationale: "ri" },
    // distributionWedge + brandTrustDurability missing
  ] }] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha")], pack, llm);
  const wedge = out[0]!.axes.find((x) => x.name === "distributionWedge")!;
  expect(wedge.score).toBe(0.5);
  expect(out[0]!.warnings.length).toBeGreaterThan(0);
});

test("concept missing from output -> all-neutral + warning", async () => {
  const llm = { completeJson: async () => ({ scores: [{ conceptId: "A", axes: fullAxes() }] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha"), concept("B", "Beta")], pack, llm);
  const b = out.find((m) => m.conceptId === "B")!;
  expect(b.axes.every((x) => x.score === 0.5)).toBe(true);
  expect(b.warnings.length).toBeGreaterThan(0);
});

test("LLM throws -> all concepts neutral, no throw", async () => {
  const llm = { completeJson: async () => { throw new Error("down"); } } as any;
  const out = await scoreMoat([concept("A", "Alpha"), concept("B", "Beta")], pack, llm);
  expect(out).toHaveLength(2);
  expect(out.every((m) => m.axes.every((x) => x.score === 0.5))).toBe(true);
  expect(out.every((m) => m.warnings.length > 0)).toBe(true);
});

test("out-of-range / non-numeric axis score -> clamped/defaulted", async () => {
  const llm = { completeJson: async () => ({ scores: [{ conceptId: "A", axes: [
    { name: "copyability", score: 5, rationale: "rc" },
    { name: "proprietaryInsight", score: -2, rationale: "ri" },
    { name: "distributionWedge", score: "abc", rationale: "rw" },
    { name: "brandTrustDurability", score: 0.4, rationale: "rt" },
  ] }] }) } as any;
  const out = await scoreMoat([concept("A", "Alpha")], pack, llm);
  const ax = out[0]!.axes;
  expect(ax.find((x) => x.name === "copyability")!.score).toBe(1);
  expect(ax.find((x) => x.name === "proprietaryInsight")!.score).toBe(0);
  expect(ax.find((x) => x.name === "distributionWedge")!.score).toBe(0.5); // non-numeric -> default
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/moat/rubric.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/moat/rubric.ts`**

```typescript
import type { LLMClient } from "../llm/client.ts";
import type { BrandConcept } from "../brand/types.ts";
import type { CategoryPack } from "../categories/types.ts";
import type { MoatAxis, MoatAxisName, MoatScore } from "./types.ts";
import { MOAT_AXES } from "./types.ts";
import { rollUp } from "./rollup.ts";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function neutralAxis(name: MoatAxisName, note: string): MoatAxis {
  return { name, score: 0.5, rationale: note };
}

function assemble(
  conceptId: string,
  name: string,
  rawAxes: Array<{ name?: string; score?: unknown; rationale?: unknown }> | undefined,
): MoatScore {
  const warnings: string[] = [];
  const byName = new Map<string, { score?: unknown; rationale?: unknown }>();
  for (const a of rawAxes ?? []) {
    if (typeof a?.name === "string") byName.set(a.name, a);
  }
  const axes: MoatAxis[] = MOAT_AXES.map((axisName) => {
    const hit = byName.get(axisName);
    if (!hit) {
      warnings.push(`axis ${axisName} missing from LLM output (defaulted neutral)`);
      return neutralAxis(axisName, "(not scored)");
    }
    const n = typeof hit.score === "number" ? hit.score : Number.NaN;
    if (!Number.isFinite(n)) {
      warnings.push(`axis ${axisName} non-numeric (defaulted neutral)`);
      return neutralAxis(axisName, typeof hit.rationale === "string" ? hit.rationale : "(not scored)");
    }
    return {
      name: axisName,
      score: clamp01(n),
      rationale: typeof hit.rationale === "string" && hit.rationale.trim() ? hit.rationale : "(no rationale)",
    };
  });
  return { conceptId, name, axes, overall: rollUp(axes), warnings };
}

/** Score each generated concept on the 4 moat axes via ONE batched LLM call. Fail-clean. */
export async function scoreMoat(
  concepts: BrandConcept[],
  pack: CategoryPack,
  llm: LLMClient,
): Promise<MoatScore[]> {
  const competitors = (pack.competitorArchetypes ?? []).map((a) => ({
    codeName: a.codeName, description: a.description, strengths: a.strengths, weaknesses: a.weaknesses,
  }));

  let raw: { scores?: Array<{ conceptId?: string; axes?: any[] }> } = {};
  try {
    raw = await llm.completeJson({
      messages: [
        {
          role: "user",
          content:
            `Rate each brand concept's DEFENSIBILITY (moat) on four axes, each 0..1 where HIGHER = MORE defensible.\n` +
            `Axes:\n` +
            `- copyability: RESISTANCE to being copied (1 = very hard for an incumbent to replicate, 0 = trivial commodity).\n` +
            `- proprietaryInsight: how non-obvious/unique the core insight is (1 = unique, 0 = generic).\n` +
            `- distributionWedge: channel or positioning edge vs competitors (1 = strong wedge, 0 = none).\n` +
            `- brandTrustDurability: ability to build defensible affinity/trust (1 = durable, 0 = forgettable).\n\n` +
            `IMPORTANT: Most generic D2C concepts are EASY to copy — reserve high copyability-resistance for genuinely hard-to-replicate ideas. Do NOT give every concept high scores.\n` +
            `Each axis needs a ONE-SENTENCE rationale grounded in the concept and the competitors below.\n\n` +
            `Competitors (disguised):\n${JSON.stringify(competitors, null, 2)}\n\n` +
            `Concepts:\n` +
            concepts.map((c) => JSON.stringify({ id: c.id, name: c.name, positioning: c.positioning, coreInsight: c.coreInsight, productPromise: c.productPromise, claims: c.claims, priceBand: c.priceBand, targetCustomer: c.targetCustomer })).join("\n") +
            `\n\nReturn ONLY JSON: { "scores": [ { "conceptId", "axes": [ { "name", "score", "rationale" } ] } ] }`,
        },
      ],
      temperature: 0,
    });
  } catch {
    raw = {};
  }

  const byId = new Map<string, any[]>();
  for (const s of raw?.scores ?? []) {
    if (typeof s?.conceptId === "string") byId.set(s.conceptId, Array.isArray(s.axes) ? s.axes : []);
  }

  return concepts.map((c) => {
    const rawAxes = byId.get(c.id);
    if (!rawAxes) {
      const ms = assemble(c.id, c.name, []);
      ms.warnings.push("concept missing from LLM output (all axes neutral)");
      return ms;
    }
    return assemble(c.id, c.name, rawAxes);
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/moat/rubric.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/moat/rubric.ts src/moat/rubric.test.ts
git commit -m "feat(moat): batched fail-clean scoreMoat rubric (4 axes, anti-inflation)"
```

---

## Task 3: Wire into tournament (opt-in) + report

**Files:**
- Modify: `src/pipeline/tournament.ts`
- Test: `src/pipeline/tournament-moat.test.ts`

- [ ] **Step 1: Write failing report tests `src/pipeline/tournament-moat.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { formatReport, type TournamentOutput } from "./tournament.ts";
import type { MoatReport } from "../moat/types.ts";

function baseOut(moat?: MoatReport): TournamentOutput {
  return {
    categoryId: "lipcare-india",
    concepts: [],
    report: { totalTrials: 40, concepts: [], candidateShareVsField: 0.5, abstentionRate: 0, errorRate: 0, degraded: false, winner: null } as any,
    moat,
  };
}

const sample: MoatReport = {
  scored: 1, degraded: false,
  concepts: [
    { conceptId: "A", name: "Alpha", overall: 0.61, warnings: [],
      axes: [
        { name: "copyability", score: 0.7, rationale: "hard to clone" },
        { name: "proprietaryInsight", score: 0.65, rationale: "unique" },
        { name: "distributionWedge", score: 0.6, rationale: "rare angle" },
        { name: "brandTrustDurability", score: 0.5, rationale: "ok" },
      ] },
  ],
};

test("renders the moat block with overall + axis breakdown", () => {
  const txt = formatReport(baseOut(sample));
  expect(txt).toContain("Moat");
  expect(txt).toContain("Alpha");
  expect(txt).toContain("0.61");
  expect(txt).toContain("copy");
});

test("renders degraded flag when degraded", () => {
  const txt = formatReport(baseOut({ ...sample, degraded: true, concepts: [{ ...sample.concepts[0]!, warnings: ["x"] }] }));
  expect(txt).toContain("degraded");
});

test("absent moat -> no moat block (non-breaking)", () => {
  const txt = formatReport(baseOut(undefined));
  expect(txt).not.toContain("Moat (defensibility");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/tournament-moat.test.ts`
Expected: FAIL (`moat` not on TournamentOutput; block not rendered).

- [ ] **Step 3a: Add imports + option + output field in `src/pipeline/tournament.ts`**

Add near the other imports:
```typescript
import { scoreMoat } from "../moat/rubric.ts";
import type { MoatReport } from "../moat/types.ts";
import { LLMClient } from "../llm/client.ts";
```
(If `LLMClient` is already imported, do not duplicate.)

Add `moat?: boolean;` to the `TournamentOptions` interface.

Add `moat?: MoatReport;` to the `TournamentOutput` interface (after `arenaMode?`).

- [ ] **Step 3b: Compute moat in `runTournament` before the `out` literal**

Just before `const out: TournamentOutput = { ... };` add:
```typescript
  let moat: MoatReport | undefined;
  if (opts.moat) {
    const moatScores = await scoreMoat(concepts, pack, new LLMClient());
    moat = {
      scored: moatScores.filter((m) => m.warnings.length === 0).length,
      concepts: [...moatScores].sort((a, b) => b.overall - a.overall),
      degraded: moatScores.some((m) => m.warnings.length > 0),
    };
  }
```
Then add `moat` to the `out` object literal (append after `arenaMode`):
```typescript
  const out: TournamentOutput = { categoryId: opts.categoryId, concepts, report, runStats, groundingCoverage, cohortDiversity, calibration, conceptDiversity, arenaMode, moat };
```

- [ ] **Step 3c: Render the moat block in `formatReport`**

Find the concept-diversity block (`const div = out.conceptDiversity; if (div) { ... }`). Immediately AFTER it, add:
```typescript
  const moatRep = out.moat;
  if (moatRep) {
    lines.push(`\nMoat (defensibility, opt-in):`);
    for (const m of moatRep.concepts) {
      const by = (n: string) => m.axes.find((a) => a.name === n)?.score ?? 0;
      lines.push(
        `  ${m.name.padEnd(22)} overall ${m.overall.toFixed(2)}  ` +
          `[copy ${by("copyability").toFixed(2)} · insight ${by("proprietaryInsight").toFixed(2)} · ` +
          `wedge ${by("distributionWedge").toFixed(2)} · trust ${by("brandTrustDurability").toFixed(2)}]`,
      );
      const copy = m.axes.find((a) => a.name === "copyability");
      if (copy) lines.push(`    copyability: ${copy.rationale}`);
    }
    if (moatRep.degraded) lines.push(`\u26a0 moat degraded — some axes defaulted to neutral (see warnings).`);
  }
```

- [ ] **Step 4: Run report tests + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/tournament-moat.test.ts`
Expected: PASS (3).
Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test`
Expected: full suite green.

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/pipeline/tournament.ts src/pipeline/tournament-moat.test.ts
git commit -m "feat(pipeline): opt-in moat scoring in tournament report + json (additive)"
```

---

## Task 4: CLI `--moat` flag

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Read the `tournament` case in `src/cli.ts`. It builds `runTournament({ categoryId, candidates, cohortSize, outDir, mode, deep, seed, runs })`.**

- [ ] **Step 2: Add `moat: flag("moat"),` to the `tournament` case's options object** (only the `tournament` case, not `winrate`):

```typescript
    const out = await runTournament({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "4")),
      cohortSize: Number(arg("cohort", "40")),
      outDir: arg("out", "out"),
      mode: parseArenaMode(),
      deep: arg("deep", "") === "true" || arg("deep", "") === "deep",
      moat: flag("moat"),
      seed: Number(arg("seed", "0")),
      runs: Number(arg("runs", "1")),
    });
```

- [ ] **Step 3: Typecheck + full suite + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
bun test
git add src/cli.ts
git commit -m "feat(cli): --moat flag enables defensibility scoring in tournament"
```

---

## Task 5: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + new moat tests).

- [ ] **Step 2: Confirm clean tree**

Run: `git status --short`
Expected: clean.

- [ ] **Step 3: Review diff vs spec**

Run: `git log --oneline defensibility-scoring ^main`
Confirm tasks 1-4 each produced a commit and spec sections (types, rollUp, scoreMoat, wiring, CLI) are represented.

- [ ] **Step 4: Hand back to user for review before merge. Do NOT ff-merge to main or push without explicit user go-ahead.**
