import { test, expect } from "bun:test";
import { GroundedGrievanceSchema, CategoryPackSchema } from "./types.ts";

test("GroundedGrievance parses with defaults", () => {
  const g = GroundedGrievanceSchema.parse({
    segment: "dry-lips sufferer", anxiety: "wore off within an hour",
    verbatimQuote: "this wore off in literally an hour",
  });
  expect(g.verified).toBe(false);
  expect(g.sourceUrl).toBe("");
});

test("pack without grounding fields still parses (back-compat)", () => {
  const pack = CategoryPackSchema.parse({
    id: "lipcare", name: "Lip Care", currency: "INR", geography: "India",
    unmetNeeds: [], purchaseTriggers: [], rejectionReasons: [], priceBands: [],
    competitorArchetypes: [], complianceNotes: [], buyerSegments: [],
  });
  expect(pack.groundedGrievances).toEqual([]);
  expect(pack.personaGroundingKnownUnknowns).toEqual([]);
});
