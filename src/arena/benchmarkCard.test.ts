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
