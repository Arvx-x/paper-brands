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

test("healthy diversity -> 'N of M distinct positioning fingerprints' line, no warning", () => {
  const txt = formatReport(baseOut({
    requested: 4, distinctWedgeCount: 3, spannedWedges: ["clean", "gifting", "longevity"],
    poolSize: 16, rerolled: false,
  }));
  expect(txt).toContain("Concept diversity: 3 of 4 distinct positioning fingerprints");
  expect(txt).toContain("[wedges: clean, gifting, longevity]");
  expect(txt).not.toContain("LOW CONCEPT DIVERSITY");
});

test("healthy diversity singularizes fingerprint", () => {
  const txt = formatReport(baseOut({
    requested: 1, distinctWedgeCount: 1, spannedWedges: ["clean"],
    poolSize: 4, rerolled: false,
  }));
  expect(txt).toContain("Concept diversity: 1 of 1 distinct positioning fingerprint");
  expect(txt).not.toContain("distinct positioning fingerprints");
});

test("same wedge with multiple fingerprints is reported as fingerprints, not wedges", () => {
  const txt = formatReport(baseOut({
    requested: 2, distinctWedgeCount: 2, spannedWedges: ["clean"],
    poolSize: 8, rerolled: false,
  }));
  expect(txt).toContain("2 of 2 distinct positioning fingerprints");
  expect(txt).toContain("[wedges: clean]");
  expect(txt).not.toContain("2 of 2 distinct wedges");
});

test("collapsed diversity -> LOW CONCEPT DIVERSITY warning line", () => {
  const txt = formatReport(baseOut({
    requested: 4, distinctWedgeCount: 1, spannedWedges: ["clean"],
    poolSize: 32, rerolled: true, warning: "lowConceptDiversity",
  }));
  expect(txt).toContain("LOW CONCEPT DIVERSITY");
  expect(txt).toContain("1 distinct positioning fingerprint");
  expect(txt).toContain("re-rolled");
});

test("absent conceptDiversity -> no diversity lines (non-breaking)", () => {
  const txt = formatReport(baseOut(undefined));
  expect(txt).not.toContain("Concept diversity");
  expect(txt).not.toContain("LOW CONCEPT DIVERSITY");
});
