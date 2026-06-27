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
  reviewCount: 1, rating: 4, retailer: "r", tractionScore: traction,
  evidence: [{ text: "t", quote: "q", sourceUrl: "u", verified: true, independent: true }],
} as BenchmarkBrand);

test("pairs join benchmark winRate with tractionScore; rho computed", () => {
  const concepts = [
    cs("benchmark:a", 0.5, 4), cs("benchmark:b", 0.25, 2), cs("benchmark:c", 0.125, 1),
    cs("cand1", 0.125, 1),
  ];
  const benchmarks = [bm("a", 0.9), bm("b", 0.6), bm("c", 0.3)];
  const r = buildCalibration(concepts, benchmarks);
  expect(r.calibrationPairs).toHaveLength(3);
  expect(r.correlationCheck.spearmanRho).toBeGreaterThan(0.9);
  expect(r.correlationCheck.verdict).toBe("plausible");
});

test("benchmarks with zero traction or zero reviews are excluded (no real anchor)", () => {
  const concepts = [cs("benchmark:a", 0.5, 4), cs("benchmark:z", 0.5, 4), cs("benchmark:nr", 0.5, 4)];
  const zeroTraction = { ...bm("z", 0) } as BenchmarkBrand;            // no traction
  const zeroReviews = { ...bm("nr", 0.5), reviewCount: 0 } as BenchmarkBrand; // no reviews
  const r = buildCalibration(concepts, [bm("a", 0.9), zeroTraction, zeroReviews]);
  expect(r.calibrationPairs.map((p) => p.auditId)).toEqual(["a"]);
});

test("a benchmark with real traction is INCLUDED even when evidence is unverified (metric is the anchor)", () => {
  // Mirrors harvested benchmarks: verified:false provenance, but real review traction.
  const harvested = {
    ...bm("h", 0.7), reviewCount: 50000,
    evidence: [{ text: "t", quote: "50000 reviews, 4.5 star", sourceUrl: "", verified: false, independent: false }],
  } as BenchmarkBrand;
  const r = buildCalibration([cs("benchmark:h", 0.4, 3)], [harvested]);
  expect(r.calibrationPairs.map((p) => p.auditId)).toEqual(["h"]);
});

test("fewer than 3 pairs => insufficient-n verdict", () => {
  const r = buildCalibration([cs("benchmark:a", 0.5, 4)], [bm("a", 0.9)]);
  expect(r.correlationCheck.verdict).toBe("insufficient-n");
});
