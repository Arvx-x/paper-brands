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
}
