# BuyerArena Seam + Deep Negotiation Arena — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `BuyerArena` interface that both the existing single-shot arena and a new deep multi-turn negotiation arena implement, so the foundry can swap buyer simulators behind one seam, with a structured PDP-style card, engine-gated (non-sycophantic) decisions, honest abstention/error accounting, and Wilson-interval uncertainty.

**Architecture:** The current `Arena` becomes `SingleShotArena`. A new `DeepNegotiationArena` has each persona negotiate against each blind option for ~4 deliberation turns: the buyer LLM *grades* a fixed structured card (it never decides), and a pure-TS engine converts grades into an elastic willingness-to-pay (WTP) and a probabilistic buy decision. The persona picks the affordable option with the highest conviction, or abstains. Scoring is extended (additively) with abstention/error rates and Wilson 95% intervals.

**Tech Stack:** Bun + TypeScript, Zod for schemas, `bun:test` for tests (set up in Task 0). LLM via the existing provider-aware `LLMClient`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-27-buyerarena-seam-deep-arena-design.md`

---

## File structure (decomposition)

| File | Responsibility | New/Modify |
|---|---|---|
| `package.json` | add `test` script | Modify |
| `src/arena/types.ts` | `ArenaInput`, `MatchResult` (superset), `BuyerArena` interface | Create |
| `src/arena/stats.ts` | pure stats: `wilsonInterval`, `mean`, `stddev`, `makeRng` (seeded) | Create |
| `src/arena/card.ts` | `BlindCard` (structured) + `renderCardForDeep`, `renderPitchFlat`, length-normalization | Create |
| `src/brand/types.ts` | replace flat `BlindCard` with structured one | Modify |
| `src/arena/traits.ts` | `deriveTraits(persona, pack)` — foundry persona → engine 0–1 traits | Create |
| `src/arena/engine.ts` | pure WTP/conviction/decision math (port of research engine, no LLM) | Create |
| `src/arena/grader.ts` | the one LLM call per turn: buyer grades the card (`gradeCard`) | Create |
| `src/arena/negotiation.ts` | one persona vs one option: turn loop using grader + engine | Create |
| `src/arena/singleShot.ts` | the existing `Arena` logic, renamed, implements `BuyerArena` | Create (moved) |
| `src/arena/deep.ts` | `DeepNegotiationArena` implements `BuyerArena` | Create |
| `src/arena/arena.ts` | re-export shim (keep import paths stable) | Modify |
| `src/scoring/score.ts` | add `abstentionRate`, `errorRate`, Wilson CI, `degraded` | Modify |
| `src/llm/client.ts` | add timeout + backoff to `complete()` | Modify |
| `src/pipeline/tournament.ts` | use `DeepNegotiationArena`; pass seed; report new fields | Modify |

Tests live beside source as `*.test.ts` (Bun convention).

---

## Task 0: Test runner setup

**Files:**
- Modify: `package.json`
- Test: `src/arena/smoke.test.ts`

- [ ] **Step 1: Add a test script**

In `package.json`, add to `"scripts"` (after the `"winrate"` line):

```json
    "test": "bun test"
```

- [ ] **Step 2: Write a trivial passing test to prove the runner works**

Create `src/arena/smoke.test.ts`:

```typescript
import { test, expect } from "bun:test";

test("bun test runner is wired up", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 3: Run it**

Run: `bun test src/arena/smoke.test.ts`
Expected: PASS (1 pass, 0 fail).

- [ ] **Step 4: Commit**

```bash
git add package.json src/arena/smoke.test.ts
git commit -m "chore: set up bun:test runner"
```

---

## Task 1: Pure stats utilities (Wilson, seeded RNG)

**Files:**
- Create: `src/arena/stats.ts`
- Test: `src/arena/stats.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/arena/stats.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { wilsonInterval, wilsonMoePct, mean, stddev, makeRng } from "./stats.ts";

test("wilson interval is valid at p=0 (Wald would give 0)", () => {
  const { low, high } = wilsonInterval(0, 10);
  expect(low).toBe(0);
  expect(high).toBeGreaterThan(0.2); // ~0.278, not 0
});

test("wilson MoE shrinks as n grows", () => {
  expect(wilsonMoePct(0.5, 100)).toBeLessThan(wilsonMoePct(0.5, 25));
});

test("mean and stddev", () => {
  expect(mean([12, 20, 16])).toBeCloseTo(16, 5);
  expect(stddev([12, 20, 16])).toBeCloseTo(4, 5);
  expect(stddev([5])).toBe(0); // <2 points
});

test("seeded rng is deterministic per seed and differs across seeds", () => {
  const a1 = makeRng("x")();
  const a2 = makeRng("x")();
  const b = makeRng("y")();
  expect(a1).toBe(a2);
  expect(a1).not.toBe(b);
  expect(a1).toBeGreaterThanOrEqual(0);
  expect(a1).toBeLessThan(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/arena/stats.test.ts`
Expected: FAIL ("Cannot find module './stats.ts'").

- [ ] **Step 3: Implement**

Create `src/arena/stats.ts`:

```typescript
const Z_95 = 1.959963984540054;

export function wilsonInterval(
  successes: number,
  n: number,
  z = Z_95,
): { low: number; high: number; center: number; halfWidth: number } {
  if (!n || n <= 0) return { low: 0, high: 1, center: 0.5, halfWidth: 0.5 };
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  const low = Math.max(0, center - margin);
  const high = Math.min(1, center + margin);
  return { low, high, center, halfWidth: Math.max(high - phat, phat - low) };
}

export function wilsonMoePct(p: number, n: number): number {
  return wilsonInterval(Math.round(p * n), n).halfWidth * 100;
}

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1));
}

/** Deterministic seeded RNG (mulberry32 over a string-hashed seed). */
export function makeRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/arena/stats.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/stats.ts src/arena/stats.test.ts
git commit -m "feat(arena): pure stats utils (Wilson interval, seeded RNG)"
```

---

## Task 2: Structured BlindCard + renderers

**Files:**
- Modify: `src/brand/types.ts` (replace `BlindCard`)
- Create: `src/arena/card.ts`
- Test: `src/arena/card.test.ts`

- [ ] **Step 1: Replace the flat BlindCard in `src/brand/types.ts`**

Replace the existing `BlindCard` interface (lines ~25-33) with:

```typescript
/**
 * Blind card shown to buyer agents. Structured like a product page so the deep
 * arena can render distinct sections; `pitch` is a flat fallback for the
 * single-shot arena. Identity is reduced to a neutral OPTION-x label.
 */
export interface BlindCard {
  label: string;        // e.g. "OPTION-A"
  headline: string;
  body: string;         // positioning + promise, in brand voice (or neutral for competitors)
  claims: string[];
  format: string;
  priceMinor: number;
  pitch: string;        // flat fallback for SingleShotArena
}
```

- [ ] **Step 2: Write the failing test**

Create `src/arena/card.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { renderCardForDeep, renderPitchFlat, normalizeLen } from "./card.ts";
import type { BlindCard } from "../brand/types.ts";

const card: BlindCard = {
  label: "OPTION-A",
  headline: "Fade dark spots, gently",
  body: "Clinical pigmentation care for sensitive skin.",
  claims: ["10% niacinamide", "fragrance-free"],
  format: "30ml serum",
  priceMinor: 69900,
  pitch: "flat fallback",
};

test("deep render includes structured sections and price in major units", () => {
  const out = renderCardForDeep(card, "INR");
  expect(out).toContain("OPTION-A");
  expect(out).toContain("Fade dark spots");
  expect(out).toContain("10% niacinamide");
  expect(out).toContain("699"); // 69900 minor -> 699 major
  expect(out).toContain("30ml serum");
});

test("flat pitch render is a single line for single-shot", () => {
  const out = renderPitchFlat(card, "INR");
  expect(out.split("\n").length).toBe(1);
  expect(out).toContain("699");
});

test("normalizeLen truncates to a word budget without cutting mid-word", () => {
  const r = normalizeLen("one two three four five", 3);
  expect(r).toBe("one two three");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun test src/arena/card.test.ts`
Expected: FAIL ("Cannot find module './card.ts'").

- [ ] **Step 4: Implement `src/arena/card.ts`**

```typescript
import type { BlindCard } from "../brand/types.ts";

/** Cap text to a word budget without cutting a word in half. */
export function normalizeLen(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text.trim() : words.slice(0, maxWords).join(" ");
}

const major = (minor: number) => Math.round(minor / 100);

/** Deep arena: render the structured sections so the PDP structure is actually used. */
export function renderCardForDeep(c: BlindCard, currency: string): string {
  return [
    `${c.label}`,
    `Headline: ${c.headline}`,
    `About: ${c.body}`,
    `Claims: ${c.claims.join(", ")}`,
    `Format: ${c.format}`,
    `Price: ${major(c.priceMinor)} ${currency}`,
  ].join("\n");
}

/** Single-shot arena: one flat line (back-compat with existing prompt). */
export function renderPitchFlat(c: BlindCard, currency: string): string {
  return (
    `${c.body} Key claims: ${c.claims.join(", ")}. ` +
    `Price: ${major(c.priceMinor)} ${currency}. Format: ${c.format}.`
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `bun test src/arena/card.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 6: Commit**

```bash
git add src/brand/types.ts src/arena/card.ts src/arena/card.test.ts
git commit -m "feat(arena): structured PDP BlindCard + deep/flat renderers"
```

---

## Task 3: Card builders (concept + competitor, with voice neutralization)

**Files:**
- Create: `src/arena/cardBuild.ts`
- Test: `src/arena/cardBuild.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/arena/cardBuild.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { cardFromConcept, cardFromArchetype } from "./cardBuild.ts";
import type { BrandConcept } from "../brand/types.ts";
import type { CompetitorArchetype } from "../categories/types.ts";

const concept = {
  id: "c1", name: "X", positioning: "Clinical care", targetCustomer: "t",
  coreInsight: "i", productPromise: "Fades spots in 8 weeks", heroSku: "30ml serum",
  priceMinor: 69900, priceBand: "mid", tagline: "Spotless, gently",
  claims: ["10% niacinamide", "fragrance-free"], packagingDirection: "p",
  brandVoice: "calm clinical", landingHeadline: "Fade dark spots, gently",
  topAdAngles: [], objections: [], launchRisks: [],
} as BrandConcept;

const archetype = {
  codeName: "ALPHA", description: "Premium derm brand", pricePositioning: "premium",
  claims: ["patented complex"], strengths: [], weaknesses: [], evidence: [], realExamples: [],
} as CompetitorArchetype;

test("concept card uses landingHeadline and brand voice body", () => {
  const card = cardFromConcept(concept, "OPTION-A");
  expect(card.label).toBe("OPTION-A");
  expect(card.headline).toBe("Fade dark spots, gently");
  expect(card.priceMinor).toBe(69900);
  expect(card.claims).toContain("10% niacinamide");
});

test("competitor card is built at the given price and carries claims", () => {
  const card = cardFromArchetype(archetype, "OPTION-B", 150000);
  expect(card.priceMinor).toBe(150000);
  expect(card.claims).toContain("patented complex");
  expect(card.headline.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/arena/cardBuild.test.ts`
Expected: FAIL ("Cannot find module './cardBuild.ts'").

- [ ] **Step 3: Implement `src/arena/cardBuild.ts`**

```typescript
import type { BlindCard, BrandConcept } from "../brand/types.ts";
import type { CompetitorArchetype } from "../categories/types.ts";
import { normalizeLen, renderPitchFlat } from "./card.ts";

// Word budgets keep all cards comparable so the buyer can't pick on verbosity.
const HEAD = 12, BODY = 40;

export function cardFromConcept(c: BrandConcept, label: string): BlindCard {
  const headline = normalizeLen(c.landingHeadline || c.tagline || c.positioning, HEAD);
  // Candidate keeps its brand voice (no pretraining footprint to leak).
  const body = normalizeLen(`${c.positioning}. ${c.productPromise}`, BODY);
  const card: BlindCard = {
    label, headline, body, claims: c.claims.slice(0, 5),
    format: c.heroSku, priceMinor: c.priceMinor, pitch: "",
  };
  card.pitch = renderPitchFlat(card, "");
  return card;
}

export function cardFromArchetype(
  a: CompetitorArchetype,
  label: string,
  priceMinor: number,
): BlindCard {
  // Competitor: NEUTRAL register (paraphrase description), so a signature voice
  // can't de-anonymize a real brand. Use the archetype description as a plain claim.
  const headline = normalizeLen(a.description, HEAD);
  const body = normalizeLen(`${a.description} Positioning: ${a.pricePositioning}.`, BODY);
  const card: BlindCard = {
    label, headline, body, claims: a.claims.slice(0, 5),
    format: "standard", priceMinor, pitch: "",
  };
  card.pitch = renderPitchFlat(card, "");
  return card;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/arena/cardBuild.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/cardBuild.ts src/arena/cardBuild.test.ts
git commit -m "feat(arena): card builders with competitor voice neutralization + length cap"
```

---

## Task 4: deriveTraits (foundry persona → engine traits)

**Files:**
- Create: `src/arena/traits.ts`
- Test: `src/arena/traits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/arena/traits.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { deriveTraits } from "./traits.ts";
import type { Persona } from "../personas/cohort.ts";
import type { CategoryPack } from "../categories/types.ts";

const pack = {
  currency: "INR",
  priceBands: [
    { label: "budget", lowMinor: 20000, highMinor: 50000 },
    { label: "mid", lowMinor: 50000, highMinor: 100000 },
    { label: "premium", lowMinor: 100000, highMinor: 200000 },
  ],
} as CategoryPack;

const base: Persona = {
  id: "p1", segment: "s", name: "n", age: 30, context: "c",
  budgetSensitivity: "high", primaryNeed: "x", anxieties: ["got a rash once"],
  decisionStyle: "cautious researcher", shoppingContext: "browsing",
};

test("traits are in 0..1 and basePMax anchors to category median band (not an option)", () => {
  const t = deriveTraits(base, pack, "seedA");
  for (const k of ["skepticism", "impulsivity", "priceConsciousness"] as const) {
    expect(t[k]).toBeGreaterThanOrEqual(0);
    expect(t[k]).toBeLessThanOrEqual(1);
  }
  // median band is "mid" (50000..100000) => anchor near its midpoint, scaled by budget sensitivity.
  expect(t.basePMax).toBeGreaterThan(20000);
  expect(t.basePMax).toBeLessThan(150000);
  expect(t.reluctancePrior).toContain("rash");
});

test("high budgetSensitivity => higher priceConsciousness than low", () => {
  const hi = deriveTraits({ ...base, budgetSensitivity: "high" }, pack, "s");
  const lo = deriveTraits({ ...base, budgetSensitivity: "low" }, pack, "s");
  expect(hi.priceConsciousness).toBeGreaterThan(lo.priceConsciousness);
});

test("same seed deterministic; different seed differs (jitter present)", () => {
  const a = deriveTraits(base, pack, "seedA");
  const b = deriveTraits(base, pack, "seedA");
  const c = deriveTraits(base, pack, "seedB");
  expect(a.skepticism).toBe(b.skepticism);
  expect(a.skepticism).not.toBe(c.skepticism);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/arena/traits.test.ts`
Expected: FAIL ("Cannot find module './traits.ts'").

- [ ] **Step 3: Implement `src/arena/traits.ts`**

```typescript
import type { Persona } from "../personas/cohort.ts";
import type { CategoryPack } from "../categories/types.ts";
import { makeRng } from "./stats.ts";

export interface EngineTraits {
  basePMax: number;        // minor units; CATEGORY-anchored, not option-anchored
  skepticism: number;      // 0..1
  impulsivity: number;     // 0..1
  priceConsciousness: number; // 0..1
  reluctancePrior: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Median price band midpoint = the category price level the base budget anchors to. */
function categoryAnchorMinor(pack: CategoryPack): number {
  const bands = pack.priceBands ?? [];
  if (!bands.length) return 50000;
  const sorted = [...bands].sort((a, b) => (a.lowMinor + a.highMinor) - (b.lowMinor + b.highMinor));
  const mid = sorted[Math.floor(sorted.length / 2)]!;
  return Math.round((mid.lowMinor + mid.highMinor) / 2);
}

export function deriveTraits(persona: Persona, pack: CategoryPack, seed: string): EngineTraits {
  const rng = makeRng(`${seed}::${persona.id}`);
  const jitter = (center: number, spread = 0.15) => clamp01(center + (rng() - 0.5) * 2 * spread);

  const bs = persona.budgetSensitivity; // "low" | "medium" | "high"
  const priceBase = bs === "high" ? 0.8 : bs === "low" ? 0.25 : 0.5;

  // Decision style nudges skepticism/impulsivity by simple keyword cues.
  const style = (persona.decisionStyle ?? "").toLowerCase();
  const skepBase = /caut|research|skeptic|careful|analy/.test(style) ? 0.7 : 0.45;
  const impBase = /impulse|quick|spontaneous|whim|emotional/.test(style) ? 0.7 : 0.35;

  // Budget: anchor to category, then reduce by price sensitivity (frugal => lower WTP).
  const anchor = categoryAnchorMinor(pack);
  const budgetMultiplier = bs === "high" ? 0.7 : bs === "low" ? 1.2 : 0.95;
  const basePMax = Math.round(anchor * budgetMultiplier);

  return {
    basePMax,
    skepticism: jitter(skepBase),
    impulsivity: jitter(impBase),
    priceConsciousness: jitter(priceBase),
    reluctancePrior: (persona.anxieties ?? []).join("; ") || "general skepticism about new brands",
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/arena/traits.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/traits.ts src/arena/traits.test.ts
git commit -m "feat(arena): deriveTraits — foundry persona to engine traits (category-anchored budget)"
```

---

## Task 5: Pure decision engine (WTP + conviction + decision)

**Files:**
- Create: `src/arena/engine.ts`
- Test: `src/arena/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/arena/engine.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { computeWtp, decide, type Grades } from "./engine.ts";
import { makeRng } from "./stats.ts";

const base = { basePMax: 10000, skepticism: 0.5, impulsivity: 0.4, priceConsciousness: 0.5, reluctancePrior: "x" };
const g = (o: Partial<Grades> = {}): Grades => ({
  traumaResolutionScore: 0, valueScore: 0, pressureScore: 0,
  impulseTriggers: { scarcity: false, socialProof: false, novelty: false, emotionalAppeal: false },
  desiredAction: "STILL_OBJECTING", ...o,
});

test("high value with no pressure stretches WTP above base", () => {
  const { wtp } = computeWtp(base, g({ valueScore: 9 }), 0);
  expect(wtp).toBeGreaterThan(base.basePMax);
});

test("impulse triggers gated by impulsivity trait", () => {
  const triggers = { scarcity: true, socialProof: true, novelty: false, emotionalAppeal: true };
  const impulsive = computeWtp({ ...base, impulsivity: 0.9 }, g({ impulseTriggers: triggers }), 0).wtp;
  const disciplined = computeWtp({ ...base, impulsivity: 0.1 }, g({ impulseTriggers: triggers }), 0).wtp;
  expect(impulsive).toBeGreaterThan(disciplined);
});

test("sustained pressure on a skeptic shrinks WTP below base (anti-sycophancy)", () => {
  const { wtp } = computeWtp({ ...base, skepticism: 0.9 }, g({ pressureScore: 8 }), 1.0);
  expect(wtp).toBeLessThan(base.basePMax);
});

test("price above WTP never buys", () => {
  const out = decide(base, g({ valueScore: 9 }), 20000 /*wtp*/, 30000 /*price*/, 4, 0, makeRng("z"));
  expect(out.decision).toBe("PUSH_BACK");
});

test("final turn: convinced + affordable buys with high probability", () => {
  let buys = 0;
  for (let i = 0; i < 500; i++) {
    const out = decide({ ...base, skepticism: 0.2 }, g({ valueScore: 9, traumaResolutionScore: 8, desiredAction: "WANT_TO_BUY" }),
      15000, 10000, 4, 0, makeRng("seed" + i));
    if (out.decision === "BUY") buys++;
  }
  expect(buys / 500).toBeGreaterThan(0.5);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/arena/engine.test.ts`
Expected: FAIL ("Cannot find module './engine.ts'").

- [ ] **Step 3: Implement `src/arena/engine.ts`**

```typescript
import type { EngineTraits } from "./traits.ts";

export interface Grades {
  traumaResolutionScore: number; // 0..10
  valueScore: number;            // 0..10
  pressureScore: number;         // 0..10
  impulseTriggers: { scarcity: boolean; socialProof: boolean; novelty: boolean; emotionalAppeal: boolean };
  desiredAction: "WANT_TO_BUY" | "STILL_OBJECTING" | "WALKING_AWAY";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const g01 = (v: number) => clamp(Number(v) || 0, 0, 10) / 10;

export function computeWtp(
  t: EngineTraits,
  grades: Grades,
  cumulativePressure: number,
): { wtp: number; breakdown: { trustGain: number; valueGain: number; impulseGain: number; pressurePenalty: number } } {
  const base = t.basePMax;
  const trauma = g01(grades.traumaResolutionScore);
  const value = g01(grades.valueScore);
  const tr = grades.impulseTriggers;
  const triggerCount = (tr.scarcity ? 1 : 0) + (tr.socialProof ? 1 : 0) + (tr.novelty ? 1 : 0) + (tr.emotionalAppeal ? 1 : 0);

  const trustGain = base * trauma * 0.5;
  const valueGain = base * value * 0.45;
  const impulseGain = base * (triggerCount * 0.12) * t.impulsivity;
  const pressurePenalty = base * cumulativePressure * (0.25 + 0.5 * t.skepticism);

  const raw = base + trustGain + valueGain + impulseGain - pressurePenalty;
  const wtp = Math.max(Math.round(raw), Math.round(base * 0.7));
  return {
    wtp,
    breakdown: {
      trustGain: Math.round(trustGain), valueGain: Math.round(valueGain),
      impulseGain: Math.round(impulseGain), pressurePenalty: Math.round(pressurePenalty),
    },
  };
}

export interface Decision { decision: "BUY" | "PUSH_BACK" | "REJECT"; conviction: number }

export function decide(
  t: EngineTraits,
  grades: Grades,
  wtp: number,
  price: number,
  turn: number,
  cumulativePressure: number,
  rng: () => number,
): Decision {
  if (price > wtp) return { decision: "PUSH_BACK", conviction: 0 };

  const value = g01(grades.valueScore);
  const trauma = g01(grades.traumaResolutionScore);
  const headroom = clamp((wtp - price) / Math.max(wtp, 1), 0, 1);
  let conviction =
    0.55 * value + 0.30 * trauma + 0.15 * headroom -
    0.35 * t.skepticism * (1 - trauma) - 0.40 * cumulativePressure;
  conviction = clamp(conviction, 0, 1);

  const wantsOut = grades.desiredAction === "WALKING_AWAY";

  if (turn >= 4) {
    return rng() < conviction ? { decision: "BUY", conviction } : { decision: "REJECT", conviction };
  }
  if (wantsOut && conviction < 0.25) return { decision: "REJECT", conviction };
  const buyProb = clamp(conviction - 0.15, 0, 1);
  if (rng() < buyProb) return { decision: "BUY", conviction };
  return { decision: "PUSH_BACK", conviction };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/arena/engine.test.ts`
Expected: PASS (5 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/engine.ts src/arena/engine.test.ts
git commit -m "feat(arena): pure WTP/conviction/decision engine (anti-sycophantic, seeded)"
```

---

## Task 6: Buyer grader (the one LLM call per turn)

**Files:**
- Create: `src/arena/grader.ts`
- Test: `src/arena/grader.test.ts` (validates the Zod parse + prompt assembly, mocking the LLM)

- [ ] **Step 1: Write the failing test**

Create `src/arena/grader.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { GradesSchema, buildGraderPrompt } from "./grader.ts";

test("GradesSchema accepts a well-formed grade object", () => {
  const parsed = GradesSchema.parse({
    traumaResolutionScore: 7, valueScore: 6, pressureScore: 2,
    impulseTriggers: { scarcity: true, socialProof: false, novelty: false, emotionalAppeal: false },
    desiredAction: "STILL_OBJECTING", spokenObjection: "is it safe?",
  });
  expect(parsed.valueScore).toBe(6);
  expect(parsed.impulseTriggers.scarcity).toBe(true);
});

test("GradesSchema coerces/repairs an out-of-range score and bad action", () => {
  const parsed = GradesSchema.parse({
    traumaResolutionScore: 99, valueScore: -5, pressureScore: 3,
    impulseTriggers: {}, desiredAction: "MAYBE", spokenObjection: "",
  });
  expect(parsed.traumaResolutionScore).toBeLessThanOrEqual(10);
  expect(parsed.valueScore).toBeGreaterThanOrEqual(0);
  expect(parsed.desiredAction).toBe("STILL_OBJECTING"); // fallback
});

test("prompt is third-person and contains the rendered card + persona traits", () => {
  const p = buildGraderPrompt(
    "OPTION-A\nHeadline: hi\nClaims: x\nPrice: 699 INR",
    { name: "Asha", demographic: "30, designer", reluctancePrior: "rash once", skepticism: 0.8, impulsivity: 0.3, priceConsciousness: 0.6 } as any,
    2,
  );
  expect(p).toContain("OPTION-A");
  expect(p).toContain("Asha");
  expect(p).toContain("rash once");
  expect(p.toLowerCase()).toContain("do not"); // anti-sycophancy clause
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/arena/grader.test.ts`
Expected: FAIL ("Cannot find module './grader.ts'").

- [ ] **Step 3: Implement `src/arena/grader.ts`**

```typescript
import { z } from "zod";
import { LLMClient } from "../llm/client.ts";
import { loadConfig } from "../config.ts";
import type { EngineTraits } from "./traits.ts";
import type { Grades } from "./engine.ts";

const score10 = z.preprocess(
  (v) => Math.max(0, Math.min(10, Number(v) || 0)),
  z.number(),
);

export const GradesSchema = z.object({
  traumaResolutionScore: score10,
  valueScore: score10,
  pressureScore: score10,
  impulseTriggers: z
    .object({
      scarcity: z.boolean().default(false),
      socialProof: z.boolean().default(false),
      novelty: z.boolean().default(false),
      emotionalAppeal: z.boolean().default(false),
    })
    .default({ scarcity: false, socialProof: false, novelty: false, emotionalAppeal: false }),
  desiredAction: z
    .enum(["WANT_TO_BUY", "STILL_OBJECTING", "WALKING_AWAY"])
    .catch("STILL_OBJECTING"),
  spokenObjection: z.string().default(""),
});

export function buildGraderPrompt(renderedCard: string, t: EngineTraits & { name?: string; demographic?: string }, turn: number): string {
  return (
    `You are a rigorous behavioral analyst grading a shopper's reaction to a product page. ` +
    `You are NOT the shopper and you do NOT want to please anyone. Real skeptical shoppers ` +
    `do NOT cave to nice copy or discounts; many get MORE suspicious. Reward genuine evidence, ` +
    `punish hype. This is turn ${turn} of 4 of the shopper's deliberation.\n\n` +
    `[SHOPPER]\n` +
    `Name: ${t.name ?? "Shopper"}\n` +
    `Deep reluctance / past trauma: ${t.reluctancePrior}\n` +
    `Skepticism: ${t.skepticism} | Impulsivity: ${t.impulsivity} | PriceConsciousness: ${t.priceConsciousness}\n\n` +
    `[PRODUCT PAGE — fixed, the shopper re-reads it]\n${renderedCard}\n\n` +
    `Surface the shopper's single most pressing remaining objection this turn, and grade how well ` +
    `the page ALREADY addresses it. Be strict; most turns are not a 9 or 10.\n` +
    `Return JSON: { "traumaResolutionScore":0-10, "valueScore":0-10, "pressureScore":0-10, ` +
    `"impulseTriggers": {"scarcity":bool,"socialProof":bool,"novelty":bool,"emotionalAppeal":bool}, ` +
    `"desiredAction":"WANT_TO_BUY"|"STILL_OBJECTING"|"WALKING_AWAY", "spokenObjection":"..." }`
  );
}

export async function gradeCard(
  renderedCard: string,
  traits: EngineTraits & { name?: string; demographic?: string },
  turn: number,
  llm = new LLMClient(),
): Promise<Grades & { spokenObjection: string }> {
  const raw = await llm.completeJson<unknown>({
    model: loadConfig().simModel,
    temperature: 0.4,
    messages: [{ role: "user", content: buildGraderPrompt(renderedCard, traits, turn) }],
  });
  return GradesSchema.parse(raw);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/arena/grader.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/grader.ts src/arena/grader.test.ts
git commit -m "feat(arena): buyer grader — third-person card grading + tolerant Zod schema"
```

---

## Task 7: Single negotiation (one persona vs one option)

**Files:**
- Create: `src/arena/negotiation.ts`
- Test: `src/arena/negotiation.test.ts` (injects a fake grader so it's deterministic, no LLM)

- [ ] **Step 1: Write the failing test**

Create `src/arena/negotiation.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { negotiate } from "./negotiation.ts";
import type { Grades } from "./engine.ts";

const traits = { basePMax: 10000, skepticism: 0.3, impulsivity: 0.4, priceConsciousness: 0.5, reluctancePrior: "x" };
const card = { label: "OPTION-A", headline: "h", body: "b", claims: ["c"], format: "f", priceMinor: 8000, pitch: "p" };

const fixedGrader = (g: Partial<Grades>) => async () => ({
  traumaResolutionScore: 0, valueScore: 0, pressureScore: 0,
  impulseTriggers: { scarcity: false, socialProof: false, novelty: false, emotionalAppeal: false },
  desiredAction: "STILL_OBJECTING", spokenObjection: "o", ...g,
});

test("strong value + affordable price => bought with conviction and a final WTP", async () => {
  const r = await negotiate(traits, card, "INR", "seed1",
    fixedGrader({ valueScore: 10, traumaResolutionScore: 9, desiredAction: "WANT_TO_BUY" }));
  expect(r.bought).toBe(true);
  expect(r.finalWtp).toBeGreaterThanOrEqual(card.priceMinor);
  expect(r.conviction).toBeGreaterThan(0);
});

test("price above any reachable WTP => not bought, affordable=false", async () => {
  const dear = { ...card, priceMinor: 100000 };
  const r = await negotiate(traits, dear, "INR", "seed1", fixedGrader({ valueScore: 1 }));
  expect(r.bought).toBe(false);
  expect(r.affordable).toBe(false);
});

test("grader error mid-run is tolerated (option scored 0, not a crash)", async () => {
  const throwing = async () => { throw new Error("llm down"); };
  const r = await negotiate(traits, card, "INR", "seed1", throwing as any);
  expect(r.errored).toBe(true);
  expect(r.conviction).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/arena/negotiation.test.ts`
Expected: FAIL ("Cannot find module './negotiation.ts'").

- [ ] **Step 3: Implement `src/arena/negotiation.ts`**

```typescript
import type { BlindCard } from "../brand/types.ts";
import type { EngineTraits } from "./traits.ts";
import { computeWtp, decide, type Grades } from "./engine.ts";
import { renderCardForDeep } from "./card.ts";
import { makeRng } from "./stats.ts";
import { gradeCard } from "./grader.ts";

export interface NegotiationOutcome {
  conviction: number;
  finalWtp: number;
  affordable: boolean;
  bought: boolean;
  turns: number;
  errored: boolean;
  lastObjection: string;
}

type GraderFn = (
  card: string,
  traits: EngineTraits,
  turn: number,
) => Promise<Grades & { spokenObjection: string }>;

const MAX_TURNS = 4;

/** One persona deliberating over one FIXED card across up to 4 turns. */
export async function negotiate(
  traits: EngineTraits,
  card: BlindCard,
  currency: string,
  seed: string,
  grader: GraderFn = gradeCard,
): Promise<NegotiationOutcome> {
  const rng = makeRng(`${seed}::${card.label}`);
  const rendered = renderCardForDeep(card, currency);
  let cumulativePressure = 0;
  let wtp = traits.basePMax;
  let conviction = 0;
  let lastObjection = "";

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let grades: Grades & { spokenObjection: string };
    try {
      grades = await grader(rendered, traits, turn);
    } catch {
      return { conviction: 0, finalWtp: wtp, affordable: card.priceMinor <= wtp, bought: false, turns: turn, errored: true, lastObjection };
    }
    lastObjection = grades.spokenObjection || lastObjection;

    const turnPressure = Math.max(0, Math.min(10, grades.pressureScore)) / 10;
    cumulativePressure = Math.max(0, Math.min(1.5, cumulativePressure * 0.6 + turnPressure));

    wtp = computeWtp(traits, grades, cumulativePressure).wtp;
    const d = decide(traits, grades, wtp, card.priceMinor, turn, cumulativePressure, rng);
    conviction = d.conviction;

    if (d.decision === "BUY") return { conviction, finalWtp: wtp, affordable: true, bought: true, turns: turn, errored: false, lastObjection };
    if (d.decision === "REJECT") return { conviction, finalWtp: wtp, affordable: card.priceMinor <= wtp, bought: false, turns: turn, errored: false, lastObjection };
  }
  return { conviction, finalWtp: wtp, affordable: card.priceMinor <= wtp, bought: false, turns: MAX_TURNS, errored: false, lastObjection };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/arena/negotiation.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/negotiation.ts src/arena/negotiation.test.ts
git commit -m "feat(arena): single-option negotiation loop (grader + engine, error-tolerant)"
```

---

## Task 8: Arena interface + SingleShotArena (rename existing)

**Files:**
- Create: `src/arena/types.ts`
- Create: `src/arena/singleShot.ts` (moved from `arena.ts`)
- Modify: `src/arena/arena.ts` (becomes a re-export shim)
- Test: `src/arena/singleShot.test.ts`

- [ ] **Step 1: Create `src/arena/types.ts`**

```typescript
import type { BrandConcept } from "../brand/types.ts";
import type { Persona } from "../personas/cohort.ts";
import type { CategoryPack } from "../categories/types.ts";

export interface ArenaInput {
  candidates: BrandConcept[];
  cohort: Persona[];
  pack: CategoryPack;
  opts?: { includeCompetitors?: boolean; seed?: number };
}

export interface MatchResult {
  personaId: string;
  segment: string;
  pickedConceptId: string;
  pickedLabel: string;
  willingnessToPayMinor: number;
  reason: string;
  topObjection: string;
  // optional enrichment from richer arenas:
  confidence?: number;
  abstained?: boolean;
  errored?: boolean;
  perOptionWtpMinor?: Record<string, number>;
  turnsToDecision?: number;
}

export interface BuyerArena {
  readonly kind: "single-shot" | "deep-negotiation";
  readonly costClass: "cheap" | "expensive";
  run(input: ArenaInput): Promise<MatchResult[]>;
}
```

- [ ] **Step 2: Create `src/arena/singleShot.ts` by moving the current Arena**

Copy the entire current contents of `src/arena/arena.ts` into `src/arena/singleShot.ts`, then make these edits:
1. Rename the class `Arena` → `SingleShotArena`.
2. Add `implements BuyerArena` and the two readonly fields at the top of the class body:
   ```typescript
   readonly kind = "single-shot" as const;
   readonly costClass = "cheap" as const;
   ```
3. Change `run(candidates, cohort, opts)` signature to `run(input: ArenaInput)` and destructure at the top:
   ```typescript
   async run(input: ArenaInput): Promise<MatchResult[]> {
     const { candidates, cohort } = input;
     const includeCompetitors = input.opts?.includeCompetitors ?? true;
   ```
4. In the `.catch(() => null); if (!choice) return;` path, instead push an abstained/errored result:
   ```typescript
   const choice = await this.ask(persona, slate.map((e) => e.card)).catch(() => null);
   if (!choice) {
     results.push({
       personaId: persona.id, segment: persona.segment, pickedConceptId: "",
       pickedLabel: "", willingnessToPayMinor: 0, reason: "", topObjection: "",
       errored: true,
     });
     return;
   }
   ```
5. Update imports: import `BuyerArena, ArenaInput, MatchResult` from `./types.ts` (remove the local `MatchResult` interface that previously lived in `arena.ts`).
6. Update `cardFromConcept`/`cardFromArchetype` usage to the new builders from `./cardBuild.ts` (import them), since `BlindCard` is now structured. The `ask()` method must render via `renderPitchFlat` (import from `./card.ts`) — replace `c.pitch` usage with the flat render of the structured card.

- [ ] **Step 3: Turn `src/arena/arena.ts` into a shim**

Replace the entire contents of `src/arena/arena.ts` with:

```typescript
// Back-compat shim: the arena moved to singleShot.ts and gained the BuyerArena seam.
export { SingleShotArena } from "./singleShot.ts";
export { SingleShotArena as Arena } from "./singleShot.ts";
export type { ArenaInput, MatchResult, BuyerArena } from "./types.ts";
```

- [ ] **Step 4: Write the conformance test**

Create `src/arena/singleShot.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { SingleShotArena } from "./singleShot.ts";

test("SingleShotArena advertises its kind and cost on the contract", () => {
  const a = new SingleShotArena({ currency: "INR", competitorArchetypes: [], priceBands: [] } as any);
  expect(a.kind).toBe("single-shot");
  expect(a.costClass).toBe("cheap");
  expect(typeof a.run).toBe("function");
});
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test src/arena/singleShot.test.ts`
Expected: PASS (1 pass).
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/arena/types.ts src/arena/singleShot.ts src/arena/arena.ts src/arena/singleShot.test.ts
git commit -m "refactor(arena): extract BuyerArena interface; SingleShotArena implements it (no silent drops)"
```

---

## Task 9: DeepNegotiationArena

**Files:**
- Create: `src/arena/deep.ts`
- Test: `src/arena/deep.test.ts` (inject a deterministic negotiate via a seam)

- [ ] **Step 1: Implement `src/arena/deep.ts`**

```typescript
import { loadConfig } from "../config.ts";
import type { BuyerArena, ArenaInput, MatchResult } from "./types.ts";
import type { BlindCard } from "../brand/types.ts";
import { cardFromConcept, cardFromArchetype } from "./cardBuild.ts";
import { deriveTraits } from "./traits.ts";
import { negotiate } from "./negotiation.ts";

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function midPrice(pack: ArenaInput["pack"], band: string): number {
  if (!pack.priceBands.length) return 0;
  const b =
    pack.priceBands.find((x) => x.label === band) ??
    pack.priceBands.find((x) => band.includes(x.label) || x.label.includes(band)) ??
    pack.priceBands[Math.floor(pack.priceBands.length / 2)]!;
  return Math.round((b.lowMinor + b.highMinor) / 2);
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

export class DeepNegotiationArena implements BuyerArena {
  readonly kind = "deep-negotiation" as const;
  readonly costClass = "expensive" as const;

  constructor(
    private pack: ArenaInput["pack"],
    private concurrency = loadConfig().concurrency,
    private negotiateFn = negotiate,
  ) {}

  async run(input: ArenaInput): Promise<MatchResult[]> {
    const includeCompetitors = input.opts?.includeCompetitors ?? true;
    const seed = String(input.opts?.seed ?? 0);
    const results: MatchResult[] = [];

    await pool(input.cohort, this.concurrency, async (persona) => {
      const traits = { ...deriveTraits(persona, input.pack, seed), name: persona.name };

      // Build the blind slate (candidates + disguised competitors).
      const entries: { card: BlindCard; conceptId: string }[] = [];
      input.candidates.forEach((c, i) => {
        entries.push({ card: cardFromConcept(c, `OPTION-${String.fromCharCode(65 + i)}`), conceptId: c.id });
      });
      if (includeCompetitors) {
        input.pack.competitorArchetypes.forEach((a, i) => {
          const price = midPrice(input.pack, a.pricePositioning);
          entries.push({
            card: cardFromArchetype(a, `OPTION-${String.fromCharCode(65 + input.candidates.length + i)}`, price),
            conceptId: `competitor:${a.codeName}`,
          });
        });
      }

      // Negotiate each option independently.
      const perOptionWtpMinor: Record<string, number> = {};
      let best: { entry: typeof entries[number]; conviction: number; wtp: number; turns: number; objection: string } | null = null;
      let anyErrored = false;

      for (const e of entries) {
        const o = await this.negotiateFn(traits, e.card, input.pack.currency, seed);
        perOptionWtpMinor[e.conceptId] = o.finalWtp;
        if (o.errored) { anyErrored = true; continue; }
        const affordable = e.card.priceMinor <= o.finalWtp;
        if (!affordable) continue;
        if (!best ||
            o.conviction > best.conviction ||
            (o.conviction === best.conviction && (o.finalWtp - e.card.priceMinor) > (best.wtp - best.entry.card.priceMinor))) {
          best = { entry: e, conviction: o.conviction, wtp: o.finalWtp, turns: o.turns, objection: o.lastObjection };
        }
      }

      if (!best) {
        results.push({
          personaId: persona.id, segment: persona.segment, pickedConceptId: "",
          pickedLabel: "", willingnessToPayMinor: 0, reason: "", topObjection: "",
          abstained: !anyErrored, errored: anyErrored && Object.keys(perOptionWtpMinor).length === 0,
          perOptionWtpMinor,
        });
        return;
      }

      results.push({
        personaId: persona.id, segment: persona.segment,
        pickedConceptId: best.entry.conceptId, pickedLabel: best.entry.card.label,
        willingnessToPayMinor: best.wtp, reason: `conviction ${best.conviction.toFixed(2)}`,
        topObjection: best.objection, confidence: best.conviction,
        perOptionWtpMinor, turnsToDecision: best.turns,
      });
    });

    return results;
  }
}
```

- [ ] **Step 2: Write the test (deterministic, inject negotiateFn)**

Create `src/arena/deep.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { DeepNegotiationArena } from "./deep.ts";

const pack = {
  currency: "INR",
  priceBands: [{ label: "mid", lowMinor: 50000, highMinor: 100000 }],
  competitorArchetypes: [{ codeName: "ALPHA", description: "premium", pricePositioning: "mid", claims: ["x"], strengths: [], weaknesses: [], evidence: [], realExamples: [] }],
} as any;

const candidates = [{
  id: "c1", name: "X", positioning: "p", targetCustomer: "t", coreInsight: "i",
  productPromise: "pp", heroSku: "30ml", priceMinor: 60000, priceBand: "mid",
  tagline: "tg", claims: ["c"], packagingDirection: "pd", brandVoice: "v",
  landingHeadline: "lh", topAdAngles: [], objections: [], launchRisks: [],
}] as any;

const cohort = [{ id: "p1", segment: "s", name: "Asha", age: 30, context: "c", budgetSensitivity: "medium", primaryNeed: "n", anxieties: ["a"], decisionStyle: "researcher", shoppingContext: "browsing" }] as any;

test("candidate wins when it is the only convinced+affordable option", async () => {
  // negotiate is called per CARD; distinguish by price (candidate 60000, competitor mid-band 75000).
  const byPrice = async (_t: any, card: any) => card.priceMinor <= 70000
    ? { conviction: 0.8, finalWtp: 90000, affordable: true, bought: true, turns: 2, errored: false, lastObjection: "o" }
    : { conviction: 0.1, finalWtp: 40000, affordable: false, bought: false, turns: 4, errored: false, lastObjection: "o" };
  const arena = new DeepNegotiationArena(pack, 4, byPrice as any);
  const res = await arena.run({ candidates, cohort, pack, opts: { seed: 1 } });
  expect(res).toHaveLength(1);
  expect(res[0]!.pickedConceptId).toBe("c1");
  expect(res[0]!.confidence).toBeGreaterThan(0);
});

test("abstains when nothing is affordable", async () => {
  const noneAfford = async () => ({ conviction: 0.1, finalWtp: 10000, affordable: false, bought: false, turns: 4, errored: false, lastObjection: "o" });
  const arena = new DeepNegotiationArena(pack, 4, noneAfford as any);
  const res = await arena.run({ candidates, cohort, pack, opts: { seed: 1 } });
  expect(res[0]!.abstained).toBe(true);
  expect(res[0]!.pickedConceptId).toBe("");
});

test("arena advertises kind and cost", () => {
  const arena = new DeepNegotiationArena(pack);
  expect(arena.kind).toBe("deep-negotiation");
  expect(arena.costClass).toBe("expensive");
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `bun test src/arena/deep.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/arena/deep.ts src/arena/deep.test.ts
git commit -m "feat(arena): DeepNegotiationArena — negotiate-vs-each, relative pick, honest abstention"
```

---

## Task 10: Scoring — abstention/error rates + Wilson CI + degraded

**Files:**
- Modify: `src/scoring/score.ts`
- Test: `src/scoring/score.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/scoring/score.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { score } from "./score.ts";
import type { MatchResult } from "../arena/types.ts";

const candidates = [{ id: "c1", name: "Cand" }] as any;

const mk = (over: Partial<MatchResult>): MatchResult => ({
  personaId: "p", segment: "s", pickedConceptId: "c1", pickedLabel: "OPTION-A",
  willingnessToPayMinor: 1000, reason: "r", topObjection: "o", ...over,
});

test("abstained and errored personas are not counted as competitor wins", () => {
  const results = [mk({}), mk({ abstained: true, pickedConceptId: "" }), mk({ errored: true, pickedConceptId: "" })];
  const report = score(results, candidates);
  expect(report.abstentionRate).toBeCloseTo(1 / 3, 5);
  expect(report.errorRate).toBeCloseTo(1 / 3, 5);
  // win-rate is over DECIDING personas (1 decided, 1 picked candidate => 100%).
  const cand = report.concepts.find((c) => c.conceptId === "c1")!;
  expect(cand.winRate).toBeCloseTo(1, 5);
});

test("every concept score carries a Wilson interval", () => {
  const results = [mk({}), mk({ pickedConceptId: "competitor:ALPHA" })];
  const report = score(results, candidates);
  const cand = report.concepts.find((c) => c.conceptId === "c1")!;
  expect(cand.winRateCiLow).toBeGreaterThanOrEqual(0);
  expect(cand.winRateCiHigh).toBeLessThanOrEqual(1);
  expect(cand.winRateCiHigh).toBeGreaterThan(cand.winRateCiLow);
});

test("high abstention sets degraded=true", () => {
  const results = [mk({ abstained: true, pickedConceptId: "" }), mk({ abstained: true, pickedConceptId: "" }), mk({})];
  const report = score(results, candidates);
  expect(report.degraded).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/scoring/score.test.ts`
Expected: FAIL (missing `abstentionRate`, `winRateCiLow`, etc.).

- [ ] **Step 3: Modify `src/scoring/score.ts`**

Add import at top:
```typescript
import { wilsonInterval } from "../arena/stats.ts";
```

Change `MatchResult` import to come from the arena types:
```typescript
import type { MatchResult } from "../arena/types.ts";
```

Extend `ConceptScore` with CI fields:
```typescript
export interface ConceptScore {
  conceptId: string;
  name: string;
  picks: number;
  trials: number;          // deciding trials (denominator)
  winRate: number;
  winRateCiLow: number;
  winRateCiHigh: number;
  avgWtpMinor: number;
  topObjections: string[];
}
```

Extend `ArenaReport`:
```typescript
export interface ArenaReport {
  totalTrials: number;       // all personas queried
  decidingTrials: number;    // personas who made a pick (denominator for win-rate)
  abstentionRate: number;
  errorRate: number;
  degraded: boolean;
  concepts: ConceptScore[];
  candidateShareVsField: number;
  winner: ConceptScore | null;
}
```

Rewrite the body of `score()`:
```typescript
export function score(results: MatchResult[], candidates: BrandConcept[]): ArenaReport {
  const totalTrials = results.length;
  const abstained = results.filter((r) => r.abstained).length;
  const errored = results.filter((r) => r.errored).length;
  const deciding = results.filter((r) => !r.abstained && !r.errored && r.pickedConceptId);
  const decidingTrials = deciding.length;

  const byConcept = new Map<string, MatchResult[]>();
  for (const r of deciding) {
    const arr = byConcept.get(r.pickedConceptId) ?? [];
    arr.push(r);
    byConcept.set(r.pickedConceptId, arr);
  }

  const nameFor = (id: string): string =>
    id.startsWith("competitor:") ? id.replace("competitor:", "") : candidates.find((c) => c.id === id)?.name ?? id;

  const allIds = new Set<string>([...candidates.map((c) => c.id), ...deciding.map((r) => r.pickedConceptId)]);
  const concepts: ConceptScore[] = [];
  for (const id of allIds) {
    const picks = byConcept.get(id) ?? [];
    const wtp = picks.map((p) => p.willingnessToPayMinor).filter((n) => n > 0);
    const ci = wilsonInterval(picks.length, decidingTrials);
    concepts.push({
      conceptId: id, name: nameFor(id), picks: picks.length, trials: decidingTrials,
      winRate: decidingTrials ? picks.length / decidingTrials : 0,
      winRateCiLow: ci.low, winRateCiHigh: ci.high,
      avgWtpMinor: wtp.length ? Math.round(wtp.reduce((a, b) => a + b, 0) / wtp.length) : 0,
      topObjections: topN(picks.map((p) => p.topObjection), 3),
    });
  }
  concepts.sort((a, b) => b.winRate - a.winRate);

  const candidateIds = new Set(candidates.map((c) => c.id));
  const candidatePicks = deciding.filter((r) => candidateIds.has(r.pickedConceptId)).length;
  const candidateConcepts = concepts.filter((c) => candidateIds.has(c.conceptId));

  const abstentionRate = totalTrials ? abstained / totalTrials : 0;
  const errorRate = totalTrials ? errored / totalTrials : 0;

  return {
    totalTrials, decidingTrials, abstentionRate, errorRate,
    degraded: abstentionRate > 0.5 || errorRate > 0.2,
    concepts,
    candidateShareVsField: decidingTrials ? candidatePicks / decidingTrials : 0,
    winner: candidateConcepts[0] ?? null,
  };
}
```

(Keep the existing `topN` helper at the bottom of the file.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/scoring/score.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors (tournament.ts `formatReport` still compiles — fields are additive).

- [ ] **Step 6: Commit**

```bash
git add src/scoring/score.ts src/scoring/score.test.ts
git commit -m "feat(scoring): abstention/error rates + Wilson CI + degraded flag (QUALITY F7/#6/#17)"
```

---

## Task 11: LLM client resilience (timeout + backoff)

**Files:**
- Modify: `src/llm/client.ts`
- Test: `src/llm/client.test.ts`

- [ ] **Step 1: Write the failing test (pure backoff helper)**

Create `src/llm/client.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { isRetryableStatus, backoffMs } from "./client.ts";

test("retryable statuses", () => {
  expect(isRetryableStatus(429)).toBe(true);
  expect(isRetryableStatus(503)).toBe(true);
  expect(isRetryableStatus(400)).toBe(false);
  expect(isRetryableStatus(401)).toBe(false);
});

test("backoff grows and is bounded with jitter", () => {
  const b0 = backoffMs(0), b3 = backoffMs(3);
  expect(b0).toBeGreaterThanOrEqual(0);
  expect(b0).toBeLessThanOrEqual(500);
  expect(b3).toBeLessThanOrEqual(16000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/llm/client.test.ts`
Expected: FAIL ("isRetryableStatus is not exported").

- [ ] **Step 3: Modify `src/llm/client.ts`**

Add near the top (after imports):
```typescript
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
export function isRetryableStatus(s: number): boolean { return RETRYABLE.has(s); }
export function backoffMs(attempt: number): number {
  return Math.floor(Math.random() * Math.min(16000, 500 * 2 ** attempt));
}
const TIMEOUT_MS = Number(process.env.PB_LLM_TIMEOUT_MS ?? "60000");
const MAX_RETRIES = Number(process.env.PB_LLM_MAX_RETRIES ?? "5");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

Wrap the `fetch` in `complete()` with timeout + retry. Replace the existing `const res = await fetch(...)` block plus its `if (!res.ok)` handling with:
```typescript
    let res: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        res = await fetch(`${conf.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${conf.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        if (attempt >= MAX_RETRIES) throw e;
        await sleep(backoffMs(attempt));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) break;
      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        res = null;
        continue;
      }
      const text = await res.text();
      throw new Error(`LLM request failed (${res.status}) [${ref}]: ${text.slice(0, 500)}`);
    }
    if (!res) throw new Error(`LLM request failed after retries [${ref}]`);
```

(Keep the rest of `complete()` — the JSON parse of `res` — unchanged.)

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test src/llm/client.test.ts`
Expected: PASS (2 pass).
Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/llm/client.ts src/llm/client.test.ts
git commit -m "feat(llm): timeout + exponential backoff with jitter on transient failures"
```

---

## Task 12: Wire the deep arena into the tournament (seed + report)

**Files:**
- Modify: `src/pipeline/tournament.ts`
- Test: covered by the end-to-end smoke run (Task 13)

- [ ] **Step 1: Switch the arena and pass an ArenaInput**

In `src/pipeline/tournament.ts`:
1. Replace the import `import { Arena } from "../arena/arena.ts";` with:
   ```typescript
   import { DeepNegotiationArena } from "../arena/deep.ts";
   import { SingleShotArena } from "../arena/singleShot.ts";
   ```
2. Add an option to `TournamentOptions`:
   ```typescript
   deep?: boolean;   // use the deep negotiation arena
   seed?: number;
   ```
3. Replace the arena construction + `run` call:
   ```typescript
   const arena = opts.deep ? new DeepNegotiationArena(pack) : new SingleShotArena(pack);
   const results = await arena.run({ candidates: concepts, cohort, pack, opts: { includeCompetitors: true, seed: opts.seed ?? 0 } });
   ```

- [ ] **Step 2: Surface new report fields in `formatReport`**

In `formatReport`, after the `Candidate share vs field` line, add:
```typescript
  lines.push(
    `Abstention: ${(report.abstentionRate * 100).toFixed(1)}%  |  Errors: ${(report.errorRate * 100).toFixed(1)}%` +
      (report.degraded ? "  [DEGRADED]" : ""),
  );
```
And in the leaderboard loop, append the CI to each line:
```typescript
    lines.push(
      `  ${(c.winRate * 100).toFixed(1).padStart(5)}%  ` +
        `[${(c.winRateCiLow * 100).toFixed(0)}-${(c.winRateCiHigh * 100).toFixed(0)}%]  ${c.name}${tag}` +
        (c.avgWtpMinor ? `  (avg WTP ${(c.avgWtpMinor / 100).toFixed(0)})` : ""),
    );
```
(Replace the existing leaderboard `lines.push(...)` with the version above.)

- [ ] **Step 3: Add a `--deep` / `--seed` flag in the CLI**

`src/cli.ts` parses flags via an `arg(name, default)` helper. In BOTH the `tournament`
and `winrate` cases, add these two fields to the `runTournament({...})` options object
(e.g. right after the `outDir:` line):

```typescript
      deep: arg("deep", "") === "true" || arg("deep", "") === "deep",
      seed: Number(arg("seed", "0")),
```

So the `tournament` case becomes:

```typescript
  case "tournament": {
    const out = await runTournament({
      categoryId: arg("category", "lipcare")!,
      candidates: Number(arg("candidates", "4")),
      cohortSize: Number(arg("cohort", "40")),
      outDir: arg("out", "out"),
      deep: arg("deep", "") === "true" || arg("deep", "") === "deep",
      seed: Number(arg("seed", "0")),
    });
    console.log(formatReport(out));
    break;
  }
```

Apply the same two added lines to the `winrate` case's `runTournament({...})`.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/tournament.ts src/cli.ts
git commit -m "feat(pipeline): --deep arena selection + seed; report abstention/CI"
```

---

## Task 13: End-to-end smoke test + full suite + typecheck

**Files:**
- Test: manual live run (requires API keys in `.env`)

- [ ] **Step 1: Run the full unit suite**

Run: `bun test`
Expected: all tests PASS across stats, card, cardBuild, traits, engine, grader, negotiation, singleShot, deep, score, client.

- [ ] **Step 2: Typecheck the whole project**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Live smoke run (small, cheap) — deep arena**

Run: `bun run tournament --category=lipcare --candidates=2 --cohort=3 --deep=true --seed=1 --out=out`
Expected: completes; prints a leaderboard with `[lo-hi%]` CIs and an `Abstention/Errors` line; writes `out/tournament.json`. No crash, no silently-dropped personas (deciding + abstained + errored === cohort size).

- [ ] **Step 4: Verify the output shape**

Run: `cat out/tournament.json | head -40`
Expected: `report.abstentionRate`, `report.errorRate`, `report.degraded`, and per-concept `winRateCiLow/High` present; `MatchResult`s include `confidence`/`perOptionWtpMinor` for deciding personas.

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "test: end-to-end deep-arena smoke run green"
```

---

## Done criteria

- `bun test` green; `bun run typecheck` clean.
- A live `--deep` tournament produces a coherent `tournament.json` with abstention/error rates, Wilson CIs, and the `degraded` flag.
- No persona is silently dropped (deciding + abstained + errored === cohort size).
- `SingleShotArena` still works (back-compat shim intact); both arenas satisfy `BuyerArena`.
- The deep arena emits `confidence`, `perOptionWtpMinor`, `segment`, `topObjection` per pick — the signal piece #5 (defensibility) will consume.

## Out of scope (later pieces)

Calibration layer (#2), ground-truth adapters (#3), cost-aware routing (#4), defensibility objective (#5), first-party data grounding, multimodal cards.
```
