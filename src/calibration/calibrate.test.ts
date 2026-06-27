import { test, expect } from "bun:test";
import { composeEquity } from "./calibrate.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calibrate } from "./calibrate.ts";
import { CalibrationStore } from "./store.ts";
import type { CalibrationObservation } from "./types.ts";

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
  for (const [s, e] of rows) await store.record(ob(`b${s}-${e}`, s, 0.06 * s + 0.09 * e - 0.003, e));
  const r = await calibrate("lip-care", 0.5, 0.4, dir);
  expect(r.equityStatus).toBe("learned");
  expect(r.equityContribution).toBeGreaterThan(0);
  await rm(dir, { recursive: true, force: true });
});
