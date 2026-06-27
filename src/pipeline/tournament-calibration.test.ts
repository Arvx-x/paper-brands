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

// Hardening: the central guarantee — exactly ONE honesty label is emitted per
// reported win-rate, and the label matches the result status. Locks against
// future refactors that might leak a second label or none.
test("exactly one honesty label per status (invariant)", () => {
  const base = {
    raw: 0.4, calibrated: 0.031, lo: 0.017, hi: 0.045, residualRmse: 0.007,
    appealContribution: 0.031, equityContribution: 0, equityStatus: "not-learned" as const,
    realMetric: "landing CTR", warnings: [] as string[],
  };
  const cases: CalibrationResult[] = [
    { ...base, status: "uncalibrated", n: 0, r2: null, method: "passthrough", realMetric: null, calibrated: 0.4, lo: 0.4, hi: 0.4, appealContribution: 0.4 },
    { ...base, status: "weak", n: 4, r2: 0.14, method: "linear" },
    { ...base, status: "calibrated", n: 4, r2: 0.55, method: "linear" },
  ];
  for (const cal of cases) {
    const txt = formatReport(baseOut(cal));
    // Count whole-token labels. "UNCALIBRATED" contains "CALIBRATED" as a substring,
    // so match the labels as they actually appear in output:
    const uncal = (txt.match(/UNCALIBRATED/g) ?? []).length;
    const weak = (txt.match(/WEAK estimate/g) ?? []).length;
    // "CALIBRATED estimate" appears only for the calibrated case (not inside "UNCALIBRATED —").
    const cali = (txt.match(/CALIBRATED estimate/g) ?? []).length;
    expect(uncal + weak + cali).toBe(1);
    if (cal.status === "uncalibrated") expect(uncal).toBe(1);
    if (cal.status === "weak") expect(weak).toBe(1);
    if (cal.status === "calibrated") expect(cali).toBe(1);
  }
});
