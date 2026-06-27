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
  expect(new Set(picked.map((p) => p.brand)).size).toBe(picked.length);
  const a = picked.find((p) => p.brand === "A")!;
  expect(a.reviewCount).toBe(100000);
  expect(new Set(picked.map((p) => p.band)).size).toBeGreaterThan(1);
  expect(picked.length).toBe(3);
});

test("fewer than N available => returns what exists, no padding", () => {
  const picked = selectBenchmarks([sku({ brand: "A", reviewCount: 10 })], 5);
  expect(picked.length).toBe(1);
});
