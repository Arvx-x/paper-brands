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

test("BLIND CONTROL (structural): card has EXACTLY the allowed BlindCard keys — no audit field can be added", () => {
  const card = cardFromBenchmark(bm, "OPTION-C");
  // The allowed keys are the BlindCard shape. If a future edit adds an audit-only
  // field (realName/tractionScore/reviewCount/rating/retailer/auditId), this fails.
  const allowed = ["label", "headline", "body", "claims", "format", "priceMinor"].sort();
  expect(Object.keys(card).sort()).toEqual(allowed);
});

test("empty claims => safe fallback headline+body, no throw", () => {
  const empty = { ...bm, claims: [] } as BenchmarkBrand;
  const card = cardFromBenchmark(empty, "OPTION-A");
  expect(card.headline.length).toBeGreaterThan(0);
  expect(typeof card.body).toBe("string");
});

test("single claim => no spurious separators", () => {
  const one = { ...bm, claims: ["only one claim"] } as BenchmarkBrand;
  const card = cardFromBenchmark(one, "OPTION-A");
  expect(card.headline).toContain("only one claim");
});

test("very long claim is truncated by normalizeLen", () => {
  const long = { ...bm, claims: [Array.from({ length: 80 }, (_, i) => `w${i}`).join(" ")] } as BenchmarkBrand;
  const card = cardFromBenchmark(long, "OPTION-A");
  expect(card.headline.split(/\s+/).length).toBeLessThanOrEqual(12); // HEAD word budget
});
