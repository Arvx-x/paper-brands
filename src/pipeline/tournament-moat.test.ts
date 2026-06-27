import { test, expect } from "bun:test";
import { formatReport, type TournamentOutput } from "./tournament.ts";
import type { MoatReport } from "../moat/types.ts";

function baseOut(moat?: MoatReport): TournamentOutput {
  return {
    categoryId: "lipcare-india",
    concepts: [],
    report: { totalTrials: 40, concepts: [], candidateShareVsField: 0.5, abstentionRate: 0, errorRate: 0, degraded: false, winner: null } as any,
    moat,
  };
}

const sample: MoatReport = {
  scored: 1, degraded: false,
  concepts: [
    { conceptId: "A", name: "Alpha", overall: 0.61, warnings: [],
      axes: [
        { name: "copyability", score: 0.7, rationale: "hard to clone" },
        { name: "proprietaryInsight", score: 0.65, rationale: "unique" },
        { name: "distributionWedge", score: 0.6, rationale: "rare angle" },
        { name: "brandTrustDurability", score: 0.5, rationale: "ok" },
      ] },
  ],
};

test("renders the moat block with overall + axis breakdown", () => {
  const txt = formatReport(baseOut(sample));
  expect(txt).toContain("Moat");
  expect(txt).toContain("Alpha");
  expect(txt).toContain("0.61");
  expect(txt).toContain("copy");
});

test("renders degraded flag when degraded", () => {
  const txt = formatReport(baseOut({ ...sample, degraded: true, concepts: [{ ...sample.concepts[0]!, warnings: ["x"] }] }));
  expect(txt).toContain("degraded");
});

test("absent moat -> no moat block (non-breaking)", () => {
  const txt = formatReport(baseOut(undefined));
  expect(txt).not.toContain("Moat (defensibility");
});
