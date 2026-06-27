# Concept Diversity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Council from generating near-duplicate brands by over-generating territories, tagging each on a wedge fingerprint (wedge, segment, tier), and replacing `slice(0, count)` with a pure deterministic greedy diverse selector + one bounded re-roll, surfacing an honest `lowConceptDiversity` flag in the tournament report.

**Architecture:** A new `src/council/diversity.ts` separates an impure batched LLM tagger (`tagWedges`) from a pure deterministic selector (`selectDiverse`, reusing `makeRng`). `Council.generateCandidates` over-generates (~16 territories), tags, selects the most distinct N, re-rolls once with an avoid-list if the slate collapses, then flags best-effort. The diversity result rides into `TournamentOutput.conceptDiversity` and `formatReport` additively, mirroring the calibration layer.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`), Zod (existing), `LLMClient.completeJson`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-28-concept-diversity-design.md`

---

## File Structure

- Create `src/council/diversity.ts` — types (`WedgeFingerprint`, `WedgeTag`, `DiversitySelection`, `DiversityReport`), `tagWedges(territories, packBandLabels, llm)` (impure, batched, fail-clean), `selectDiverse(tags, n, seed)` (pure).
- Create `src/council/diversity.test.ts` — pure selector tests (fixtures) + `tagWedges` tests (fake LLM).
- Modify `src/council/council.ts` — `proposeTerritories(perAgent, avoid?)`; `generateCandidates(count, seed?)` over-generate→tag→select→one re-roll, return `{ concepts, diversity }`.
- Modify `src/pipeline/tournament.ts` — destructure `{ concepts, diversity }` at the call site (line 58), add `conceptDiversity?: DiversityReport` to `TournamentOutput`, render report lines in `formatReport`.
- Create `src/pipeline/tournament-diversity.test.ts` — report-contract tests (pure `formatReport`).

Verified repo conventions:
- Tests: `import { test, expect } from "bun:test";`, run with `bun test`.
- Fake LLM in tests: `const llm = { completeJson: async () => ({...}) } as any;`.
- `Agent.respondJson<T>(prompt)` → `llm.completeJson`. `proposeTerritories` builds a prompt string per agent.
- `makeRng(seedStr: string)` in `src/arena/stats.ts` returns `() => number`.
- Tournament call site: `src/pipeline/tournament.ts:58` `const concepts = await council.generateCandidates(opts.candidates);`. `TournamentOptions` has `seed`.

---

## Task 1: Diversity types + pure `selectDiverse` (the core)

**Files:**
- Create: `src/council/diversity.ts`
- Test: `src/council/diversity.test.ts`

- [ ] **Step 1: Write failing selector tests**

```typescript
import { test, expect } from "bun:test";
import { selectDiverse, type WedgeTag } from "./diversity.ts";

function tag(i: number, wedge: string, segment: string, tier: string): WedgeTag {
  return { territoryIndex: i, territoryName: `t${i}`, fingerprint: { wedge, segment, tier } };
}

test("all-identical pool -> selects n but distinctWedgeCount=1", () => {
  const pool = [0, 1, 2, 3].map((i) => tag(i, "clean", "sensitive-skin", "premium"));
  const sel = selectDiverse(pool, 4, 0);
  expect(sel.selectedIndices).toHaveLength(4);
  expect(sel.distinctWedgeCount).toBe(1);
  expect(sel.spannedWedges).toEqual(["clean"]);
});

test("fully-distinct pool >= n -> distinctWedgeCount === n", () => {
  const pool = [
    tag(0, "clean", "sensitive-skin", "premium"),
    tag(1, "longevity", "everyday", "value"),
    tag(2, "gifting", "luxury", "premium"),
    tag(3, "price-disruption", "gen-z-value", "value"),
  ];
  const sel = selectDiverse(pool, 3, 0);
  expect(sel.distinctWedgeCount).toBe(3);
  expect(sel.selectedIndices).toHaveLength(3);
});

test("mixed pool (3 distinct + 1 dup), n=4 -> 3 distinct chosen first, count=3", () => {
  const pool = [
    tag(0, "clean", "sensitive-skin", "premium"),
    tag(1, "longevity", "everyday", "value"),
    tag(2, "gifting", "luxury", "premium"),
    tag(3, "clean", "sensitive-skin", "premium"),
  ];
  const sel = selectDiverse(pool, 4, 0);
  expect(sel.selectedIndices).toHaveLength(4);
  expect(sel.distinctWedgeCount).toBe(3);
  // the three distinct tuples are all selected
  expect(new Set(sel.selectedIndices)).toEqual(new Set([0, 1, 2, 3]));
});

test("deterministic: same (pool,n,seed) -> identical selectedIndices", () => {
  const pool = [
    tag(0, "clean", "sensitive-skin", "premium"),
    tag(1, "longevity", "everyday", "value"),
    tag(2, "gifting", "luxury", "premium"),
    tag(3, "refills", "eco", "value"),
  ];
  expect(selectDiverse(pool, 2, 7).selectedIndices).toEqual(selectDiverse(pool, 2, 7).selectedIndices);
});

test("pool smaller than n -> selects all, no crash, honest count", () => {
  const pool = [tag(0, "clean", "sensitive-skin", "premium"), tag(1, "longevity", "everyday", "value")];
  const sel = selectDiverse(pool, 4, 0);
  expect(sel.selectedIndices).toHaveLength(2);
  expect(sel.distinctWedgeCount).toBe(2);
});

test("novelty priority: a new-wedge candidate is chosen over a new-tier-only candidate", () => {
  // after choosing index 0 (clean/sensitive/premium), index 1 shares wedge+segment but new tier,
  // index 2 brings a brand-new wedge. The new-wedge must be picked second.
  const pool = [
    tag(0, "clean", "sensitive-skin", "premium"),
    tag(1, "clean", "sensitive-skin", "value"),     // only new tier
    tag(2, "longevity", "everyday", "premium"),      // new wedge
  ];
  const sel = selectDiverse(pool, 2, 0);
  expect(sel.selectedIndices).toContain(2);
  expect(sel.selectedIndices).not.toContain(1);
});

test("empty pool -> empty selection, count 0, no crash", () => {
  const sel = selectDiverse([], 4, 0);
  expect(sel.selectedIndices).toEqual([]);
  expect(sel.distinctWedgeCount).toBe(0);
  expect(sel.spannedWedges).toEqual([]);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/council/diversity.test.ts`
Expected: FAIL ("Cannot find module './diversity.ts'").

- [ ] **Step 3: Implement types + `selectDiverse` in `src/council/diversity.ts`**

```typescript
import { makeRng } from "../arena/stats.ts";

export interface WedgeFingerprint {
  wedge: string;
  segment: string;
  tier: string;
}

export interface WedgeTag {
  territoryIndex: number;
  territoryName: string;
  fingerprint: WedgeFingerprint;
}

export interface DiversitySelection {
  selectedIndices: number[];
  distinctWedgeCount: number;
  spannedWedges: string[];
  rerolled: boolean;
  warning?: "lowConceptDiversity";
}

export interface DiversityReport {
  requested: number;
  distinctWedgeCount: number;
  spannedWedges: string[];
  poolSize: number;
  rerolled: boolean;
  warning?: "lowConceptDiversity";
}

const fpKey = (f: WedgeFingerprint) => `${f.wedge}|${f.segment}|${f.tier}`;

/** Pure, deterministic greedy max-diversity selection over (wedge, segment, tier). */
export function selectDiverse(tags: WedgeTag[], n: number, seed: number): DiversitySelection {
  // 1. Deterministic order: shuffle by seed, then the greedy loop breaks ties by this order.
  const rng = makeRng(String(seed));
  const ordered = tags
    .map((t) => ({ t, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t);

  const chosen: WedgeTag[] = [];
  const usedFp = new Set<string>();
  const usedWedge = new Set<string>();
  const usedSegment = new Set<string>();
  const usedTier = new Set<string>();
  const remaining = [...ordered];

  while (chosen.length < n && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const f = remaining[i]!.fingerprint;
      let score = 0;
      if (!usedFp.has(fpKey(f))) score += 1000;
      if (!usedWedge.has(f.wedge)) score += 100;
      if (!usedSegment.has(f.segment)) score += 10;
      if (!usedTier.has(f.tier)) score += 1;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    const pick = remaining.splice(bestIdx, 1)[0]!;
    chosen.push(pick);
    usedFp.add(fpKey(pick.fingerprint));
    usedWedge.add(pick.fingerprint.wedge);
    usedSegment.add(pick.fingerprint.segment);
    usedTier.add(pick.fingerprint.tier);
  }

  const distinctWedgeCount = new Set(chosen.map((c) => fpKey(c.fingerprint))).size;
  const spannedWedges = [...new Set(chosen.map((c) => c.fingerprint.wedge))].sort();
  return {
    selectedIndices: chosen.map((c) => c.territoryIndex),
    distinctWedgeCount,
    spannedWedges,
    rerolled: false,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/council/diversity.test.ts`
Expected: PASS (7).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/council/diversity.ts src/council/diversity.test.ts
git commit -m "feat(council): pure deterministic diverse-selection over wedge fingerprint"
```

---

## Task 2: `tagWedges` (impure, batched, fail-clean)

**Files:**
- Modify: `src/council/diversity.ts`
- Modify: `src/council/diversity.test.ts`

- [ ] **Step 1: Add failing tagWedges tests**

```typescript
import { tagWedges } from "./diversity.ts";

type Terr = { name: string; thesis: string; primarySegment: string };
const terrs: Terr[] = [
  { name: "Clean Skin", thesis: "non-toxic for sensitive skin", primarySegment: "sensitive-skin" },
  { name: "All Day", thesis: "longevity in heat", primarySegment: "everyday" },
];

test("tagWedges maps a well-formed batch response to fingerprints", async () => {
  const llm = { completeJson: async () => ({ tags: [
    { territoryIndex: 0, wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { territoryIndex: 1, wedge: "longevity", segment: "everyday", tier: "value" },
  ] }) } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out).toHaveLength(2);
  expect(out[0]!.fingerprint).toEqual({ wedge: "clean", segment: "sensitive-skin", tier: "premium" });
  expect(out[1]!.territoryName).toBe("All Day");
});

test("tagWedges fails clean: LLM throws -> sentinel-distinct fingerprints, no throw", async () => {
  const llm = { completeJson: async () => { throw new Error("down"); } } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out).toHaveLength(2);
  // sentinels are distinct per index, never collapse into duplicates
  expect(out[0]!.fingerprint.wedge).not.toBe(out[1]!.fingerprint.wedge);
  expect(out[0]!.fingerprint.wedge).toContain("untagged");
});

test("tagWedges fills sentinel for any territory missing from the response", async () => {
  const llm = { completeJson: async () => ({ tags: [
    { territoryIndex: 0, wedge: "clean", segment: "sensitive-skin", tier: "premium" },
  ] }) } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out).toHaveLength(2);
  expect(out[1]!.fingerprint.wedge).toContain("untagged");
});

test("tagWedges coerces a tier outside the pack bands to 'unknown'", async () => {
  const llm = { completeJson: async () => ({ tags: [
    { territoryIndex: 0, wedge: "clean", segment: "sensitive-skin", tier: "ultra-premium" },
    { territoryIndex: 1, wedge: "longevity", segment: "everyday", tier: "value" },
  ] }) } as any;
  const out = await tagWedges(terrs, ["value", "premium"], llm);
  expect(out[0]!.fingerprint.tier).toBe("unknown"); // not in ["value","premium"]
  expect(out[1]!.fingerprint.tier).toBe("value");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/council/diversity.test.ts`
Expected: FAIL (`tagWedges` not exported).

- [ ] **Step 3: Implement `tagWedges` in `src/council/diversity.ts`**

Add this import at the top (next to the `makeRng` import):

```typescript
import type { LLMClient } from "../llm/client.ts";
```

Add the function (and a small normalizer):

```typescript
export interface TerritoryLike {
  name: string;
  thesis: string;
  primarySegment: string;
}

const normSlug = (s: unknown): string =>
  String(s ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function sentinel(index: number): WedgeFingerprint {
  return { wedge: `untagged-${index}`, segment: "unknown", tier: "unknown" };
}

/**
 * Classify each territory onto a (wedge, segment, tier) fingerprint via ONE batched LLM call.
 * Fail-clean: any territory the model fails to tag gets a sentinel-distinct fingerprint, so a
 * tagging failure degrades to "treat as distinct" and never fabricates duplicates.
 */
export async function tagWedges(
  territories: TerritoryLike[],
  packBandLabels: string[],
  llm: LLMClient,
): Promise<WedgeTag[]> {
  const bands = packBandLabels.map((b) => normSlug(b)).filter(Boolean);
  const bandSet = new Set(bands);

  let raw: { tags?: Array<{ territoryIndex: number; wedge?: string; segment?: string; tier?: string }> } = {};
  try {
    raw = await llm.completeJson({
      messages: [
        {
          role: "user",
          content:
            `Classify each brand territory onto a positioning "wedge fingerprint" with three axes.\n` +
            `Territories (index: name — thesis — primary segment):\n` +
            territories.map((t, i) => `${i}: ${t.name} — ${t.thesis} — ${t.primarySegment}`).join("\n") +
            `\n\nAxes:\n` +
            `- wedge: the core positioning angle (e.g. "clean", "longevity", "gifting", "price-disruption").\n` +
            `- segment: the primary buyer segment (e.g. "sensitive-skin", "gen-z-value").\n` +
            `- tier: MUST be exactly one of: ${bands.join(", ") || "value, premium"}.\n\n` +
            `Rules: each axis value is a short lowercase hyphenated slug (<=3 words). ` +
            `REUSE the SAME slug when two territories share an angle (do not invent synonyms).\n` +
            `Return ONLY JSON: { "tags": [ { "territoryIndex": <int>, "wedge", "segment", "tier" } ] }`,
        },
      ],
      temperature: 0,
    });
  } catch {
    raw = {};
  }

  const byIndex = new Map<number, { wedge?: string; segment?: string; tier?: string }>();
  for (const t of raw?.tags ?? []) {
    if (typeof t?.territoryIndex === "number") byIndex.set(t.territoryIndex, t);
  }

  return territories.map((terr, i) => {
    const hit = byIndex.get(i);
    if (!hit || !hit.wedge || !hit.segment) {
      return { territoryIndex: i, territoryName: terr.name, fingerprint: sentinel(i) };
    }
    const tier = normSlug(hit.tier);
    return {
      territoryIndex: i,
      territoryName: terr.name,
      fingerprint: {
        wedge: normSlug(hit.wedge),
        segment: normSlug(hit.segment),
        tier: bandSet.has(tier) ? tier : "unknown",
      },
    };
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/council/diversity.test.ts`
Expected: PASS (7 selector + 4 tag = 11).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/council/diversity.ts src/council/diversity.test.ts
git commit -m "feat(council): batched fail-clean wedge tagging (tier constrained to pack bands)"
```

---

## Task 3: Wire diversity into `Council.generateCandidates` (over-generate, select, one re-roll)

**Files:**
- Modify: `src/council/council.ts`
- Test: `src/council/council.test.ts` (create)

- [ ] **Step 1: Read `src/council/council.ts` fully to orient.** Confirm: `proposeTerritories(perAgent=2)` builds a per-agent prompt and flattens results; `specifyBrand(territory)`; `generateCandidates(count)` currently does `proposeTerritories()` then `slice(0,count)` then `specifyBrand` each. `this.pack.priceBands` exists on the pack. If `priceBands` is absent/typed differently, locate the band labels by reading `src/categories/types.ts` and report NEEDS_CONTEXT if the shape differs from `Array<{ label: string }>`.

- [ ] **Step 2: Write failing Council integration tests — create `src/council/council.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { Council } from "./council.ts";

// Minimal pack stub; only fields the Council reads need to be plausible.
const pack: any = {
  name: "Fragrance", geography: "India", currency: "INR",
  unmetNeeds: [], purchaseTriggers: [], rejectionReasons: [],
  priceBands: [{ label: "value" }, { label: "premium" }],
  competitorArchetypes: [], complianceNotes: [],
};

// Fake agent council via a fake LLM is heavy; instead we stub the Council's own methods.
// We test the orchestration: over-generate -> tag -> select -> re-roll -> report.

function makeCouncil(territoriesByCall: any[][], tagsByCall: any[][]) {
  const c = new Council(pack, { completeJson: async () => ({}) } as any);
  let propCall = 0, tagCall = 0;
  (c as any).proposeTerritories = async (_perAgent = 2, _avoid: string[] = []) =>
    territoriesByCall[propCall++] ?? [];
  // stub specifyBrand to echo a concept from the territory
  (c as any).specifyBrand = async (t: any) => ({
    id: t.name.toLowerCase().replace(/\s+/g, "-"), name: t.name, positioning: t.thesis,
    targetCustomer: "x", coreInsight: "x", productPromise: "x", heroSku: "x",
    priceMinor: 100000, priceBand: "premium", tagline: "x", claims: [], packagingDirection: "x",
    brandVoice: "x", landingHeadline: "x", topAdAngles: [], objections: [], launchRisks: [],
  });
  // stub the tagger module call by monkeypatching via injected tagFn
  (c as any).__tagFn = async (terrs: any[]) => (tagsByCall[tagCall++] ?? []).map((f: any, i: number) => ({
    territoryIndex: i, territoryName: terrs[i]?.name ?? `t${i}`, fingerprint: f,
  }));
  return c;
}

test("rich pool -> no re-roll, distinct slate, no warning", async () => {
  const terrs = [
    { name: "A", thesis: "clean", primarySegment: "sensitive-skin" },
    { name: "B", thesis: "longevity", primarySegment: "everyday" },
    { name: "C", thesis: "gifting", primarySegment: "luxury" },
  ];
  const tags = [
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { wedge: "longevity", segment: "everyday", tier: "value" },
    { wedge: "gifting", segment: "luxury", tier: "premium" },
  ];
  const c = makeCouncil([terrs], [tags]);
  const { concepts, diversity } = await c.generateCandidates(3, 0);
  expect(concepts).toHaveLength(3);
  expect(diversity.rerolled).toBe(false);
  expect(diversity.distinctWedgeCount).toBe(3);
  expect(diversity.warning).toBeUndefined();
});

test("collapsed pool -> triggers ONE re-roll, then flags lowConceptDiversity if still collapsed", async () => {
  const collapsed = [
    { name: "A", thesis: "clean", primarySegment: "sensitive-skin" },
    { name: "B", thesis: "clean2", primarySegment: "sensitive-skin" },
    { name: "C", thesis: "clean3", primarySegment: "sensitive-skin" },
  ];
  const sameTags = [
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
  ];
  // both the first pool and the re-roll pool collapse to one wedge
  const c = makeCouncil([collapsed, collapsed], [sameTags, sameTags]);
  const { diversity } = await c.generateCandidates(3, 0);
  expect(diversity.rerolled).toBe(true);
  expect(diversity.distinctWedgeCount).toBe(1);
  expect(diversity.warning).toBe("lowConceptDiversity");
});
```

NOTE: This test relies on the Council reading wedge tags via an injectable `__tagFn` seam so we don't have to fake the whole agent layer. Implement that seam in Step 3 (the Council uses `this.__tagFn ?? tagWedges`).

- [ ] **Step 3: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/council/council.test.ts`
Expected: FAIL (`generateCandidates` returns an array, not `{concepts, diversity}`; no re-roll).

- [ ] **Step 4: Modify `src/council/council.ts`**

4a. Add imports at the top:

```typescript
import { tagWedges, selectDiverse, type WedgeTag, type DiversityReport } from "./diversity.ts";
```

4b. Change `proposeTerritories` to accept an optional `avoid`:

Replace the signature and prompt. The method currently builds a prompt with
`Propose ${perAgent} distinct brand territories ...`. Change the signature to
`async proposeTerritories(perAgent = 2, avoid: string[] = [])` and append, when `avoid.length`:

```typescript
              (avoid.length
                ? `\nThese positioning wedges are already saturated — propose territories that ` +
                  `attack DIFFERENT wedges, NOT these: ${avoid.join(", ")}.`
                : "") +
```

(Insert that expression into the existing template string, right after the existing instructions and before the `Schema:` line. Keep everything else identical so existing behavior with `avoid=[]` is unchanged.)

4c. Add a tagger seam field on the class (so tests can inject). Near the top of the class body add:

```typescript
  /** Test seam: override the wedge tagger. Defaults to the real batched LLM tagger. */
  private __tagFn?: (terrs: { name: string; thesis: string; primarySegment: string }[]) => Promise<WedgeTag[]>;
```

4d. Replace the body of `generateCandidates` with:

```typescript
  /** Generate N candidate brands end-to-end, with diversity selection + one bounded re-roll. */
  async generateCandidates(
    count: number,
    seed = 0,
  ): Promise<{ concepts: BrandConcept[]; diversity: DiversityReport }> {
    const bandLabels = (this.pack.priceBands ?? []).map((b) => b.label);
    const tag = (terrs: { name: string; thesis: string; primarySegment: string }[]) =>
      (this.__tagFn ? this.__tagFn(terrs) : tagWedges(terrs, bandLabels, this.llm));

    // 1. over-generate + tag + select
    let pool = await this.proposeTerritories(2);
    let tags = await tag(pool);
    let sel = selectDiverse(tags, count, seed);
    let rerolled = false;

    // 2. one bounded re-roll if the slate collapses
    if (sel.distinctWedgeCount < count) {
      try {
        const pool2 = await this.proposeTerritories(2, sel.spannedWedges);
        const tags2 = (await tag(pool2)).map((t) => ({ ...t, territoryIndex: t.territoryIndex + pool.length }));
        const combinedPool = [...pool, ...pool2];
        const combinedTags = [...tags, ...tags2];
        const sel2 = selectDiverse(combinedTags, count, seed);
        pool = combinedPool;
        tags = combinedTags;
        sel = sel2;
        rerolled = true;
      } catch (e) {
        console.warn(`[council] re-roll failed: ${(e as Error).message}`);
      }
    }

    // 3. honest flag
    const warning = sel.distinctWedgeCount < count ? ("lowConceptDiversity" as const) : undefined;

    // 4. specify the selected territories (unchanged).
    // `territoryIndex` is positionally aligned to `pool`: the first pool's tags use 0..pool0-1,
    // and re-roll tags were re-based by `+ pool0.length` while `pool` was concatenated in the
    // same order — so `pool[idx]` is the correct territory by construction.
    const selectedTerritories = sel.selectedIndices
      .map((idx) => pool[idx])
      .filter((t): t is { name: string; thesis: string; primarySegment: string } => Boolean(t));
    const concepts = (
      await Promise.all(
        selectedTerritories.map((t) =>
          this.specifyBrand(t).catch((e) => {
            console.warn(`[council] failed to specify '${t.name}': ${e.message}`);
            return null;
          }),
        ),
      )
    ).filter((c): c is BrandConcept => c !== null);

    const diversity: DiversityReport = {
      requested: count,
      distinctWedgeCount: sel.distinctWedgeCount,
      spannedWedges: sel.spannedWedges,
      poolSize: pool.length,
      rerolled,
      warning,
    };
    return { concepts, diversity };
  }
```

IMPORTANT mapping note: `selectDiverse` returns `territoryIndex` values. After a re-roll the combined tags carry re-based indices (`+ pool.length` for the second pool), and `combinedPool` is index-aligned to those same positions, so `pool[idx]` recovers the territory. Verify the selected-territory mapping returns the right territory objects (the test's `specifyBrand` stub echoes the name, so a wrong mapping will fail the integration test). If the index arithmetic is fragile, simplify by storing the territory reference directly on `WedgeTag` instead — but only if needed; prefer the index approach to keep `WedgeTag` lean.

- [ ] **Step 5: Run to verify pass**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/council/council.test.ts`
Expected: PASS (2). Then run `bun test src/council/diversity.test.ts` to confirm no regressions (11 pass).

- [ ] **Step 6: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/council/council.ts src/council/council.test.ts
git commit -m "feat(council): over-generate + diverse-select + one bounded re-roll in generateCandidates"
```

---

## Task 4: Wire `conceptDiversity` into the tournament (report + json, additive)

**Files:**
- Modify: `src/pipeline/tournament.ts`
- Test: `src/pipeline/tournament-diversity.test.ts`

- [ ] **Step 1: Write failing report tests — create `src/pipeline/tournament-diversity.test.ts`**

```typescript
import { test, expect } from "bun:test";
import { formatReport, type TournamentOutput } from "./tournament.ts";
import type { DiversityReport } from "../council/diversity.ts";

function baseOut(div?: DiversityReport): TournamentOutput {
  return {
    categoryId: "fragrance-india",
    concepts: [],
    report: {
      totalTrials: 40,
      concepts: [],
      winner: { conceptId: "c1", name: "EcoLips", winRate: 0.4, winRateCiLow: 0.3, winRateCiHigh: 0.5, topObjections: [] },
    } as any,
    conceptDiversity: div,
  };
}

test("healthy diversity -> 'N of M distinct wedges' line, no warning", () => {
  const txt = formatReport(baseOut({
    requested: 4, distinctWedgeCount: 3, spannedWedges: ["clean", "gifting", "longevity"],
    poolSize: 16, rerolled: false,
  }));
  expect(txt).toContain("Concept diversity: 3 of 4 distinct wedges");
  expect(txt).toContain("clean");
  expect(txt).not.toContain("LOW CONCEPT DIVERSITY");
});

test("collapsed diversity -> LOW CONCEPT DIVERSITY warning line", () => {
  const txt = formatReport(baseOut({
    requested: 4, distinctWedgeCount: 1, spannedWedges: ["clean"],
    poolSize: 32, rerolled: true, warning: "lowConceptDiversity",
  }));
  expect(txt).toContain("LOW CONCEPT DIVERSITY");
  expect(txt).toContain("re-rolled");
});

test("absent conceptDiversity -> no diversity lines (non-breaking)", () => {
  const txt = formatReport(baseOut(undefined));
  expect(txt).not.toContain("Concept diversity");
  expect(txt).not.toContain("LOW CONCEPT DIVERSITY");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/tournament-diversity.test.ts`
Expected: FAIL (`conceptDiversity` not on TournamentOutput; lines not printed).

- [ ] **Step 3a: Add import + interface field in `src/pipeline/tournament.ts`**

Add near the other imports:

```typescript
import type { DiversityReport } from "../council/diversity.ts";
```

Add to the `TournamentOutput` interface (after `calibration?: CalibrationResult;`):

```typescript
  conceptDiversity?: DiversityReport;
```

- [ ] **Step 3b: Update the Council call site (line ~57-58)**

Replace:
```typescript
  const concepts = await council.generateCandidates(opts.candidates);
```
with:
```typescript
  const { concepts, diversity: conceptDiversity } = await council.generateCandidates(opts.candidates, opts.seed);
```
Keep the existing `if (concepts.length === 0) throw ...` guard. Add `conceptDiversity` to the `out` object literal alongside `calibration`.

- [ ] **Step 3c: Render diversity lines in `formatReport`**

Locate the `const cal = out.calibration; if (cal) { ... }` block. Immediately AFTER it, add:

```typescript
  const div = out.conceptDiversity;
  if (div) {
    if (div.warning === "lowConceptDiversity") {
      lines.push(
        `\u26a0 LOW CONCEPT DIVERSITY — slate spans only ${div.distinctWedgeCount} wedge` +
          `${div.distinctWedgeCount === 1 ? "" : "s"} [${div.spannedWedges.join(", ")}]` +
          `${div.rerolled ? " (re-rolled once)" : ""}. Win-rates compare near-duplicates.`,
      );
    } else {
      lines.push(
        `Concept diversity: ${div.distinctWedgeCount} of ${div.requested} distinct wedges ` +
          `[${div.spannedWedges.join(", ")}]${div.rerolled ? " (re-rolled once)" : ""}`,
      );
    }
  }
```

- [ ] **Step 4: Run report tests + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test src/pipeline/tournament-diversity.test.ts`
Expected: PASS (3).
Run: `export PATH="$HOME/.bun/bin:$PATH"; bun test`
Expected: full suite PASS (no regressions).

- [ ] **Step 5: Typecheck + commit**

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/aarav/Desktop/paper-brands-research
bun run typecheck
git add src/pipeline/tournament.ts src/pipeline/tournament-diversity.test.ts
git commit -m "feat(pipeline): surface conceptDiversity in tournament report + json (additive)"
```

---

## Task 5: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `export PATH="$HOME/.bun/bin:$PATH"; bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (prior suite + new diversity/council/report tests).

- [ ] **Step 2: Confirm clean tree, no stray artifacts**

Run: `git status --short`
Expected: clean.

- [ ] **Step 3: Review the diff against the spec**

Run: `git log --oneline concept-diversity ^main`
Confirm tasks 1-4 each produced a commit and the spec's four sections are represented.

- [ ] **Step 4: Hand back to user for review before merge.** Do NOT ff-merge to main or push without explicit user go-ahead (project git discipline).
```
