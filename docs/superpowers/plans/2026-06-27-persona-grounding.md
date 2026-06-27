# Persona Grounding (Silicon Sampling) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground arena personas in real public review data — condition each persona's anxieties on real, already-verified shopper grievances (the "what"), blend supply + review-activity proxies into segment weights (the "who"), with variance/caricature guards and measurable coverage/diversity — non-breaking, with a deferred verbatim (mode D) seam.

**Architecture:** Reuse the existing two-gate (containment + entailment) verified `rejectionReasons`/`unmetNeeds` on the pack as the grievance source — tag them to segments into `groundedGrievances[]` at intel time. A `distributionGrounder` blends supply + demand proxies into segment weights with `basis` provenance. `buildCohort` (upgraded, backward-compatible) samples grievances (seeded, without-replacement) into personas and emits `groundingCoverage`/`cohortDiversity`. A `groundingMode` param keeps mode D's seam open.

**Tech Stack:** Bun + TypeScript, Zod, `bun:test`. Reuses existing `LLMClient`, intel verification pipeline (`bind`/`verifyAgainstSources`), and cohort builder. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-27-persona-grounding-design.md`

**Key reuse discovery:** `pack.rejectionReasons` and `pack.unmetNeeds` are `EvidencedItem[]` ALREADY containment+entailment-verified and source-bound (see `src/intel/market.ts` `bind()`). Grievances reuse these — no new extraction/verification pipeline. An `EvidencedItem` is `{ text, quote, sourceUrl, verified, independent }`.

**Environment note (every bun command):** bun is at `~/.bun/bin/bun`, NOT on PATH. Prefix with `export PATH="$HOME/.bun/bin:$PATH"`.

---

## File structure (decomposition)

| File | Responsibility | New/Modify |
|---|---|---|
| `src/categories/types.ts` | `GroundedGrievanceSchema` + additive pack fields | Modify |
| `src/personas/grievances.ts` | pure: segment-tag verified EvidencedItems → GroundedGrievance[]; seeded without-replacement sampler; diversity/coverage metrics | Create |
| `src/personas/distribution.ts` | pure: blend supply + demand proxies → segment weights w/ basis | Create |
| `src/intel/market.ts` | call grievance tagging + distribution grounding at intel time; ship known-unknowns | Modify |
| `src/personas/cohort.ts` | upgraded buildCohort: groundingMode, grievance-conditioned personas, fallback, metrics | Modify |
| `src/pipeline/tournament.ts` | surface groundingCoverage/cohortDiversity in report | Modify |

Tests beside source as `*.test.ts`.

---

## Task 1: GroundedGrievance schema + pack fields

**Files:**
- Modify: `src/categories/types.ts`
- Test: `src/categories/grievance-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/categories/grievance-schema.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { GroundedGrievanceSchema, CategoryPackSchema } from "./types.ts";

test("GroundedGrievance parses with defaults", () => {
  const g = GroundedGrievanceSchema.parse({
    segment: "dry-lips sufferer", anxiety: "wore off within an hour",
    verbatimQuote: "this wore off in literally an hour",
  });
  expect(g.verified).toBe(false);
  expect(g.sourceUrl).toBe("");
});

test("pack without grounding fields still parses (back-compat)", () => {
  const pack = CategoryPackSchema.parse({
    id: "lipcare", name: "Lip Care", currency: "INR", geography: "India",
    unmetNeeds: [], purchaseTriggers: [], rejectionReasons: [], priceBands: [],
    competitorArchetypes: [], complianceNotes: [], buyerSegments: [],
  });
  expect(pack.groundedGrievances).toEqual([]);
  expect(pack.personaGroundingKnownUnknowns).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/categories/grievance-schema.test.ts`
Expected: FAIL ("GroundedGrievanceSchema is not exported").

- [ ] **Step 3: Implement** — in `src/categories/types.ts`, add before `CategoryPackSchema`:

```typescript
/**
 * A real, source-bound shopper grievance tagged to a buyer segment. Used to ground
 * persona anxieties in real review voice. verbatimQuote carries the actual review text
 * (mode D anchors on it).
 */
export const GroundedGrievanceSchema = z.object({
  segment: z.string(),
  anxiety: z.string(),
  verbatimQuote: z.string(),
  sourceUrl: z.string().default(""),
  sourceClass: z.string().default(""),
  verified: z.boolean().default(false),
});
export type GroundedGrievance = z.infer<typeof GroundedGrievanceSchema>;
```

Add these fields inside `CategoryPackSchema` (e.g. after `benchmarkBrands`):

```typescript
  /** Real source-bound shopper grievances, segment-tagged, for persona grounding. */
  groundedGrievances: z.array(GroundedGrievanceSchema).default([]),
  /** Declared known-unknowns for persona grounding. */
  personaGroundingKnownUnknowns: z.array(z.string()).default([]),
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/categories/grievance-schema.test.ts && bun run typecheck`
Expected: PASS (2 pass); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/categories/types.ts src/categories/grievance-schema.test.ts
git commit -m "feat(schema): GroundedGrievance + additive persona-grounding pack fields"
```

---

## Task 2: Grievance tagging + sampling + diversity (pure)

**Files:**
- Create: `src/personas/grievances.ts`
- Test: `src/personas/grievances.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/personas/grievances.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { tagGrievancesToSegments, sampleGrievances, cohortDiversity, type SegmentSeed } from "./grievances.ts";
import type { EvidencedItem } from "../categories/types.ts";
import type { GroundedGrievance } from "../categories/types.ts";

const ev = (text: string, verified: boolean): EvidencedItem => ({
  text, quote: text, sourceUrl: "u", verified, independent: true,
});
const segs: SegmentSeed[] = [
  { seed: "dry-lips relief seeker" },
  { seed: "budget marketplace buyer" },
];

test("tagging keeps ONLY verified items and assigns each to its best segment", () => {
  const items = [ev("balm gave no relief for my chronic dryness", true), ev("too pricey for what it is", true), ev("unverified junk", false)];
  const g = tagGrievancesToSegments(items, segs, (text) =>
    text.includes("dry") ? "dry-lips relief seeker" : "budget marketplace buyer",
  );
  expect(g.length).toBe(2);                       // unverified dropped
  expect(g.every((x) => x.verified)).toBe(true);
  expect(g.find((x) => x.anxiety.includes("dryness"))!.segment).toBe("dry-lips relief seeker");
});

test("sampling is without-replacement within a segment until pool exhausts, seeded", () => {
  const pool: GroundedGrievance[] = ["a", "b", "c"].map((q) => ({
    segment: "s", anxiety: q, verbatimQuote: q, sourceUrl: "", sourceClass: "", verified: true,
  }));
  const a = sampleGrievances(pool, 3, "seed1");
  expect(new Set(a.map((x) => x.anxiety)).size).toBe(3); // all distinct
  const a2 = sampleGrievances(pool, 3, "seed1");
  expect(a2.map((x) => x.anxiety)).toEqual(a.map((x) => x.anxiety)); // reproducible
  const over = sampleGrievances(pool, 5, "seed1"); // pool < n -> reuse, still length 5
  expect(over.length).toBe(5);
});

test("cohortDiversity = distinct anxieties / personas", () => {
  expect(cohortDiversity(["x", "x", "y", "z"])).toBeCloseTo(3 / 4, 5);
  expect(cohortDiversity([])).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/grievances.test.ts`
Expected: FAIL ("Cannot find module './grievances.ts'").

- [ ] **Step 3: Implement** `src/personas/grievances.ts`:

```typescript
import type { EvidencedItem, GroundedGrievance } from "../categories/types.ts";
import { makeRng } from "../arena/stats.ts";

export interface SegmentSeed { seed: string }

/**
 * Tag already-verified EvidencedItems (rejectionReasons/unmetNeeds) to the buyer
 * segment each best fits. Drops unverified items (no grounding on unverifiable voice).
 * `assign` maps an item's text to a segment seed (LLM-backed in production; injected for tests).
 */
export function tagGrievancesToSegments(
  items: EvidencedItem[],
  segments: SegmentSeed[],
  assign: (text: string) => string,
): GroundedGrievance[] {
  const valid = new Set(segments.map((s) => s.seed));
  const out: GroundedGrievance[] = [];
  for (const it of items) {
    if (!it.verified) continue;
    const seg = assign(it.text);
    if (!valid.has(seg)) continue;
    out.push({
      segment: seg,
      anxiety: it.text,
      verbatimQuote: it.quote || it.text,
      sourceUrl: it.sourceUrl,
      sourceClass: it.independent ? "independent" : "other",
      verified: true,
    });
  }
  return out;
}

/** Seeded shuffle (Fisher-Yates over makeRng). */
function shuffleSeeded<T>(arr: T[], seed: string): T[] {
  const rng = makeRng(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Sample n grievances WITHOUT replacement (maximize distinctness). If pool < n, cycle
 * through the shuffled pool again (reuse) so we always return n. Seeded => reproducible.
 */
export function sampleGrievances(pool: GroundedGrievance[], n: number, seed: string): GroundedGrievance[] {
  if (pool.length === 0) return [];
  const shuffled = shuffleSeeded(pool, seed);
  const out: GroundedGrievance[] = [];
  for (let i = 0; i < n; i++) out.push(shuffled[i % shuffled.length]!);
  return out;
}

/** distinct anxieties / total personas (0 for empty). The variance-collapse metric. */
export function cohortDiversity(anxieties: string[]): number {
  if (anxieties.length === 0) return 0;
  return new Set(anxieties).size / anxieties.length;
}
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/grievances.test.ts && bun run typecheck`
Expected: PASS (3 pass); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/personas/grievances.ts src/personas/grievances.test.ts
git commit -m "feat(personas): grievance tagging + seeded without-replacement sampling + diversity (pure)"
```

---

## Task 3: Distribution blend (pure)

**Files:**
- Create: `src/personas/distribution.ts`
- Test: `src/personas/distribution.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/personas/distribution.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { blendWeights, type SegInput } from "./distribution.ts";

test("blends supply+demand, normalizes to 1, attaches basis", () => {
  const segs: SegInput[] = [
    { seed: "a", estimateWeight: 0.5, supplyShare: 0.6, demandShare: 0.4 },
    { seed: "b", estimateWeight: 0.5, supplyShare: 0.4, demandShare: 0.6 },
  ];
  const out = blendWeights(segs, 0.5);
  const total = out.reduce((s, x) => s + x.weight, 0);
  expect(total).toBeCloseTo(1, 5);
  expect(out[0]!.basis).toContain("blend");
});

test("segment with NEITHER proxy falls back to estimate weight, basis=estimate (never zero)", () => {
  const segs: SegInput[] = [
    { seed: "a", estimateWeight: 0.7, supplyShare: 0.8, demandShare: 0.8 },
    { seed: "b", estimateWeight: 0.3, supplyShare: 0, demandShare: 0 },
  ];
  const out = blendWeights(segs, 0.5);
  const b = out.find((x) => x.seed === "b")!;
  expect(b.weight).toBeGreaterThan(0);             // not zeroed
  expect(b.basis).toContain("estimate");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/distribution.test.ts`
Expected: FAIL ("Cannot find module './distribution.ts'").

- [ ] **Step 3: Implement** `src/personas/distribution.ts`:

```typescript
export interface SegInput {
  seed: string;
  estimateWeight: number;  // existing LLM-estimate weight (fallback)
  supplyShare: number;     // 0..1 from price-tier/subtype shares (0 if unknown)
  demandShare: number;     // 0..1 from review-activity (0 if unknown)
}

export interface SegWeight { seed: string; weight: number; basis: string }

/**
 * Blend supply + demand proxies into a segment weight. A segment with NEITHER proxy
 * (both 0) falls back to its LLM-estimate weight (never zeroed). Weights normalized to 1.
 */
export function blendWeights(segs: SegInput[], alpha = 0.5): SegWeight[] {
  const raw = segs.map((s) => {
    const hasProxy = s.supplyShare > 0 || s.demandShare > 0;
    if (!hasProxy) {
      return { seed: s.seed, w: Math.max(0, s.estimateWeight), basis: "estimate (no grounding data)" };
    }
    const w = alpha * s.supplyShare + (1 - alpha) * s.demandShare;
    const basis = `blend: ${alpha} supply (price-tier shares) + ${(1 - alpha).toFixed(2)} review-activity`;
    return { seed: s.seed, w: Math.max(0, w), basis };
  });
  const total = raw.reduce((a, x) => a + x.w, 0) || 1;
  return raw.map((x) => ({ seed: x.seed, weight: Math.round((x.w / total) * 100) / 100, basis: x.basis }));
}
```

- [ ] **Step 4: Run to verify it passes + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/distribution.test.ts && bun run typecheck`
Expected: PASS (2 pass); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/personas/distribution.ts src/personas/distribution.test.ts
git commit -m "feat(personas): blended supply+demand segment weights with basis provenance (pure)"
```

---

## Task 4: Upgrade buildCohort (grounding + mode seam + metrics)

**Files:**
- Modify: `src/personas/cohort.ts`
- Test: `src/personas/cohort.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/personas/cohort.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { buildCohort } from "./cohort.ts";

// Inject a fake LLM so no network: it echoes a persona using the grounded anxiety it's given.
const fakeLlm = {
  completeJson: async (opts: any) => {
    const content = opts.messages.map((m: any) => m.content).join(" ");
    // pull the grounded grievance text if present (prompt includes "concern: '...'")
    const m = content.match(/concern: '([^']+)'/);
    const anxiety = m ? m[1] : "generic worry";
    return { personas: [{ id: "1", segment: "s", name: "N", age: 30, context: "c",
      budgetSensitivity: "medium", primaryNeed: "n", anxieties: [anxiety],
      decisionStyle: "d", shoppingContext: "browsing" }] };
  },
} as any;

const packBase = {
  name: "Lip Care", geography: "India",
  buyerSegments: [{ seed: "dry-lips relief seeker", weight: 1, basis: "x" }],
  groundedGrievances: [
    { segment: "dry-lips relief seeker", anxiety: "balm wore off in an hour", verbatimQuote: "wore off in an hour", sourceUrl: "u", sourceClass: "independent", verified: true },
  ],
} as any;

test("synthesized mode conditions personas on a real grievance + emits metrics", async () => {
  const r = await buildCohort(packBase, 1, fakeLlm);
  expect(r.personas).toHaveLength(1);
  expect(r.personas[0]!.anxieties.join(" ")).toContain("wore off");
  expect(r.groundingCoverage).toBeGreaterThan(0);
  expect(r.cohortDiversity).toBeGreaterThanOrEqual(0);
});

test("ungrounded pack (no grievances) falls back to invention, coverage 0", async () => {
  const ungrounded = { ...packBase, groundedGrievances: [] };
  const r = await buildCohort(ungrounded, 1, fakeLlm);
  expect(r.personas).toHaveLength(1);
  expect(r.groundingCoverage).toBe(0);
});

test("verbatim mode is a documented deferred stub", async () => {
  await expect(buildCohort(packBase, 1, fakeLlm, { groundingMode: "verbatim" })).rejects.toThrow(/not yet implemented/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/cohort.test.ts`
Expected: FAIL (buildCohort returns `Persona[]`, not `{personas, groundingCoverage, cohortDiversity}`; no groundingMode).

- [ ] **Step 3: Implement** — rewrite `buildCohort` in `src/personas/cohort.ts`. Keep the `PersonaSchema`/`BatchSchema`. Replace the function with:

```typescript
import { sampleGrievances, cohortDiversity } from "./grievances.ts";
import type { GroundedGrievance } from "../categories/types.ts";

export interface CohortResult {
  personas: Persona[];
  groundingCoverage: number;  // fraction of personas grounded on a real grievance
  cohortDiversity: number;    // distinct anxieties / personas
}

export interface BuildCohortOpts { groundingMode?: "synthesized" | "verbatim"; seed?: string }

export async function buildCohort(
  pack: CategoryPack,
  size: number,
  llm = new LLMClient(),
  opts: BuildCohortOpts = {},
): Promise<CohortResult> {
  const mode = opts.groundingMode ?? "synthesized";
  if (mode === "verbatim") {
    throw new Error("groundingMode 'verbatim' not yet implemented (mode D is a deferred seam)");
  }
  const seed = opts.seed ?? "cohort";
  const grievances: GroundedGrievance[] = (pack.groundedGrievances ?? []).filter((g) => g.verified);
  const bySegment = new Map<string, GroundedGrievance[]>();
  for (const g of grievances) {
    const arr = bySegment.get(g.segment) ?? [];
    arr.push(g);
    bySegment.set(g.segment, arr);
  }

  const perSegment = pack.buyerSegments.map((s) => ({
    seed: s.seed,
    n: Math.max(1, Math.round(s.weight * size)),
  }));

  let grounded = 0;
  const batches = await Promise.all(
    perSegment.map(async ({ seed: segSeed, n }) => {
      const pool = bySegment.get(segSeed) ?? [];
      const sampled = pool.length ? sampleGrievances(pool, n, `${seed}::${segSeed}`) : [];
      const grievanceLines = sampled.map((g, i) => `  Persona ${i + 1} concern: '${g.anxiety}'`).join("\n");
      const groundingNote = pool.length
        ? `Ground each persona in a REAL shopper concern below. Treat it as ONE worry among a full ` +
          `life — do not make the persona only about it. Vary age, context, and decision style independently.\n${grievanceLines}\n`
        : `(No grounded grievances for this segment — invent realistic, diverse anxieties.)\n`;
      if (pool.length) grounded += Math.min(n, sampled.length);

      const raw = await llm.completeJson<z.infer<typeof BatchSchema>>({
        messages: [
          { role: "system", content:
            "You generate realistic, diverse buyer personas grounded in real purchase behavior. " +
            "Avoid stereotypes; vary age, context, and anxiety." },
          { role: "user", content:
            `Category: ${pack.name} (${pack.geography}).\nSegment: "${segSeed}".\n` +
            `Generate ${n} distinct personas in this segment.\n${groundingNote}` +
            `Each: id, segment, name, age, context, budgetSensitivity (low|medium|high), ` +
            `primaryNeed, anxieties[], decisionStyle, shoppingContext.\nReturn { "personas": [...] }.` },
        ],
        temperature: 0.9,
      });
      return BatchSchema.parse(raw).personas.map((p) => ({ ...p, segment: segSeed }));
    }),
  );

  const personas = batches.flat().slice(0, size);
  const groundingCoverage = personas.length ? Math.min(grounded, personas.length) / personas.length : 0;
  const diversity = cohortDiversity(personas.map((p) => p.anxieties.join("|")));
  return { personas, groundingCoverage, cohortDiversity: diversity };
}
```

(Ensure `CategoryPack` is imported — it already is at the top of cohort.ts.)

- [ ] **Step 4: Update existing callers** — `buildCohort` now returns `CohortResult`, not `Persona[]`. Find callers: `src/pipeline/tournament.ts` (runTournament + runOptimize) and `src/optimizer/optimize.ts` if it builds a cohort. In each, change `const cohort = await buildCohort(...)` to `const { personas: cohort, groundingCoverage, cohortDiversity } = await buildCohort(...)` (keep the variable name `cohort` so downstream `arena.run({ cohort })` is unchanged). In tournament.ts capture the metrics for the report (Task 5). Read each caller and apply the destructure.

- [ ] **Step 5: Run to verify it passes + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/personas/cohort.test.ts && bun test && bun run typecheck`
Expected: cohort tests pass; full suite green; typecheck clean (all callers destructure correctly).

- [ ] **Step 6: Commit**

```bash
git add src/personas/cohort.ts src/personas/cohort.test.ts src/pipeline/tournament.ts src/optimizer/optimize.ts
git commit -m "feat(personas): grounded buildCohort (grievance-conditioned, metrics, verbatim seam); update callers"
```

---

## Task 5: Wire grounding into intel + report

**Files:**
- Modify: `src/intel/market.ts`
- Modify: `src/pipeline/tournament.ts`
- Test: covered by Task 6 smoke run + existing tests

- [ ] **Step 1: Tag grievances + ship known-unknowns in `src/intel/market.ts`**

`buildCategoryPack` already produces verified `pack.rejectionReasons` and `pack.unmetNeeds` (EvidencedItem[]) and `pack.buyerSegments`. AFTER those are finalized (after the `pack.unmetNeeds = ... .filter(verified)` block), add grievance tagging via an LLM segment-assignment. Add near the other imports:

```typescript
import { tagGrievancesToSegments } from "../personas/grievances.ts";
```

Then add:

```typescript
  // Ground persona anxieties in REAL verified complaints. rejectionReasons + unmetNeeds are
  // already containment+entailment verified and source-bound — reuse them as grievances.
  const grievanceItems = [...pack.rejectionReasons, ...pack.unmetNeeds].filter((i) => i.verified);
  if (grievanceItems.length && pack.buyerSegments.length) {
    const segList = pack.buyerSegments.map((s) => s.seed).join("\n- ");
    const assignRaw = await llm.completeJson<{ assignments: { text: string; segment: string }[] }>({
      messages: [{ role: "user", content:
        `Assign each shopper complaint to the single best-fit buyer segment.\n` +
        `Segments:\n- ${segList}\n\nComplaints:\n` +
        grievanceItems.map((g, i) => `${i}. ${g.text}`).join("\n") +
        `\n\nReturn JSON { "assignments": [ { "text": <complaint text>, "segment": <exact segment seed> } ] }.` },
      ],
    }).catch(() => ({ assignments: [] as { text: string; segment: string }[] }));
    const map = new Map(assignRaw.assignments.map((a) => [a.text, a.segment]));
    pack.groundedGrievances = tagGrievancesToSegments(
      grievanceItems, pack.buyerSegments, (text) => map.get(text) ?? pack.buyerSegments[0]!.seed,
    );
  }
  pack.personaGroundingKnownUnknowns = [
    "Grievances are STATED complaints from vocal/dissatisfied reviewers (survivorship), not a representative buyer sample.",
    "Segment weights blend a supply proxy (what's stocked) and a review-activity proxy (what's discussed) — neither is measured demand.",
    "Review corpus is channel/geo/language-skewed to whatever the harvest reached.",
    "Grounding improves INPUT realism only; it does NOT make win-rates calibrated or representative of true market share.",
  ];
```

(Distribution blend wiring: the existing `normalizeWeights` already sets supply-proxy weights. For this piece, the grievance grounding is the primary win; the blend helper `blendWeights` is available and unit-tested, but wiring real demandShare from review-activity requires per-segment review counts. If those aren't readily threaded, leave segment weights as the existing supply-proxy estimate and note it — do NOT fabricate a demand proxy. The `blendWeights` util stays ready for when review-activity counts are threaded. Report this as a scoping decision.)

- [ ] **Step 2: Surface metrics in `src/pipeline/tournament.ts` `formatReport`**

In `runTournament`, the destructure from Task 4 gives `groundingCoverage`/`cohortDiversity`. Thread them onto `TournamentOutput` (add optional fields `groundingCoverage?: number; cohortDiversity?: number`) and in `formatReport` add, after the abstention line:

```typescript
  if (out.groundingCoverage !== undefined) {
    lines.push(
      `Persona grounding: ${(out.groundingCoverage * 100).toFixed(0)}% grounded on real grievances` +
        ` | cohort diversity ${(out.cohortDiversity ?? 0).toFixed(2)}`,
    );
  }
```

Set those fields on the `TournamentOutput` object from the captured cohort metrics.

- [ ] **Step 3: Typecheck + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck && bun test`
Expected: typecheck clean; full suite green.

- [ ] **Step 4: Commit**

```bash
git add src/intel/market.ts src/pipeline/tournament.ts
git commit -m "feat(intel): tag verified complaints into grounded grievances; report grounding coverage/diversity"
```

---

## Task 6: End-to-end verification

**Files:** none (verification; requires API keys for live run)

- [ ] **Step 1: Full unit suite**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test`
Expected: all green incl. grievance-schema, grievances, distribution, cohort.

- [ ] **Step 2: Typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck`
Expected: zero errors.

- [ ] **Step 3: Live: regenerate a grounded pack**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run intel --category="lip balm" --geo="India" --currency=INR --ground`
Expected: pack in `./packs/` carries `groundedGrievances[]` (verified, segment-tagged with verbatim quotes) OR an empty list if no verified complaints were found (honest). `personaGroundingKnownUnknowns` populated.

- [ ] **Step 4: Live: tournament shows grounding metrics + grounded anxieties**

Run: `export PATH="$HOME/.bun/bin:$PATH" && PB_CONCURRENCY=12 PB_OPTION_CONCURRENCY=8 bun run tournament --category=<generated-pack-id> --candidates=2 --cohort=12 --deep=true --seed=1 --out=out`
Expected: report prints `Persona grounding: X% grounded ... | cohort diversity Y`. Inspect `out/tournament.json` personas — at least some `anxieties` echo real grievance phrasing from the pack's `groundedGrievances`. An ungrounded pack still runs (coverage 0%).

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "test: end-to-end persona grounding verified live"
```

---

## Done criteria

- `bun test` green; `bun run typecheck` clean.
- A grounded pack carries verified, segment-tagged `groundedGrievances[]` (or honest empty) + known-unknowns.
- Personas' anxieties demonstrably reflect real grievances; `groundingCoverage`/`cohortDiversity` reported.
- Ungrounded packs still produce a working cohort (non-breaking).
- Verbatim mode D throws the documented deferred-seam error; schema carries the verbatim quote for it.

## Out of scope (deferred)

Verbatim mode D impl; calibration; first-party/OCR data; better demand proxies (search-volume); threading real per-segment review-activity into the distribution blend (util ready, wiring deferred).
