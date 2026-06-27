import { test, expect } from "bun:test";
import { formatReport, type TournamentOutput } from "./tournament.ts";
import type { DiversityReport } from "../council/diversity.ts";

function baseOut(div?: DiversityReport): TournamentOutput {
  return {
    categoryId: "fragrance-india",
    concepts: [],
    report: {
      totalTrials: 40,
      concepts: [],
      winner: { conceptId: "c1", name: "EcoLips", winRate: 0.4, winRateCiLow: 0.3, winRateCiHigh: 0.5, topObjections: [] },
    } as any,
    conceptDiversity: div,
  };
}

test("healthy diversity -> 'N of M distinct wedges' line, no warning", () => {
  const txt = formatReport(baseOut({
    requested: 4, distinctWedgeCount: 3, spannedWedges: ["clean", "gifting", "longevity"],
    poolSize: 16, rerolled: false,
  }));
  expect(txt).toContain("Concept diversity: 3 of 4 distinct wedges");
  expect(txt).toContain("clean");
  expect(txt).not.toContain("LOW CONCEPT DIVERSITY");
});

test("collapsed diversity -> LOW CONCEPT DIVERSITY warning line", () => {
  const txt = formatReport(baseOut({
    requested: 4, distinctWedgeCount: 1, spannedWedges: ["clean"],
    poolSize: 32, rerolled: true, warning: "lowConceptDiversity",
  }));
  expect(txt).toContain("LOW CONCEPT DIVERSITY");
  expect(txt).toContain("re-rolled");
});

test("absent conceptDiversity -> no diversity lines (non-breaking)", () => {
  const txt = formatReport(baseOut(undefined));
  expect(txt).not.toContain("Concept diversity");
  expect(txt).not.toContain("LOW CONCEPT DIVERSITY");
});
