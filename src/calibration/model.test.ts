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
  expect(r.hi - r.lo).toBeGreaterThan(0);
});

test("CI clamped to [0,1] at both ends", () => {
  const hi = [0.2, 0.4, 0.6].map((x) => obs(x, Math.min(1, 5 * x)));
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
