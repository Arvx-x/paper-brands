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
