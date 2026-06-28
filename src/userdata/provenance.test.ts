import { test, expect } from "bun:test";
import { ProvenanceSchema } from "../categories/types.ts";

test("ProvenanceSchema accepts user-data honesty fields and defaults them", () => {
  const p = ProvenanceSchema.parse({});
  expect(p.userVoices).toBe(0);
  expect(p.userSkus).toBe(0);
  expect(p.overridesApplied).toEqual([]);
});

test("ProvenanceSchema records supplied user-data fields", () => {
  const p = ProvenanceSchema.parse({ userVoices: 12, userSkus: 5, overridesApplied: ["priceBands"] });
  expect(p.userVoices).toBe(12);
  expect(p.overridesApplied).toEqual(["priceBands"]);
});

test("ProvenanceSchema accepts skuConflicts and defaults to 0", () => {
  const p = ProvenanceSchema.parse({});
  expect(p.skuConflicts).toBe(0);
  const p2 = ProvenanceSchema.parse({ skuConflicts: 3 });
  expect(p2.skuConflicts).toBe(3);
});
