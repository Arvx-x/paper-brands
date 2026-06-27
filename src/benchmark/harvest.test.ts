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
  expect(burt.evidence.length).toBeGreaterThanOrEqual(1);
});

test("no review data anywhere => degraded true, empty list", () => {
  const observations = [obs({ brand: "B", reviewCount: 0, rating: 0 })];
  const { benchmarkBrands, degraded } = benchmarksFromObservations(observations, bands, 5);
  expect(degraded).toBe(true);
  expect(benchmarkBrands).toEqual([]);
});
