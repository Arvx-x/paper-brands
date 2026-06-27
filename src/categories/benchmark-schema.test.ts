import { test, expect } from "bun:test";
import { BenchmarkBrandSchema, CategoryPackSchema } from "./types.ts";

test("BenchmarkBrand parses with defaults", () => {
  const b = BenchmarkBrandSchema.parse({
    auditId: "bm-x", realName: "X", claims: ["c"], priceMinor: 50000, format: "stick",
  });
  expect(b.tractionScore).toBe(0);
  expect(b.evidence).toEqual([]);
});

test("existing pack with NO benchmarkBrands still parses (back-compat)", () => {
  const pack = CategoryPackSchema.parse({
    id: "lipcare", name: "Lip Care", currency: "INR", geography: "India",
    unmetNeeds: [], purchaseTriggers: [], rejectionReasons: [], priceBands: [],
    competitorArchetypes: [], complianceNotes: [], buyerSegments: [],
  });
  expect(pack.benchmarkBrands).toEqual([]);
  expect(pack.benchmarksDegraded).toBe(false);
  expect(pack.benchmarkKnownUnknowns).toEqual([]);
});
