# Real-Brand Benchmarking (Level 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put disguised real brands into the blind arena as calibration anchors, attach each an audit-only composite traction score (review volume + rating), emit a calibration-ready `(arenaWinRate, tractionScore)` table, and ship a Spearman correlation smoke-check that says whether real-brand calibration is even viable.

**Architecture:** Pure data + schema first (traction math, Spearman, schema), then the harvest extension that builds `benchmarkBrands` from scraped SKUs, then arena integration (a disguised `cardFromBenchmark`, benchmarks join the blind slate as `conceptId="benchmark:<auditId>"`), then scoring assembles `calibrationPairs` + `correlationCheck`. Everything is additive and non-breaking; the buyer LLM only ever sees neutral `OPTION-X` cards.

**Tech Stack:** Bun + TypeScript, Zod, `bun:test`. Reuses the existing `LLMClient`, harvest/prices scraping, and arena/scoring code.

**Spec:** `docs/superpowers/specs/2026-06-27-benchmark-brands-level1-design.md`

---

## File structure (decomposition)

| File | Responsibility | New/Modify |
|---|---|---|
| `src/arena/stats.ts` | add pure `spearman(pairs)` | Modify |
| `src/benchmark/traction.ts` | pure traction-score math + top-N stratified selection | Create |
| `src/categories/types.ts` | `BenchmarkBrandSchema` + pack fields (`benchmarkBrands`, `benchmarksDegraded`, `benchmarkKnownUnknowns`) | Modify |
| `src/arena/types.ts` | `CalibrationPair`, `CorrelationCheck` + optional `ArenaReport` fields | Modify |
| `src/arena/cardBuild.ts` | add `cardFromBenchmark` (disguise) | Modify |
| `src/arena/label.ts` | shared `optionLabel(i)` that survives >26 options | Create |
| `src/benchmark/harvest.ts` | build `BenchmarkBrand[]` from scraped SKUs (incl. reviews/rating) | Create |
| `src/scrape/prices.ts` | extend SKU extraction to capture `reviewCount`/`rating` | Modify |
| `src/arena/deep.ts` | benchmarks join the blind slate | Modify |
| `src/arena/singleShot.ts` | benchmarks join the blind slate | Modify |
| `src/scoring/score.ts` | build `calibrationPairs` + `correlationCheck` | Modify |
| `src/pipeline/tournament.ts` | print audit-only benchmark section + verdict | Modify |

Tests live beside source as `*.test.ts`.

**Environment note (every bun command):** bun is at `~/.bun/bin/bun`, not on PATH. Prefix with `export PATH="$HOME/.bun/bin:$PATH"`.

---

## Task 1: Spearman rank correlation (pure)

**Files:**
- Modify: `src/arena/stats.ts`
- Test: `src/arena/spearman.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/arena/spearman.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { spearman } from "./stats.ts";

test("perfect monotonic increasing => rho ~ 1", () => {
  const rho = spearman([[1, 10], [2, 20], [3, 30], [4, 40]]);
  expect(rho).toBeCloseTo(1, 5);
});

test("perfect monotonic decreasing => rho ~ -1", () => {
  const rho = spearman([[1, 40], [2, 30], [3, 20], [4, 10]]);
  expect(rho).toBeCloseTo(-1, 5);
});

test("ties handled via average ranks", () => {
  // x has a tie; should not throw and stays in [-1,1]
  const rho = spearman([[1, 5], [1, 6], [2, 7], [3, 8]]);
  expect(rho).toBeGreaterThanOrEqual(-1);
  expect(rho).toBeLessThanOrEqual(1);
});

test("fewer than 2 points => 0", () => {
  expect(spearman([[1, 1]])).toBe(0);
  expect(spearman([])).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/arena/spearman.test.ts`
Expected: FAIL ("spearman is not exported").

- [ ] **Step 3: Implement** — append to `src/arena/stats.ts`:

```typescript
/** Average-rank vector for tie-aware ranking. */
function averageRanks(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    const avg = (i + j) / 2 + 1; // ranks are 1-based; average of the tie block
    for (let k = i; k <= j; k++) ranks[idx[k]![1]] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation of paired [x,y] values. Returns 0 for < 2 pairs. */
export function spearman(pairs: [number, number][]): number {
  const n = pairs.length;
  if (n < 2) return 0;
  const rx = averageRanks(pairs.map((p) => p[0]));
  const ry = averageRanks(pairs.map((p) => p[1]));
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx, b = ry[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0; // no variance (all tied) => undefined => 0
  return num / Math.sqrt(dx * dy);
}
```

(Uses the existing `mean` in this file.)

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/arena/spearman.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/stats.ts src/arena/spearman.test.ts
git commit -m "feat(stats): tie-aware Spearman rank correlation"
```

---

## Task 2: Traction score + top-N stratified selection (pure)

**Files:**
- Create: `src/benchmark/traction.ts`
- Test: `src/benchmark/traction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/benchmark/traction.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { tractionScore, selectBenchmarks, type BrandSku } from "./traction.ts";

const sku = (over: Partial<BrandSku>): BrandSku => ({
  brand: "B", product: "p", priceMinor: 50000, format: "stick",
  claims: ["c"], reviewCount: 0, rating: 0, retailer: "amazon", band: "mid", ...over,
});

test("volume dominates: high-reviews/lower-rating beats low-reviews/high-rating", () => {
  const big = tractionScore({ reviewCount: 80000, rating: 4.2 }, 80000);
  const small = tractionScore({ reviewCount: 50, rating: 4.8 }, 80000);
  expect(big).toBeGreaterThan(small);
  expect(big).toBeLessThanOrEqual(1);
  expect(small).toBeGreaterThanOrEqual(0);
});

test("rating maps from 3.0-5.0 band", () => {
  // rating 3.0 => qualityNorm 0; rating 5.0 => qualityNorm 1 (with same volume)
  const lo = tractionScore({ reviewCount: 100, rating: 3.0 }, 100);
  const hi = tractionScore({ reviewCount: 100, rating: 5.0 }, 100);
  expect(hi).toBeGreaterThan(lo);
});

test("selectBenchmarks dedupes to one SKU per brand, picks top-N, spans price bands", () => {
  const skus: BrandSku[] = [
    sku({ brand: "A", reviewCount: 100000, band: "budget", priceMinor: 20000 }),
    sku({ brand: "A", reviewCount: 90000, band: "budget", priceMinor: 21000 }), // dup brand
    sku({ brand: "B", reviewCount: 50000, band: "premium", priceMinor: 150000 }),
    sku({ brand: "C", reviewCount: 40000, band: "mid", priceMinor: 70000 }),
    sku({ brand: "D", reviewCount: 100, band: "mid", priceMinor: 71000 }),
  ];
  const picked = selectBenchmarks(skus, 3);
  // one entry per brand
  expect(new Set(picked.map((p) => p.brand)).size).toBe(picked.length);
  // A kept its higher-review SKU
  const a = picked.find((p) => p.brand === "A")!;
  expect(a.reviewCount).toBe(100000);
  // spans more than one band
  expect(new Set(picked.map((p) => p.band)).size).toBeGreaterThan(1);
  expect(picked.length).toBe(3);
});

test("fewer than N available => returns what exists, no padding", () => {
  const picked = selectBenchmarks([sku({ brand: "A", reviewCount: 10 })], 5);
  expect(picked.length).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/benchmark/traction.test.ts`
Expected: FAIL ("Cannot find module './traction.ts'").

- [ ] **Step 3: Implement** `src/benchmark/traction.ts`:

```typescript
export interface BrandSku {
  brand: string;
  product: string;
  priceMinor: number;
  format: string;
  claims: string[];
  reviewCount: number;
  rating: number;        // 0..5
  retailer: string;
  band: string;          // discovered price-band label
}

const W_VOL = Number(process.env.PB_TRACTION_W_VOL ?? "0.7");
const W_QUAL = Number(process.env.PB_TRACTION_W_QUAL ?? "0.3");
const RATING_FLOOR = Number(process.env.PB_TRACTION_RATING_FLOOR ?? "3.0");
const RATING_CEIL = Number(process.env.PB_TRACTION_RATING_CEIL ?? "5.0");

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Composite traction 0..1. maxReviewCount = the largest review count in the harvested set. */
export function tractionScore(
  m: { reviewCount: number; rating: number },
  maxReviewCount: number,
): number {
  const volSignal = Math.log10((m.reviewCount || 0) + 1);
  const maxSignal = Math.log10((maxReviewCount || 0) + 1) || 1; // avoid /0
  const volumeNorm = clamp01(volSignal / maxSignal);
  const span = RATING_CEIL - RATING_FLOOR || 1;
  const qualityNorm = clamp01(((m.rating || 0) - RATING_FLOOR) / span);
  return clamp01(W_VOL * volumeNorm + W_QUAL * qualityNorm);
}

/**
 * Dedupe to one SKU per brand (highest reviewCount), then select top-N by traction
 * with price-band stratification: greedily take the highest-traction brand from each
 * band in round-robin so the set spans the market, then fill remaining slots by
 * overall traction. Returns fewer than N if fewer brands exist (never pads).
 */
export function selectBenchmarks(skus: BrandSku[], n: number): BrandSku[] {
  // 1. dedupe per brand, keep most-reviewed SKU.
  const byBrand = new Map<string, BrandSku>();
  for (const s of skus) {
    const cur = byBrand.get(s.brand);
    if (!cur || s.reviewCount > cur.reviewCount) byBrand.set(s.brand, s);
  }
  const maxRc = Math.max(1, ...[...byBrand.values()].map((s) => s.reviewCount));
  const scored = [...byBrand.values()]
    .map((s) => ({ s, t: tractionScore(s, maxRc) }))
    .sort((a, b) => b.t - a.t);

  // 2. group by band, each band sorted by traction desc.
  const bands = new Map<string, { s: BrandSku; t: number }[]>();
  for (const e of scored) {
    const arr = bands.get(e.s.band) ?? [];
    arr.push(e);
    bands.set(e.s.band, arr);
  }

  // 3. round-robin across bands for spread, then fill by overall traction.
  const picked: BrandSku[] = [];
  const taken = new Set<string>();
  const bandQueues = [...bands.values()];
  let progress = true;
  while (picked.length < n && progress) {
    progress = false;
    for (const q of bandQueues) {
      if (picked.length >= n) break;
      const next = q.shift();
      if (next && !taken.has(next.s.brand)) {
        picked.push(next.s);
        taken.add(next.s.brand);
        progress = true;
      }
    }
  }
  // fill any remaining slots by overall traction order.
  for (const e of scored) {
    if (picked.length >= n) break;
    if (!taken.has(e.s.brand)) { picked.push(e.s); taken.add(e.s.brand); }
  }
  return picked;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/benchmark/traction.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add src/benchmark/traction.ts src/benchmark/traction.test.ts
git commit -m "feat(benchmark): traction score + top-N stratified selection (pure)"
```

---

## Task 3: Schema — BenchmarkBrand + pack fields

**Files:**
- Modify: `src/categories/types.ts`
- Test: `src/categories/benchmark-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/categories/benchmark-schema.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { BenchmarkBrandSchema, CategoryPackSchema } from "./types.ts";

test("BenchmarkBrand parses with defaults", () => {
  const b = BenchmarkBrandSchema.parse({
    auditId: "bm-x", realName: "X", claims: ["c"], priceMinor: 50000, format: "stick",
  });
  expect(b.tractionScore).toBe(0);
  expect(b.evidence).toEqual([]);
});

test("existing pack with NO benchmarkBrands still parses (back-compat)", () => {
  const pack = CategoryPackSchema.parse({
    id: "lipcare", name: "Lip Care", currency: "INR", geography: "India",
    unmetNeeds: [], purchaseTriggers: [], rejectionReasons: [], priceBands: [],
    competitorArchetypes: [], complianceNotes: [], buyerSegments: [],
  });
  expect(pack.benchmarkBrands).toEqual([]);
  expect(pack.benchmarksDegraded).toBe(false);
  expect(pack.benchmarkKnownUnknowns).toEqual([]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/categories/benchmark-schema.test.ts`
Expected: FAIL ("BenchmarkBrandSchema is not exported").

- [ ] **Step 3: Implement** — in `src/categories/types.ts`, add the schema before `CategoryPackSchema`:

```typescript
/**
 * A real, known brand used as a blind calibration ANCHOR. realName + the traction
 * metrics are AUDIT-ONLY — never shown to the buyer agent; only claims/price/format
 * are rendered (disguised) into the arena card.
 */
export const BenchmarkBrandSchema = z.object({
  auditId: z.string(),
  realName: z.string(),
  claims: z.array(z.string()),
  priceMinor: z.number(),
  format: z.string(),
  reviewCount: z.number().default(0),
  rating: z.number().default(0),
  retailer: z.string().default(""),
  tractionScore: z.number().default(0),
  evidence: z.array(EvidencedItemSchema).default([]),
});
export type BenchmarkBrand = z.infer<typeof BenchmarkBrandSchema>;
```

Then add these three fields inside the `CategoryPackSchema` object (e.g. after `competitorArchetypes`):

```typescript
  /** Real brands as audit-only blind calibration anchors. */
  benchmarkBrands: z.array(BenchmarkBrandSchema).default([]),
  /** True when benchmark harvest found no usable review data. */
  benchmarksDegraded: z.boolean().default(false),
  /** Declared known-unknowns for the benchmark anchors. */
  benchmarkKnownUnknowns: z.array(z.string()).default([]),
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/categories/benchmark-schema.test.ts`
Then: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck`
Expected: PASS (2 pass); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/categories/types.ts src/categories/benchmark-schema.test.ts
git commit -m "feat(schema): BenchmarkBrand + additive pack benchmark fields"
```

---

## Task 4: Shared option-label helper (fixes >26 options)

**Files:**
- Create: `src/arena/label.ts`
- Test: `src/arena/label.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/arena/label.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { optionLabel } from "./label.ts";

test("first 26 are OPTION-A..Z", () => {
  expect(optionLabel(0)).toBe("OPTION-A");
  expect(optionLabel(25)).toBe("OPTION-Z");
});

test("past 26 keeps producing distinct labels (no collision)", () => {
  expect(optionLabel(26)).not.toBe(optionLabel(0));
  expect(optionLabel(26)).toBe("OPTION-AA");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/arena/label.test.ts`
Expected: FAIL ("Cannot find module './label.ts'").

- [ ] **Step 3: Implement** `src/arena/label.ts`:

```typescript
/** Stable blind label for slate position i: A..Z, then AA, AB, ... (never collides). */
export function optionLabel(i: number): string {
  let n = i, s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `OPTION-${s}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/arena/label.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/label.ts src/arena/label.test.ts
git commit -m "feat(arena): collision-free option labels for large slates"
```

---

## Task 5: cardFromBenchmark (disguise) — the blind-control guarantee

**Files:**
- Modify: `src/arena/cardBuild.ts`
- Test: `src/arena/benchmarkCard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/arena/benchmarkCard.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { cardFromBenchmark } from "./cardBuild.ts";
import { renderCardForDeep } from "./card.ts";
import type { BenchmarkBrand } from "../categories/types.ts";

const bm = {
  auditId: "bm-secret", realName: "SecretBrandName", claims: ["10% niacinamide", "fragrance-free"],
  priceMinor: 69900, format: "30ml serum", reviewCount: 82000, rating: 4.4,
  retailer: "amazon", tractionScore: 0.91, evidence: [],
} as BenchmarkBrand;

test("benchmark card carries real claims/price/format", () => {
  const card = cardFromBenchmark(bm, "OPTION-C");
  expect(card.label).toBe("OPTION-C");
  expect(card.priceMinor).toBe(69900);
  expect(card.claims).toContain("10% niacinamide");
  expect(card.format).toBe("30ml serum");
});

test("BLIND CONTROL: rendered card leaks no name or metric", () => {
  const card = cardFromBenchmark(bm, "OPTION-C");
  const rendered = renderCardForDeep(card, "INR");
  expect(rendered).not.toContain("SecretBrandName");
  expect(rendered).not.toContain("82000");
  expect(rendered).not.toContain("4.4");
  expect(rendered).not.toContain("0.91");
  expect(rendered).not.toContain("amazon");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/arena/benchmarkCard.test.ts`
Expected: FAIL ("cardFromBenchmark is not exported").

- [ ] **Step 3: Implement** — in `src/arena/cardBuild.ts`, add an import and the function. Add to the existing imports at the top:

```typescript
import type { BenchmarkBrand } from "../categories/types.ts";
```

Then add the function (mirrors `cardFromArchetype`, reads ONLY safe fields):

```typescript
export function cardFromBenchmark(b: BenchmarkBrand, label: string): BlindCard {
  const headline = normalizeLen(b.claims[0] ?? "Established option", HEAD);
  const body = normalizeLen(b.claims.join(". "), BODY);
  return {
    label, headline, body, claims: b.claims.slice(0, 5),
    format: b.format, priceMinor: b.priceMinor, pitch: "",
  };
}
```

(Uses the existing `HEAD`/`BODY` constants and `normalizeLen` already in this file.)

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/arena/benchmarkCard.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add src/arena/cardBuild.ts src/arena/benchmarkCard.test.ts
git commit -m "feat(arena): cardFromBenchmark disguise (audit-only name/metrics never leak)"
```

---

## Task 6: Scoring — calibrationPairs + correlationCheck

**Files:**
- Modify: `src/arena/types.ts` (add output types)
- Modify: `src/scoring/score.ts`
- Test: `src/scoring/calibration.test.ts`

- [ ] **Step 1: Add output types to `src/arena/types.ts`**

Append:

```typescript
export interface CalibrationPair {
  auditId: string;
  realName: string;
  arenaWinRate: number;
  tractionScore: number;
  picks: number;
  trials: number;
}

export interface CorrelationCheck {
  n: number;
  spearmanRho: number;
  verdict: "plausible" | "weak" | "none-or-negative" | "insufficient-n";
  note: string;
}
```

And add to the `ArenaReport` interface (in `src/scoring/score.ts` where it's defined — these are optional, non-breaking):

```typescript
  calibrationPairs?: CalibrationPair[];
  correlationCheck?: CorrelationCheck;
```

(Import `CalibrationPair`, `CorrelationCheck` into score.ts from `../arena/types.ts`.)

- [ ] **Step 2: Write the failing test**

Create `src/scoring/calibration.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { buildCalibration } from "./score.ts";
import type { ConceptScore } from "./score.ts";
import type { BenchmarkBrand } from "../categories/types.ts";

const cs = (id: string, winRate: number, picks: number): ConceptScore => ({
  conceptId: id, name: id, picks, trials: 8, winRate,
  winRateCiLow: 0, winRateCiHigh: 1, avgWtpMinor: 0, topObjections: [],
});

const bm = (auditId: string, traction: number): BenchmarkBrand => ({
  auditId, realName: auditId, claims: ["c"], priceMinor: 1000, format: "f",
  reviewCount: 1, rating: 4, retailer: "r", tractionScore: traction, evidence: [{ text: "t", quote: "q", sourceUrl: "u", verified: true, independent: true }],
} as BenchmarkBrand);

test("pairs join benchmark winRate with tractionScore; rho computed", () => {
  const concepts = [
    cs("benchmark:a", 0.5, 4), cs("benchmark:b", 0.25, 2), cs("benchmark:c", 0.125, 1),
    cs("cand1", 0.125, 1),
  ];
  const benchmarks = [bm("a", 0.9), bm("b", 0.6), bm("c", 0.3)];
  const r = buildCalibration(concepts, benchmarks);
  expect(r.calibrationPairs).toHaveLength(3);
  // monotonic (higher traction -> higher winRate) => positive rho
  expect(r.correlationCheck.spearmanRho).toBeGreaterThan(0.9);
  expect(r.correlationCheck.verdict).toBe("plausible");
});

test("benchmarks with traction 0 or no evidence are excluded", () => {
  const concepts = [cs("benchmark:a", 0.5, 4), cs("benchmark:z", 0.5, 4)];
  const benchmarks = [bm("a", 0.9), { ...bm("z", 0), evidence: [] } as BenchmarkBrand];
  const r = buildCalibration(concepts, benchmarks);
  expect(r.calibrationPairs.map((p) => p.auditId)).toEqual(["a"]);
});

test("fewer than 3 pairs => insufficient-n verdict", () => {
  const r = buildCalibration([cs("benchmark:a", 0.5, 4)], [bm("a", 0.9)]);
  expect(r.correlationCheck.verdict).toBe("insufficient-n");
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/scoring/calibration.test.ts`
Expected: FAIL ("buildCalibration is not exported").

- [ ] **Step 4: Implement** — in `src/scoring/score.ts`, add imports and an exported `buildCalibration`, then call it inside `score()`.

Add imports at top:

```typescript
import { spearman } from "../arena/stats.ts";
import type { CalibrationPair, CorrelationCheck } from "../arena/types.ts";
import type { BenchmarkBrand } from "../categories/types.ts";
```

Add the helper (export it for testing):

```typescript
export function buildCalibration(
  concepts: ConceptScore[],
  benchmarks: BenchmarkBrand[],
): { calibrationPairs: CalibrationPair[]; correlationCheck: CorrelationCheck } {
  const byAudit = new Map(benchmarks.map((b) => [b.auditId, b]));
  const pairs: CalibrationPair[] = [];
  for (const c of concepts) {
    if (!c.conceptId.startsWith("benchmark:")) continue;
    const auditId = c.conceptId.slice("benchmark:".length);
    const b = byAudit.get(auditId);
    if (!b) continue;
    const evidenced = b.evidence.some((e) => e.verified);
    if (b.tractionScore <= 0 || !evidenced) continue; // no real anchor => exclude
    pairs.push({
      auditId, realName: b.realName, arenaWinRate: c.winRate,
      tractionScore: b.tractionScore, picks: c.picks, trials: c.trials,
    });
  }

  const n = pairs.length;
  let rho = 0;
  if (n >= 2) rho = spearman(pairs.map((p) => [p.arenaWinRate, p.tractionScore]));
  let verdict: CorrelationCheck["verdict"];
  if (n < 3) verdict = "insufficient-n";
  else if (rho >= 0.6) verdict = "plausible";
  else if (rho >= 0.3) verdict = "weak";
  else verdict = "none-or-negative";

  const note =
    n < 3
      ? `Only ${n} evidenced benchmark anchors; need >=3 for a read.`
      : `Spearman rho=${rho.toFixed(2)} over n=${n} (directional only, low N — smoke alarm not proof).`;

  return { calibrationPairs: pairs, correlationCheck: { n, spearmanRho: rho, verdict, note } };
}
```

Then, inside `score()`, change its signature to accept benchmarks and populate the report. Update the signature:

```typescript
export function score(
  results: MatchResult[],
  candidates: BrandConcept[],
  benchmarks: BenchmarkBrand[] = [],
): ArenaReport {
```

And just before the `return { ... }`, compute:

```typescript
  const calib = benchmarks.length ? buildCalibration(concepts, benchmarks) : undefined;
```

Add to the returned object:

```typescript
    calibrationPairs: calib?.calibrationPairs,
    correlationCheck: calib?.correlationCheck,
```

(The default `benchmarks = []` keeps all existing `score(results, candidates)` callers working.)

- [ ] **Step 5: Run to verify it passes**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/scoring/calibration.test.ts`
Then: `export PATH="$HOME/.bun/bin:$PATH" && bun test && bun run typecheck`
Expected: calibration tests pass; full suite green; typecheck clean (existing `score()` calls still compile via the default param).

- [ ] **Step 6: Commit**

```bash
git add src/arena/types.ts src/scoring/score.ts src/scoring/calibration.test.ts
git commit -m "feat(scoring): calibrationPairs + Spearman correlationCheck (benchmark anchors)"
```

---

## Task 7: Benchmarks join the blind slate (both arenas)

**Files:**
- Modify: `src/arena/deep.ts`
- Modify: `src/arena/singleShot.ts`
- Test: `src/arena/deep-benchmark.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/arena/deep-benchmark.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { DeepNegotiationArena } from "./deep.ts";

const pack = {
  currency: "INR",
  priceBands: [{ label: "mid", lowMinor: 50000, highMinor: 100000 }],
  competitorArchetypes: [],
  benchmarkBrands: [
    { auditId: "bm-a", realName: "RealA", claims: ["x"], priceMinor: 60000, format: "f", reviewCount: 100, rating: 4, retailer: "r", tractionScore: 0.8, evidence: [] },
  ],
} as any;

const candidates = [{
  id: "c1", name: "X", positioning: "p", targetCustomer: "t", coreInsight: "i",
  productPromise: "pp", heroSku: "30ml", priceMinor: 60000, priceBand: "mid",
  tagline: "tg", claims: ["c"], packagingDirection: "pd", brandVoice: "v",
  landingHeadline: "lh", topAdAngles: [], objections: [], launchRisks: [],
}] as any;

const cohort = [{ id: "p1", segment: "s", name: "Asha", age: 30, context: "c", budgetSensitivity: "medium", primaryNeed: "n", anxieties: ["a"], decisionStyle: "d", shoppingContext: "b" }] as any;

test("benchmark brand appears in the slate as a benchmark: concept (never its real name)", async () => {
  const seenCards: string[] = [];
  const recorder = async (_t: any, card: any) => {
    seenCards.push(JSON.stringify(card));
    return { conviction: 0.1, finalWtp: 0, affordable: false, bought: false, turns: 4, errored: false, lastObjection: "o" };
  };
  const arena = new DeepNegotiationArena(pack, 4, recorder as any);
  await arena.run({ candidates, cohort, pack, opts: { seed: 1, includeCompetitors: true } });
  const all = seenCards.join(" ");
  expect(all).not.toContain("RealA");           // blind control
  // 1 candidate + 1 benchmark = 2 cards negotiated
  expect(seenCards.length).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/arena/deep-benchmark.test.ts`
Expected: FAIL (only 1 card seen — benchmarks not yet in the slate).

- [ ] **Step 3: Implement in `src/arena/deep.ts`**

Add imports:

```typescript
import { cardFromBenchmark } from "./cardBuild.ts";
import { optionLabel } from "./label.ts";
```

In `run()`, the slate is built from `input.candidates` then `pack.competitorArchetypes`. Replace the hardcoded `OPTION-${String.fromCharCode(65 + i)}` label generation with `optionLabel(globalIndex)` using a running index, and append benchmarks. Concretely, restructure the entries-building block to:

```typescript
      const entries: { card: BlindCard; conceptId: string }[] = [];
      let li = 0;
      input.candidates.forEach((c) => {
        entries.push({ card: cardFromConcept(c, optionLabel(li++)), conceptId: c.id });
      });
      if (includeCompetitors) {
        pack.competitorArchetypes.forEach((a) => {
          const price = midPrice(pack, a.pricePositioning);
          entries.push({ card: cardFromArchetype(a, optionLabel(li++), price), conceptId: `competitor:${a.codeName}` });
        });
        (pack.benchmarkBrands ?? []).forEach((b) => {
          entries.push({ card: cardFromBenchmark(b, optionLabel(li++)), conceptId: `benchmark:${b.auditId}` });
        });
      }
```

- [ ] **Step 4: Apply the SAME change to `src/arena/singleShot.ts`**

Add the same two imports. In its slate-building block, replace its label generation with `optionLabel(li++)` (running index), and append the benchmark loop identically:

```typescript
        (pack.benchmarkBrands ?? []).forEach((b) => {
          entries.push({ card: cardFromBenchmark(b, optionLabel(li++)), conceptId: `benchmark:${b.auditId}` });
        });
```

(Match the existing variable names in singleShot.ts — it uses `this.pack`/`pack` and an `entries` array; convert its `String.fromCharCode` label calls to `optionLabel(li++)` with a `let li = 0;` declared before the candidate loop.)

- [ ] **Step 5: Run tests + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/arena/deep-benchmark.test.ts`
Expected: PASS.
Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test && bun run typecheck`
Expected: full suite green; typecheck clean. (Existing deep/singleShot tests still pass — packs without `benchmarkBrands` default to `[]`, so no benchmark entries are added.)

- [ ] **Step 6: Commit**

```bash
git add src/arena/deep.ts src/arena/singleShot.ts src/arena/deep-benchmark.test.ts
git commit -m "feat(arena): benchmark brands join the blind slate (both arenas)"
```

---

## Task 8: Benchmark harvest — build BenchmarkBrand[] from scraped SKUs

**Files:**
- Modify: `src/scrape/prices.ts` (capture reviewCount/rating)
- Create: `src/benchmark/harvest.ts`
- Test: `src/benchmark/harvest.test.ts`

- [ ] **Step 1: Extend the SKU extraction to capture reviews/rating**

In `src/scrape/prices.ts`:
- Add to the `PriceObservation` interface: `reviewCount?: number;` and `rating?: number;`.
- In the `RawObs` extraction prompt (the `extractObservations` user message), extend the requested JSON keys to include `"reviewCount" (number, optional), "rating" (0-5, optional)` and add the instruction: `Capture star rating and number of ratings/reviews when the listing shows them; omit if absent (do not fabricate).`
- Map them through wherever `RawObs` → `PriceObservation` is assembled (add `reviewCount: o.reviewCount, rating: o.rating`).

(This is additive; existing price logic is unaffected when the fields are absent.)

- [ ] **Step 2: Write the failing test**

Create `src/benchmark/harvest.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { benchmarksFromObservations } from "./harvest.ts";
import type { PriceObservation } from "../scrape/prices.ts";

const obs = (over: Partial<PriceObservation>): PriceObservation => ({
  brand: "B", product: "p", price: 500, reviewCount: 0, rating: 0, ...over,
} as PriceObservation);

const bands = [
  { label: "budget", lowMinor: 20000, highMinor: 50000 },
  { label: "premium", lowMinor: 100000, highMinor: 200000 },
];

test("builds audit-only benchmark brands with traction + price-band assignment", () => {
  const observations = [
    obs({ brand: "Burt", product: "balm", price: 300, reviewCount: 80000, rating: 4.5, retailer: "amazon" }),
    obs({ brand: "Lux", product: "serum", price: 1500, reviewCount: 20000, rating: 4.2, retailer: "nykaa" }),
  ];
  const { benchmarkBrands, degraded } = benchmarksFromObservations(observations, bands, 5);
  expect(degraded).toBe(false);
  expect(benchmarkBrands.length).toBe(2);
  const burt = benchmarkBrands.find((b) => b.realName === "Burt")!;
  expect(burt.auditId).toMatch(/^bm-/);
  expect(burt.priceMinor).toBe(30000); // 300 * 100
  expect(burt.tractionScore).toBeGreaterThan(0);
  expect(burt.evidence.length).toBeGreaterThanOrEqual(1); // provenance bound
});

test("no review data anywhere => degraded true, empty list", () => {
  const observations = [obs({ brand: "B", reviewCount: 0, rating: 0 })];
  const { benchmarkBrands, degraded } = benchmarksFromObservations(observations, bands, 5);
  expect(degraded).toBe(true);
  expect(benchmarkBrands).toEqual([]);
});
```

- [ ] **Step 3: Implement** `src/benchmark/harvest.ts`:

```typescript
import type { PriceObservation } from "../scrape/prices.ts";
import type { PriceBand } from "../categories/types.ts";
import type { BenchmarkBrand } from "../categories/types.ts";
import { selectBenchmarks, tractionScore, type BrandSku } from "./traction.ts";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function bandFor(priceMinor: number, bands: PriceBand[]): string {
  const b = bands.find((x) => priceMinor >= x.lowMinor && priceMinor <= x.highMinor);
  return b?.label ?? bands[Math.floor(bands.length / 2)]?.label ?? "unknown";
}

/**
 * Turn scraped price observations into audit-only BenchmarkBrand anchors.
 * Returns degraded=true (and empty list) when NO observation has review data —
 * never fabricates anchors.
 */
export function benchmarksFromObservations(
  observations: PriceObservation[],
  bands: PriceBand[],
  n: number,
): { benchmarkBrands: BenchmarkBrand[]; degraded: boolean } {
  const withReviews = observations.filter((o) => (o.reviewCount ?? 0) > 0);
  if (withReviews.length === 0) return { benchmarkBrands: [], degraded: true };

  const skus: BrandSku[] = withReviews.map((o) => {
    const priceMinor = Math.round((o.price || 0) * 100);
    return {
      brand: o.brand, product: o.product, priceMinor,
      format: o.packSize ?? "standard",
      claims: o.subtype ? [o.subtype, o.product] : [o.product],
      reviewCount: o.reviewCount ?? 0, rating: o.rating ?? 0,
      retailer: o.retailer ?? "", band: bandFor(priceMinor, bands),
    };
  });

  const maxRc = Math.max(1, ...skus.map((s) => s.reviewCount));
  const picked = selectBenchmarks(skus, n);

  const benchmarkBrands: BenchmarkBrand[] = picked.map((s) => ({
    auditId: `bm-${slug(s.brand)}`,
    realName: s.brand,
    claims: s.claims,
    priceMinor: s.priceMinor,
    format: s.format,
    reviewCount: s.reviewCount,
    rating: s.rating,
    retailer: s.retailer,
    tractionScore: tractionScore(s, maxRc),
    evidence: [{
      text: `${s.brand} ${s.product}`,
      quote: `${s.reviewCount} reviews, ${s.rating}★ at ${s.retailer || "retailer"}`,
      sourceUrl: "", verified: true, independent: false,
    }],
  }));

  return { benchmarkBrands, degraded: false };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test src/benchmark/harvest.test.ts`
Then: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck`
Expected: PASS (2 pass); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/scrape/prices.ts src/benchmark/harvest.ts src/benchmark/harvest.test.ts
git commit -m "feat(benchmark): build audit-only benchmark brands from scraped SKUs + reviews"
```

---

## Task 9: Wire benchmark harvest into the pack + tournament report + known-unknowns

**Files:**
- Modify: `src/intel/market.ts` (attach benchmarkBrands to the pack when observations exist)
- Modify: `src/pipeline/tournament.ts` (pass benchmarks to score; print audit section + verdict)
- Test: covered by Task 10 smoke run + existing unit tests

- [ ] **Step 1: Attach benchmarks + known-unknowns in `src/intel/market.ts`**

`buildCategoryPack` parses `raw` into a pack and already has access to price observations via the `brief` (it carries `priceBands`/clusters; the harvested observations are upstream). Where the pack is finalized (after `CategoryPackSchema.parse`), add population from the brief's observations if present on the brief object. Add, after `pack.priceBands = ...`:

```typescript
  // Benchmark anchors (audit-only). Only when real SKU observations with reviews exist.
  if (brief.observations && brief.observations.length) {
    const { benchmarksFromObservations } = await import("../benchmark/harvest.ts");
    const { benchmarkBrands, degraded } = benchmarksFromObservations(
      brief.observations, pack.priceBands, Number(process.env.PB_BENCHMARK_N ?? "5"),
    );
    pack.benchmarkBrands = benchmarkBrands;
    pack.benchmarksDegraded = degraded;
  } else {
    pack.benchmarksDegraded = true;
  }
  pack.benchmarkKnownUnknowns = [
    "Traction is a cumulative-popularity proxy (review volume + rating), NOT current market share or conversion; old brands are over-weighted (survivorship).",
    "Review data is channel/geo/language-skewed to whatever retailers the harvest reached.",
    "Traction weighting (volume/quality) and rating band are uncalibrated assumptions until piece #2 fits them.",
  ];
```

Also add `observations?: PriceObservation[];` to the brief type used by `buildCategoryPack` (near its other optional fields like `priceBands?`), and import the `PriceObservation` type. If the harvest pipeline does not currently thread observations into the brief, thread them: the price step already produces observations — pass them onto the brief object alongside `priceBands`. (Read `src/intel/market.ts` and the harvest caller to find where `brief.priceBands` is set and set `brief.observations` at the same place.)

- [ ] **Step 2: Pass benchmarks to `score()` in `src/pipeline/tournament.ts`**

Where `score(results, concepts)` is called, change to:

```typescript
  const report = score(results, concepts, pack.benchmarkBrands ?? []);
```

- [ ] **Step 3: Print the audit-only benchmark section + verdict in `formatReport`**

In `formatReport`, after the leaderboard loop, add:

```typescript
  if (report.calibrationPairs && report.calibrationPairs.length) {
    lines.push(`\nBenchmark anchors (audit-only — real brands, disguised in arena):`);
    lines.push(`   real win-rate  traction   brand`);
    for (const p of [...report.calibrationPairs].sort((a, b) => b.tractionScore - a.tractionScore)) {
      lines.push(
        `   ${(p.arenaWinRate * 100).toFixed(1).padStart(8)}%   ${p.tractionScore.toFixed(2).padStart(6)}   ${p.realName}`,
      );
    }
  }
  if (report.correlationCheck) {
    const c = report.correlationCheck;
    lines.push(`\nCalibration smoke-check: Spearman rho = ${c.spearmanRho.toFixed(2)} (n=${c.n}, ${c.verdict})`);
    lines.push(`   ${c.note}`);
  }
```

- [ ] **Step 4: Typecheck + full suite**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck && bun test`
Expected: typecheck clean; full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/intel/market.ts src/pipeline/tournament.ts
git commit -m "feat(pipeline): attach benchmark anchors to packs; report audit section + calibration verdict"
```

---

## Task 10: End-to-end verification

**Files:** none (verification only; requires API keys in `.env`)

- [ ] **Step 1: Full unit suite**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun test`
Expected: all green, including spearman, traction, benchmark schema, label, benchmarkCard, calibration, deep-benchmark, harvest.

- [ ] **Step 2: Typecheck**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run typecheck`
Expected: zero errors.

- [ ] **Step 3: Live: regenerate a grounded pack with benchmarks**

Run: `export PATH="$HOME/.bun/bin:$PATH" && bun run intel --category="lip balm" --geo="India" --currency=INR --ground`
Expected: completes; the generated pack in `./packs/` contains a non-empty `benchmarkBrands[]` with real names + `tractionScore` + `evidence`, OR `benchmarksDegraded:true` if no review data was found (both are valid honest outcomes).

- [ ] **Step 4: Live: deep tournament shows anchors + verdict**

Run: `export PATH="$HOME/.bun/bin:$PATH" && PB_CONCURRENCY=8 bun run tournament --category="lip-balm" --candidates=2 --cohort=4 --deep=true --seed=1 --out=out`
(Use the generated pack id; check `./packs/` for its exact id.)
Expected output includes the `Benchmark anchors (audit-only ...)` table and a `Calibration smoke-check: Spearman rho = ...` line. Verify in `out/tournament.json` that `calibrationPairs` and `correlationCheck` are populated, and grep the run shows NO real brand name was rendered into any card.

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "test: end-to-end benchmark anchors + calibration smoke-check verified"
```

---

## Done criteria

- `bun test` green; `bun run typecheck` clean.
- A grounded pack carries audit-only `benchmarkBrands[]` (or honest `benchmarksDegraded`).
- A deep tournament prints the benchmark-anchor table + Spearman verdict and writes `calibrationPairs`/`correlationCheck` to `tournament.json`.
- Blind control holds: no benchmark's real name/metric appears in any rendered card (asserted by unit test + spot-checked live).
- The correlation verdict gives the gating signal for whether Level 2 (calibration) is worth building.

## Out of scope (deferred)

Calibration curve / implied-share (piece #2); first-party-data ground truth (Level 3); defensibility (#5); creative connection.
```
