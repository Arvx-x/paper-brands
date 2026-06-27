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
