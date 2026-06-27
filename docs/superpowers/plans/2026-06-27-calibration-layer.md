# Calibration Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a source-agnostic calibration layer that turns the arena's blind win-rate into an honest, uncertainty-bounded real-world estimate via a persistent observation store + a bivariate OLS fit (`real ≈ a·appeal + b·equity + c`) + a three-label honesty gate wired into the tournament report.

**Architecture:** Three pure-ish concerns in `src/calibration/` — a disk-backed `CalibrationStore` (append-only, dedupe-by-id, fail-to-empty), a pure `CalibrationModel` (closed-form 2-predictor least squares + per-coefficient honesty), and a `calibrate()` orchestrator returning a `CalibrationResult`. Wired into `formatReport`/`TournamentOutput` (additive) and exposed via two CLI verbs (`calibrate-record`, `calibrate-status`). No new dependencies; reuses `mean`/`stddev` from `src/arena/stats.ts`.

**Tech Stack:** TypeScript, Bun (`bun test`, `Bun.write`/`Bun.file`, `node:fs/promises` `mkdir`), Zod (already a dep) for CLI input validation.

**Spec:** `docs/superpowers/specs/2026-06-27-calibration-layer-design.md`

---

## File Structure

- Create `src/calibration/types.ts` — `CalibrationSource`, `CalibrationUnit`, `EquityComponents`, `CalibrationObservation`, `CalibrationFile`, `CalibrationResult`.
- Create `src/calibration/model.ts` — pure `fitCalibration(observations)` + `applyCalibration(...)` + small OLS/`pearson`/`r2` helpers. Exports `CalibrationFit`.
- Create `src/calibration/model.test.ts` — pure fit/apply tests (Task A/A2).
- Create `src/calibration/store.ts` — `CalibrationStore` (path resolution, read/record, dedupe, fail-to-empty).
- Create `src/calibration/store.test.ts` — temp-dir I/O tests (Task B).
- Create `src/calibration/calibrate.ts` — `calibrate(category, rawWinRate, equityScore?)` orchestrator + `composeEquity(components)` helper.
- Create `src/calibration/calibrate.test.ts` — orchestrator tests (Task C).
- Modify `src/pipeline/tournament.ts` — add optional `calibration` field to `TournamentOutput`; compute it in `runTournament`; render lines in `formatReport`.
- Create `src/pipeline/tournament-calibration.test.ts` — report contract tests (Task D).
- Modify `src/cli.ts` — add `calibrate-record` and `calibrate-status` cases.
- Modify `package.json` — add `calibrate:record` and `calibrate:status` scripts.

Convention notes (verified in repo):
- Tests use `import { test, expect } from "bun:test";` and run with `bun test`.
- `data/<slug>` dirs use `mkdir(dir,{recursive:true})` + `Bun.write`; read with `Bun.file(path).json()`.
- CLI dispatch is `switch (process.argv[2])` with `arg("name")` / `flag("name")` helpers. Hyphenated verbs (e.g. `optimize-gain`) are the existing style, so use `calibrate-record` / `calibrate-status`.

---

## Task 1: Calibration types

**Files:**
- Create: `src/calibration/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
export type CalibrationSource = "smoke-test" | "analog" | "manual" | "first-party";
export type CalibrationUnit = "brand" | "concept";

export interface EquityComponents {
  search?: number;        // 0..1 brand-name search/keyword demand
  distribution?: number;  // 0..1 retail/marketplace breadth
  social?: number;        // 0..1 social following
}

export interface CalibrationObservation {
  id: string;
  category: string;
  syntheticScore: number;            // 0..1 blind arena win-rate at observation time
  realOutcome: number;               // 0..1 observed proxy (e.g. fake-door CTR)
  equityScore?: number;              // 0..1 composite equity; optional
  equityComponents?: EquityComponents;
  source: CalibrationSource;
  unit: CalibrationUnit;
  label: string;
  realMetric: string;
  recordedAt: string;                // ISO
  notes?: string;
}

export interface CalibrationFile {
  category: string;
  observations: CalibrationObservation[];
}

export interface CalibrationResult {
  status: "uncalibrated" | "weak" | "calibrated";
  raw: number;
  calibrated: number;
  lo: number;
  hi: number;
  residualRmse: number | null;
  n: number;
  r2: number | null;
  method: "passthrough" | "linear" | "bivariate";
  realMetric: string | null;
  appealContribution: number;
  equityContribution: number;
  equityStatus: "not-learned" | "learned";
  warnings: string[];
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no errors). Types-only file; nothing imports it yet.

- [ ] **Step 3: Commit**

```bash
git add src/calibration/types.ts
git commit -m "feat(calibration): observation + result types (bivariate)"
```

---

## Task 2: Model — appeal-only (univariate) fit

**Files:**
- Create: `src/calibration/model.ts`
- Test: `src/calibration/model.test.ts`

- [ ] **Step 1: Write failing tests (univariate behaviour)**

```typescript
import { test, expect } from "bun:test";
import { fitCalibration } from "./model.ts";
import type { CalibrationObservation } from "./types.ts";

function obs(s: number, r: number, extra: Partial<CalibrationObservation> = {}): CalibrationObservation {
  return {
    id: `${s}-${r}-${Math.random()}`,
    category: "test",
    syntheticScore: s,
    realOutcome: r,
    source: "smoke-test",
    unit: "concept",
    label: "x",
    realMetric: "landing CTR",
    recordedAt: new Date().toISOString(),
    ...extra,
  };
}

test("n<3 -> uncalibrated passthrough", () => {
  const fit = fitCalibration([obs(0.4, 0.03), obs(0.5, 0.04)]);
  expect(fit.status).toBe("uncalibrated");
  expect(fit.method).toBe("passthrough");
  const r = fit.apply(0.4);
  expect(r.calibrated).toBe(0.4);
  expect(r.lo).toBe(0.4);
  expect(r.hi).toBe(0.4);
});

test("clean linear set -> calibrated, recovers slope/intercept, rmse~0", () => {
  // y = 0.08x - 0.004
  const data = [0.2, 0.4, 0.6, 0.8].map((x) => obs(x, 0.08 * x - 0.004));
  const fit = fitCalibration(data);
  expect(fit.status).toBe("calibrated");
  expect(fit.method).toBe("linear");
  expect(fit.residualRmse!).toBeLessThan(1e-6);
  const r = fit.apply(0.5);
  expect(r.calibrated).toBeCloseTo(0.08 * 0.5 - 0.004, 5);
  expect(r.appealContribution).toBeCloseTo(r.calibrated, 5);
  expect(r.equityContribution).toBe(0);
  expect(r.equityStatus).toBe("not-learned");
});

test("noisy weak fit (R^2<0.25) -> weak + widened CI", () => {
  const data = [obs(0.2, 0.5), obs(0.4, 0.1), obs(0.6, 0.6), obs(0.8, 0.2), obs(0.5, 0.55)];
  const fit = fitCalibration(data);
  expect(fit.status).toBe("weak");
  const r = fit.apply(0.5);
  // weak CI is wider than the bare residual band would be
  expect(r.hi - r.lo).toBeGreaterThan(0);
});

test("CI clamped to [0,1] at both ends", () => {
  const hi = [0.2, 0.4, 0.6].map((x) => obs(x, Math.min(1, 5 * x))); // steep, high outputs
  const r = fitCalibration(hi).apply(0.9);
  expect(r.hi).toBeLessThanOrEqual(1);
  expect(r.lo).toBeGreaterThanOrEqual(0);
});

test("negative appeal slope -> weak, never perverse, raw preserved", () => {
  const data = [obs(0.2, 0.6), obs(0.4, 0.4), obs(0.6, 0.2), obs(0.8, 0.05)];
  const fit = fitCalibration(data);
  expect(fit.status).toBe("weak");
  expect(fit.apply(0.4).raw).toBe(0.4);
});

test("zero appeal variance -> uncalibrated, no NaN", () => {
  const data = [obs(0.5, 0.1), obs(0.5, 0.2), obs(0.5, 0.3)];
  const r = fitCalibration(data).apply(0.5);
  expect(r.status).toBe("uncalibrated");
  expect(Number.isFinite(r.calibrated)).toBe(true);
});

test("monotonic: higher raw -> higher-or-equal calibrated (positive slope)", () => {
  const data = [0.2, 0.4, 0.6, 0.8].map((x) => obs(x, 0.08 * x - 0.004));
  const fit = fitCalibration(data);
  expect(fit.apply(0.7).calibrated).toBeGreaterThanOrEqual(fit.apply(0.3).calibrated);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/calibration/model.test.ts`
Expected: FAIL ("Cannot find module './model.ts'" / `fitCalibration` not defined).

- [ ] **Step 3: Implement model.ts (univariate path + apply, equity stubbed not-learned)**

```typescript
import type { CalibrationObservation, CalibrationResult } from "./types.ts";

const Z = 1.959963984540054;
const MIN_N = 3;
const R2_OK = 0.25;          // |r| >= 0.5
const WEAK_WIDEN = 2;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface CalibrationFit {
  status: "uncalibrated" | "weak" | "calibrated";
  method: "passthrough" | "linear" | "bivariate";
  n: number;
  r2: number | null;
  residualRmse: number | null;
  realMetric: string | null;
  equityStatus: "not-learned" | "learned";
  warnings: string[];
  apply(rawWinRate: number, equityScore?: number): CalibrationResult;
}

function passthrough(n: number, realMetric: string | null, warnings: string[]): CalibrationFit {
  return {
    status: "uncalibrated", method: "passthrough", n, r2: null, residualRmse: null,
    realMetric, equityStatus: "not-learned", warnings,
    apply(raw) {
      return {
        status: "uncalibrated", raw, calibrated: raw, lo: raw, hi: raw,
        residualRmse: null, n, r2: null, method: "passthrough", realMetric,
        appealContribution: raw, equityContribution: 0, equityStatus: "not-learned", warnings,
      };
    },
  };
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0);
}

export function fitCalibration(observations: CalibrationObservation[]): CalibrationFit {
  const n = observations.length;
  const realMetric = observations[0]?.realMetric ?? null;
  const warnings: string[] = [];
  const metrics = new Set(observations.map((o) => o.realMetric));
  if (metrics.size > 1) warnings.push("mixed-metric");

  if (n < MIN_N) return passthrough(n, realMetric, warnings);

  const x = observations.map((o) => o.syntheticScore);
  const y = observations.map((o) => o.realOutcome);
  if (variance(x) === 0) {
    warnings.push("zero-appeal-variance");
    return passthrough(n, realMetric, warnings);
  }

  // univariate OLS: y = a*x + c
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx, dy = y[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const a = sxy / sxx;
  const c = my - a * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);

  // residual RMSE
  let sse = 0;
  for (let i = 0; i < n; i++) { const e = y[i]! - (a * x[i]! + c); sse += e * e; }
  const rmse = Math.sqrt(sse / n);

  const weak = r2 < R2_OK || a < 0;
  if (weak) warnings.push("weak-fit");
  const status = weak ? "weak" : "calibrated";
  const widen = weak ? WEAK_WIDEN : 1;

  // equity not learned in this task (bivariate added in Task 4)
  const equityStatus = "not-learned" as const;
  warnings.push("equity-unidentifiable");

  return {
    status, method: "linear", n, r2, residualRmse: rmse, realMetric, equityStatus, warnings,
    apply(raw) {
      const appeal = a * raw + c;
      const calibrated = clamp01(appeal);
      const half = Z * rmse * widen;
      return {
        status, raw, calibrated, lo: clamp01(calibrated - half), hi: clamp01(calibrated + half),
        residualRmse: rmse, n, r2, method: "linear", realMetric,
        appealContribution: appeal, equityContribution: 0, equityStatus, warnings,
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/calibration/model.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add src/calibration/model.ts src/calibration/model.test.ts
git commit -m "feat(calibration): pure univariate OLS fit + honesty ladder"
```

---

## Task 3: Model — equity component compose helper

**Files:**
- Create: `src/calibration/calibrate.ts` (helper only in this task)
- Test: `src/calibration/calibrate.test.ts` (compose tests only in this task)

- [ ] **Step 1: Write failing tests for composeEquity**

```typescript
import { test, expect } from "bun:test";
import { composeEquity } from "./calibrate.ts";

test("composeEquity averages only present components", () => {
  expect(composeEquity({ search: 0.2, distribution: 0.4 })).toBeCloseTo(0.3, 5);
  expect(composeEquity({ social: 0.6 })).toBeCloseTo(0.6, 5);
});

test("composeEquity returns undefined when no components present", () => {
  expect(composeEquity({})).toBeUndefined();
  expect(composeEquity(undefined)).toBeUndefined();
});

test("composeEquity does NOT zero-fill missing components", () => {
  // search alone at 0.6 -> 0.6, not 0.2 (would be if distribution/social zero-filled)
  expect(composeEquity({ search: 0.6 })).toBeCloseTo(0.6, 5);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/calibration/calibrate.test.ts`
Expected: FAIL ("Cannot find module './calibrate.ts'").

- [ ] **Step 3: Implement composeEquity in calibrate.ts**

```typescript
import type { EquityComponents } from "./types.ts";

/** Equal-weight mean of PRESENT equity components (missing omitted, not zero-filled). */
export function composeEquity(components?: EquityComponents): number | undefined {
  if (!components) return undefined;
  const vals = [components.search, components.distribution, components.social]
    .filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/calibration/calibrate.test.ts`
Expected: PASS (3).

- [ ] **Step 5: Commit**

```bash
git add src/calibration/calibrate.ts src/calibration/calibrate.test.ts
git commit -m "feat(calibration): equity component compose (no zero-fill)"
```

---

## Task 4: Model — bivariate fit with per-coefficient equity honesty

**Files:**
- Modify: `src/calibration/model.ts`
- Modify: `src/calibration/model.test.ts`

- [ ] **Step 1: Add failing bivariate tests**

```typescript
import { fitCalibration as fitBi } from "./model.ts"; // already imported; add tests below existing

test("clean bivariate set -> learned, recovers a/b/c, contributions reconcile", () => {
  // y = 0.06*appeal + 0.09*equity - 0.003 ; vary both independently
  const rows: [number, number][] = [
    [0.2, 0.1], [0.4, 0.5], [0.6, 0.2], [0.8, 0.7], [0.5, 0.9], [0.3, 0.4],
  ];
  const data = rows.map(([s, e]) =>
    obs(s, 0.06 * s + 0.09 * e - 0.003, { equityScore: e }));
  const fit = fitCalibration(data);
  expect(fit.method).toBe("bivariate");
  expect(fit.equityStatus).toBe("learned");
  const r = fit.apply(0.5, 0.4);
  expect(r.calibrated).toBeCloseTo(0.06 * 0.5 + 0.09 * 0.4 - 0.003, 4);
  expect(r.equityContribution).toBeGreaterThan(0);
  // appeal + equity contributions + intercept reconcile to pre-clamp estimate
  expect(r.appealContribution + r.equityContribution).toBeCloseTo(r.calibrated, 4);
});

test("equity constant across obs -> not-learned, degrades to univariate", () => {
  const data = [0.2, 0.4, 0.6, 0.8].map((s) =>
    obs(s, 0.08 * s - 0.004, { equityScore: 0.3 }));
  const fit = fitCalibration(data);
  expect(fit.equityStatus).toBe("not-learned");
  expect(fit.method).toBe("linear");
  expect(fit.warnings).toContain("equity-unidentifiable");
});

test("equity collinear with appeal -> not-learned (near-singular)", () => {
  const data = [0.2, 0.4, 0.6, 0.8].map((s) =>
    obs(s, 0.08 * s - 0.004, { equityScore: s })); // equity == appeal
  const fit = fitCalibration(data);
  expect(fit.equityStatus).toBe("not-learned");
});

test("appeal calibrated + equity not-learned simultaneously (independent ladders)", () => {
  const data = [0.2, 0.4, 0.6, 0.8, 0.5].map((s) => obs(s, 0.08 * s - 0.004));
  const fit = fitCalibration(data);
  expect(fit.status).toBe("calibrated");
  expect(fit.equityStatus).toBe("not-learned");
});

test("apply(raw, equity) never mutates raw", () => {
  const rows: [number, number][] = [[0.2, 0.1], [0.4, 0.5], [0.6, 0.2], [0.8, 0.7]];
  const data = rows.map(([s, e]) => obs(s, 0.06 * s + 0.09 * e, { equityScore: e }));
  expect(fitCalibration(data).apply(0.4, 0.5).raw).toBe(0.4);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `bun test src/calibration/model.test.ts`
Expected: FAIL on bivariate cases (current model is univariate; `method` is "linear", equity never learned, no a/b recovery).

- [ ] **Step 3: Replace the OLS block in model.ts with bivariate-capable fit**

Replace everything from `// univariate OLS: y = a*x + c` through the end of `fitCalibration` with:

```typescript
  // Decide whether equity is identifiable
  const eqVals = observations.map((o) => o.equityScore);
  const haveEquity = eqVals.every((v) => typeof v === "number");
  const e = haveEquity ? (eqVals as number[]) : [];

  // helper: solve 2-predictor OLS (x, e) via normal equations; null if near-singular
  function solveBivariate(): { a: number; b: number; c: number } | null {
    const ex = e;
    let Sxx = 0, See = 0, Sxe = 0, Sxy = 0, Sey = 0, Sx = 0, Se = 0, Sy = 0;
    for (let i = 0; i < n; i++) {
      const xi = x[i]!, ei = ex[i]!, yi = y[i]!;
      Sxx += xi * xi; See += ei * ei; Sxe += xi * ei;
      Sxy += xi * yi; Sey += ei * yi; Sx += xi; Se += ei; Sy += yi;
    }
    // centered cross-products
    const cxx = Sxx - (Sx * Sx) / n;
    const cee = See - (Se * Se) / n;
    const cxe = Sxe - (Sx * Se) / n;
    const cxy = Sxy - (Sx * Sy) / n;
    const cey = Sey - (Se * Sy) / n;
    const det = cxx * cee - cxe * cxe;
    if (cee === 0 || Math.abs(det) < 1e-9 * (cxx * cee + 1e-12)) return null; // no equity variance / collinear
    const a = (cee * cxy - cxe * cey) / det;
    const b = (cxx * cey - cxe * cxy) / det;
    const c = (Sy - a * Sx - b * Se) / n;
    return { a, b, c };
  }

  let a: number, c: number, b = 0, method: "linear" | "bivariate" = "linear";
  let equityStatus: "not-learned" | "learned" = "not-learned";
  const bi = haveEquity ? solveBivariate() : null;
  if (bi) {
    a = bi.a; b = bi.b; c = bi.c; method = "bivariate"; equityStatus = "learned";
  } else {
    // univariate OLS: y = a*x + c
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { const dx = x[i]! - mx; sxy += dx * (y[i]! - my); sxx += dx * dx; }
    a = sxy / sxx; c = my - a * mx;
    warnings.push("equity-unidentifiable");
  }

  // R^2 and residual RMSE from the chosen model
  const yhat = (i: number) => a * x[i]! + (method === "bivariate" ? b * e[i]! : 0) + c;
  const my2 = y.reduce((s, v) => s + v, 0) / n;
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) { const r = y[i]! - yhat(i); sse += r * r; const d = y[i]! - my2; sst += d * d; }
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  const rmse = Math.sqrt(sse / n);

  const weak = r2 < R2_OK || a < 0;
  if (weak) warnings.push("weak-fit");
  const status = weak ? "weak" : "calibrated";
  const widen = weak ? WEAK_WIDEN : 1;

  return {
    status, method, n, r2, residualRmse: rmse, realMetric, equityStatus, warnings,
    apply(raw, equityScore) {
      const appeal = a * raw + c;
      const equityContribution = method === "bivariate" && typeof equityScore === "number" ? b * equityScore : 0;
      const estimate = appeal + equityContribution;
      const calibrated = clamp01(estimate);
      const half = Z * rmse * widen;
      return {
        status, raw, calibrated, lo: clamp01(calibrated - half), hi: clamp01(calibrated + half),
        residualRmse: rmse, n, r2, method, realMetric,
        appealContribution: appeal, equityContribution, equityStatus, warnings,
      };
    },
  };
```

Also delete the now-unused old `r2` line (`const r2 = syy === 0 ...`) and the old univariate `apply` return that preceded this block, and remove the unused `syy` accumulation if it remains.

- [ ] **Step 4: Run full model tests**

Run: `bun test src/calibration/model.test.ts`
Expected: PASS (all univariate + bivariate cases). Note: the "clean linear set" univariate test now expects `method:"linear"` and `equityStatus:"not-learned"` — still satisfied since those rows have no `equityScore`.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add src/calibration/model.ts src/calibration/model.test.ts
git commit -m "feat(calibration): bivariate OLS with per-coefficient equity honesty"
```

---

## Task 5: CalibrationStore (disk I/O, fail-to-empty, dedupe)

**Files:**
- Modify: `src/calibration/store.ts` (create)
- Test: `src/calibration/store.test.ts`

- [ ] **Step 1: Write failing store tests**

```typescript
import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalibrationStore } from "./store.ts";
import type { CalibrationObservation } from "./types.ts";

function ob(id: string, s = 0.4, r = 0.03): CalibrationObservation {
  return { id, category: "lip-care", syntheticScore: s, realOutcome: r,
    source: "smoke-test", unit: "concept", label: id, realMetric: "landing CTR",
    recordedAt: new Date().toISOString() };
}

async function tmp() { return mkdtemp(join(tmpdir(), "calib-")); }

test("round-trip: record then read identical", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  await store.record(ob("a"));
  const read = await store.read();
  expect(read.observations).toHaveLength(1);
  expect(read.observations[0]!.id).toBe("a");
  await rm(dir, { recursive: true, force: true });
});

test("append-only: second record keeps the first", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  await store.record(ob("a"));
  await store.record(ob("b"));
  expect((await store.read()).observations.map((o) => o.id)).toEqual(["a", "b"]);
  await rm(dir, { recursive: true, force: true });
});

test("dedupe by id: re-recording same id is idempotent (last wins)", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  await store.record(ob("a", 0.4, 0.03));
  await store.record(ob("a", 0.4, 0.05));
  const read = await store.read();
  expect(read.observations).toHaveLength(1);
  expect(read.observations[0]!.realOutcome).toBe(0.05);
  await rm(dir, { recursive: true, force: true });
});

test("missing file reads as empty, no throw", async () => {
  const dir = await tmp();
  const read = await new CalibrationStore("lip-care", dir).read();
  expect(read.observations).toHaveLength(0);
  await rm(dir, { recursive: true, force: true });
});

test("corrupt JSON reads as empty + warns, no throw", async () => {
  const dir = await tmp();
  await mkdir(join(dir, "lip-care"), { recursive: true });
  await writeFile(join(dir, "lip-care", "calibration.json"), "{ not json");
  const read = await new CalibrationStore("lip-care", dir).read();
  expect(read.observations).toHaveLength(0);
  await rm(dir, { recursive: true, force: true });
});

test("range rejection: out-of-range synthetic/real/equity throws", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  await expect(store.record(ob("bad", 1.5, 0.03))).rejects.toThrow();
  await expect(store.record(ob("bad2", 0.4, -0.1))).rejects.toThrow();
  await expect(store.record({ ...ob("bad3"), equityScore: 2 })).rejects.toThrow();
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/calibration/store.test.ts`
Expected: FAIL ("Cannot find module './store.ts'").

- [ ] **Step 3: Implement store.ts**

```typescript
import { mkdir } from "node:fs/promises";
import type { CalibrationFile, CalibrationObservation } from "./types.ts";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inUnit(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

function validate(o: CalibrationObservation): void {
  if (!inUnit(o.syntheticScore)) throw new Error(`syntheticScore must be 0..1 (got ${o.syntheticScore})`);
  if (!inUnit(o.realOutcome)) throw new Error(`realOutcome must be 0..1 (got ${o.realOutcome})`);
  if (o.equityScore !== undefined && !inUnit(o.equityScore)) throw new Error(`equityScore must be 0..1 (got ${o.equityScore})`);
  for (const [k, v] of Object.entries(o.equityComponents ?? {})) {
    if (!inUnit(v)) throw new Error(`equity component ${k} must be 0..1 (got ${v})`);
  }
}

export class CalibrationStore {
  private readonly dir: string;
  constructor(private readonly category: string, baseDir = "data") {
    this.dir = `${baseDir}/${slug(category)}`;
  }
  private get path(): string { return `${this.dir}/calibration.json`; }

  async read(): Promise<CalibrationFile> {
    const empty: CalibrationFile = { category: this.category, observations: [] };
    try {
      const f = Bun.file(this.path);
      if (!(await f.exists())) return empty;
      const data = (await f.json()) as CalibrationFile;
      if (!data || !Array.isArray(data.observations)) return empty;
      return data;
    } catch {
      console.error(`[calibration] WARN: corrupt ${this.path}; treating as empty`);
      return empty;
    }
  }

  async record(o: CalibrationObservation): Promise<void> {
    validate(o);
    const file = await this.read();
    const observations = file.observations.filter((x) => x.id !== o.id);
    observations.push(o);
    await mkdir(this.dir, { recursive: true });
    await Bun.write(this.path, JSON.stringify({ category: this.category, observations }, null, 2));
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/calibration/store.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add src/calibration/store.ts src/calibration/store.test.ts
git commit -m "feat(calibration): append-only store, dedupe-by-id, fail-to-empty"
```

---

## Task 6: calibrate() orchestrator

**Files:**
- Modify: `src/calibration/calibrate.ts`
- Modify: `src/calibration/calibrate.test.ts`

- [ ] **Step 1: Add failing orchestrator tests**

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calibrate } from "./calibrate.ts";
import { CalibrationStore } from "./store.ts";
import type { CalibrationObservation } from "./types.ts";

function ob(id: string, s: number, r: number, e?: number): CalibrationObservation {
  return { id, category: "lip-care", syntheticScore: s, realOutcome: r, equityScore: e,
    source: "smoke-test", unit: "concept", label: id, realMetric: "landing CTR",
    recordedAt: new Date().toISOString() };
}
async function tmp() { return mkdtemp(join(tmpdir(), "calib-orc-")); }

test("empty category -> uncalibrated passthrough", async () => {
  const dir = await tmp();
  const r = await calibrate("lip-care", 0.4, undefined, dir);
  expect(r.status).toBe("uncalibrated");
  expect(r.calibrated).toBe(0.4);
  await rm(dir, { recursive: true, force: true });
});

test("seeded calibrated category -> estimate + status/n/method", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  for (const x of [0.2, 0.4, 0.6, 0.8]) await store.record(ob(`u${x}`, x, 0.08 * x - 0.004));
  const r = await calibrate("lip-care", 0.5, undefined, dir);
  expect(r.status).toBe("calibrated");
  expect(r.method).toBe("linear");
  expect(r.n).toBe(4);
  expect(r.calibrated).toBeCloseTo(0.08 * 0.5 - 0.004, 4);
  await rm(dir, { recursive: true, force: true });
});

test("bivariate seeded -> equity learned, non-zero equity contribution", async () => {
  const dir = await tmp();
  const store = new CalibrationStore("lip-care", dir);
  const rows: [number, number][] = [[0.2,0.1],[0.4,0.5],[0.6,0.2],[0.8,0.7],[0.5,0.9],[0.3,0.4]];
  for (const [s, e] of rows) await store.record(ob(`b${s}-${e}`, s, 0.06*s+0.09*e-0.003, e));
  const r = await calibrate("lip-care", 0.5, 0.4, dir);
  expect(r.equityStatus).toBe("learned");
  expect(r.equityContribution).toBeGreaterThan(0);
  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/calibration/calibrate.test.ts`
Expected: FAIL (`calibrate` not exported).

- [ ] **Step 3: Add calibrate() to calibrate.ts**

```typescript
import { CalibrationStore } from "./store.ts";
import { fitCalibration } from "./model.ts";
import type { CalibrationResult } from "./types.ts";

export async function calibrate(
  category: string,
  rawWinRate: number,
  equityScore?: number,
  baseDir = "data",
): Promise<CalibrationResult> {
  const file = await new CalibrationStore(category, baseDir).read();
  return fitCalibration(file.observations).apply(rawWinRate, equityScore);
}
```

(Keep the existing `composeEquity` export above this.)

- [ ] **Step 4: Run to verify pass**

Run: `bun test src/calibration/calibrate.test.ts`
Expected: PASS (compose + orchestrator).

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add src/calibration/calibrate.ts src/calibration/calibrate.test.ts
git commit -m "feat(calibration): calibrate() orchestrator (store + fit)"
```

---

## Task 7: Wire into tournament report (the QUALITY gate)

**Files:**
- Modify: `src/pipeline/tournament.ts` (TournamentOutput line 28-35; runTournament ~line 102; formatReport ~line 182-186)
- Test: `src/pipeline/tournament-calibration.test.ts`

- [ ] **Step 1: Write failing report-contract tests (pure formatReport)**

```typescript
import { test, expect } from "bun:test";
import { formatReport, type TournamentOutput } from "./tournament.ts";
import type { CalibrationResult } from "../calibration/types.ts";

function baseOut(cal?: CalibrationResult): TournamentOutput {
  return {
    categoryId: "lip-care",
    concepts: [],
    report: {
      totalTrials: 40,
      candidates: [],
      winner: { conceptId: "c1", name: "EcoLips", winRate: 0.4, winRateCiLow: 0.3, winRateCiHigh: 0.5, topObjections: [] },
    } as any,
    calibration: cal,
  };
}

test("uncalibrated -> exactly one label, UNCALIBRATED, no bare forecast", () => {
  const out = baseOut({ status: "uncalibrated", raw: 0.4, calibrated: 0.4, lo: 0.4, hi: 0.4,
    residualRmse: null, n: 0, r2: null, method: "passthrough", realMetric: null,
    appealContribution: 0.4, equityContribution: 0, equityStatus: "not-learned", warnings: [] });
  const txt = formatReport(out);
  expect(txt).toContain("UNCALIBRATED");
  expect(txt).not.toContain("CALIBRATED estimate");
});

test("calibrated, equity not learned -> CALIBRATED line + 'no equity data yet'", () => {
  const out = baseOut({ status: "calibrated", raw: 0.4, calibrated: 0.031, lo: 0.017, hi: 0.045,
    residualRmse: 0.007, n: 4, r2: 0.55, method: "linear", realMetric: "landing CTR",
    appealContribution: 0.031, equityContribution: 0, equityStatus: "not-learned", warnings: [] });
  const txt = formatReport(out);
  expect(txt).toContain("CALIBRATED");
  expect(txt).toContain("no equity data yet");
  expect(txt).toContain("landing CTR");
});

test("calibrated, equity learned -> decomposition with brand equity contribution", () => {
  const out = baseOut({ status: "calibrated", raw: 0.4, calibrated: 0.031, lo: 0.017, hi: 0.045,
    residualRmse: 0.007, n: 6, r2: 0.74, method: "bivariate", realMetric: "landing CTR",
    appealContribution: 0.024, equityContribution: 0.007, equityStatus: "learned", warnings: [] });
  const txt = formatReport(out);
  expect(txt).toContain("brand equity");
  expect(txt).toContain("learned");
});

test("weak -> WEAK label, directional only", () => {
  const out = baseOut({ status: "weak", raw: 0.4, calibrated: 0.031, lo: 0, hi: 0.073,
    residualRmse: 0.02, n: 4, r2: 0.14, method: "linear", realMetric: "landing CTR",
    appealContribution: 0.031, equityContribution: 0, equityStatus: "not-learned", warnings: ["weak-fit"] });
  const txt = formatReport(out);
  expect(txt).toContain("WEAK");
});

test("absent calibration -> no calibration lines (non-breaking)", () => {
  const txt = formatReport(baseOut(undefined));
  expect(txt).not.toContain("UNCALIBRATED");
  expect(txt).not.toContain("CALIBRATED");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `bun test src/pipeline/tournament-calibration.test.ts`
Expected: FAIL (TournamentOutput has no `calibration`; labels not printed).

- [ ] **Step 3a: Add import + field to TournamentOutput**

At top of `src/pipeline/tournament.ts` add import:

```typescript
import { calibrate } from "../calibration/calibrate.ts";
import type { CalibrationResult } from "../calibration/types.ts";
```

Extend the interface (after `cohortDiversity?: number;`):

```typescript
  calibration?: CalibrationResult;
```

- [ ] **Step 3b: Compute calibration in runTournament**

Just before `const out: TournamentOutput = { ... }` (~line 102), add:

```typescript
  const winRateForCal = report.winner?.winRate ?? report.candidateShareVsField ?? 0;
  const calibration = await calibrate(opts.categoryId, winRateForCal);
```

Then add `calibration` to the `out` object literal:

```typescript
  const out: TournamentOutput = { categoryId: opts.categoryId, concepts, report, runStats, groundingCoverage, cohortDiversity, calibration };
```

- [ ] **Step 3c: Render lines in formatReport**

Immediately after the `if (report.winner) { ... }` block (after line 186), add:

```typescript
  const cal = out.calibration;
  if (cal) {
    if (cal.status === "uncalibrated") {
      lines.push(
        `\u26a0 UNCALIBRATED \u2014 win-rate is a relative hypothesis, not a demand forecast (${cal.n} real observations).`,
      );
    } else {
      const label = cal.status === "weak" ? "WEAK fit" : "CALIBRATED";
      const metric = cal.realMetric ? ` real (${cal.realMetric})` : "";
      lines.push(
        `${label === "WEAK fit" ? "WEAK" : "CALIBRATED"} estimate: ${(cal.calibrated * 100).toFixed(1)}%${metric} ` +
          `\u00b1 ${(((cal.hi - cal.lo) / 2) * 100).toFixed(1)}%  [n=${cal.n}, ${cal.method}, R\u00b2=${(cal.r2 ?? 0).toFixed(2)}` +
          `${cal.status === "weak" ? " \u2014 directional only" : ""}]`,
      );
      lines.push(`  \u251c blind concept appeal: +${(cal.appealContribution * 100).toFixed(1)}%`);
      lines.push(
        cal.equityStatus === "learned"
          ? `  \u2514 brand equity:         +${(cal.equityContribution * 100).toFixed(1)}%  (learned, n=${cal.n})`
          : `  \u2514 brand equity:         +0.0%  (no equity data yet)`,
      );
    }
  }
```

- [ ] **Step 4: Run report tests + full suite**

Run: `bun test src/pipeline/tournament-calibration.test.ts`
Expected: PASS (5).
Run: `bun test`
Expected: PASS (full suite, no regressions).

- [ ] **Step 5: Typecheck + commit**

```bash
bun run typecheck
git add src/pipeline/tournament.ts src/pipeline/tournament-calibration.test.ts
git commit -m "feat(pipeline): wire calibration into tournament report + json (additive)"
```

---

## Task 8: CLI verbs — calibrate-record + calibrate-status

**Files:**
- Modify: `src/cli.ts` (add cases in `switch (cmd)`)
- Modify: `package.json` (scripts)

- [ ] **Step 1: Add scripts to package.json**

In `"scripts"`, add:

```json
    "calibrate:record": "bun run src/cli.ts calibrate-record",
    "calibrate:status": "bun run src/cli.ts calibrate-status",
```

- [ ] **Step 2: Add imports + cases to cli.ts**

Add import near the other imports:

```typescript
import { CalibrationStore } from "./calibration/store.ts";
import { calibrate, composeEquity } from "./calibration/calibrate.ts";
import type { CalibrationObservation } from "./calibration/types.ts";
```

Add cases inside `switch (cmd)` (before the closing brace / `default`):

```typescript
  case "calibrate-record": {
    const category = arg("category");
    const synthetic = Number(arg("synthetic", "NaN"));
    const real = Number(arg("real", "NaN"));
    if (!category || !Number.isFinite(synthetic) || !Number.isFinite(real)) {
      console.error("usage: calibrate-record --category=<c> --synthetic=0..1 --real=0..1 [--source=] [--unit=] [--metric=] [--label=] [--equity=] [--equity-search=] [--equity-distribution=] [--equity-social=] [--notes=]");
      process.exit(2);
    }
    const equityComponents = {
      search: arg("equity-search") !== undefined ? Number(arg("equity-search")) : undefined,
      distribution: arg("equity-distribution") !== undefined ? Number(arg("equity-distribution")) : undefined,
      social: arg("equity-social") !== undefined ? Number(arg("equity-social")) : undefined,
    };
    const equityScore = arg("equity") !== undefined ? Number(arg("equity")) : composeEquity(equityComponents);
    const obs: CalibrationObservation = {
      id: arg("id", `${slugify(arg("label", "obs")!)}-${Date.now()}`)!,
      category,
      syntheticScore: synthetic,
      realOutcome: real,
      equityScore,
      equityComponents: Object.values(equityComponents).some((v) => v !== undefined) ? equityComponents : undefined,
      source: (arg("source", "manual") as CalibrationObservation["source"]),
      unit: (arg("unit", "concept") as CalibrationObservation["unit"]),
      label: arg("label", "obs")!,
      realMetric: arg("metric", "landing CTR")!,
      recordedAt: new Date().toISOString(),
      notes: arg("notes"),
    };
    try {
      await new CalibrationStore(category).record(obs);
      console.log(`recorded ${obs.id} (${category}): synthetic=${synthetic} real=${real}${equityScore !== undefined ? ` equity=${equityScore.toFixed(3)}` : ""}`);
    } catch (e) {
      console.error(`record rejected: ${(e as Error).message}`);
      process.exit(2);
    }
    break;
  }

  case "calibrate-status": {
    const category = arg("category");
    if (!category) { console.error("usage: calibrate-status --category=<c>"); process.exit(2); }
    const r = await calibrate(category, Number(arg("synthetic", "0.5")));
    const eq = r.equityStatus === "learned" ? "learned" : "not-learned";
    console.log(
      `n=${r.n} | method=${r.method} | R\u00b2=${(r.r2 ?? 0).toFixed(2)} | ` +
        `rmse=${r.residualRmse === null ? "n/a" : r.residualRmse.toFixed(3)} | status=${r.status} | equity=${eq}` +
        (r.warnings.length ? ` | warnings: ${r.warnings.join(",")}` : ""),
    );
    break;
  }
```

- [ ] **Step 3: Manual smoke — record then status in a temp category**

Run:
```bash
bun run calibrate:record --category=__calib_smoke --synthetic=0.4 --real=0.03 --source=smoke-test --unit=concept --metric="landing CTR" --label="t1"
bun run calibrate:record --category=__calib_smoke --synthetic=0.6 --real=0.05 --label="t2"
bun run calibrate:record --category=__calib_smoke --synthetic=0.8 --real=0.07 --label="t3"
bun run calibrate:status --category=__calib_smoke
```
Expected: three "recorded ..." lines, then a status line with `n=3 | method=linear | ... | status=calibrated`.

Then clean up:
```bash
rm -rf data/__calib_smoke
```

- [ ] **Step 4: Verify bad args exit non-zero**

Run: `bun run calibrate:record --category=x --synthetic=2 --real=0.1 ; echo "exit=$?"`
Expected: "record rejected: syntheticScore must be 0..1 ..." and `exit=2`.

- [ ] **Step 5: Typecheck + full suite + commit**

```bash
bun run typecheck
bun test
git add src/cli.ts package.json
git commit -m "feat(cli): calibrate-record + calibrate-status verbs"
```

---

## Task 9: Final verification + branch wrap

- [ ] **Step 1: Full typecheck + test sweep**

Run: `bun run typecheck && bun test`
Expected: typecheck clean; all tests pass (108 prior + the new calibration/report tests).

- [ ] **Step 2: Confirm no stray data written**

Run: `git status --short`
Expected: clean (no `data/` artifacts committed; `data/` is gitignored, but verify `__calib_smoke` removed).

- [ ] **Step 3: Review the diff against the spec**

Run: `git log --oneline calibration-layer ^main`
Confirm tasks 1-8 each produced a commit and the spec's six sections are all represented.

- [ ] **Step 4: Hand back to user for review before merge to main.**

(Do NOT ff-merge to main or push without explicit user go-ahead — per project git discipline.)
