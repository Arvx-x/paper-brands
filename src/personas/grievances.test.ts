import { test, expect } from "bun:test";
import { tagGrievancesToSegments, sampleGrievances, cohortDiversity, type SegmentSeed } from "./grievances.ts";
import type { EvidencedItem } from "../categories/types.ts";
import type { GroundedGrievance } from "../categories/types.ts";

const ev = (text: string, verified: boolean): EvidencedItem => ({
  text, quote: text, sourceUrl: "u", verified, independent: true,
});
const segs: SegmentSeed[] = [
  { seed: "dry-lips relief seeker" },
  { seed: "budget marketplace buyer" },
];

test("tagging keeps ONLY verified items and assigns each to its best segment", () => {
  const items = [ev("balm gave no relief for my chronic dryness", true), ev("too pricey for what it is", true), ev("unverified junk", false)];
  const g = tagGrievancesToSegments(items, segs, (text) =>
    text.includes("dry") ? "dry-lips relief seeker" : "budget marketplace buyer",
  );
  expect(g.length).toBe(2);
  expect(g.every((x) => x.verified)).toBe(true);
  expect(g.find((x) => x.anxiety.includes("dryness"))!.segment).toBe("dry-lips relief seeker");
});

test("sampling is without-replacement within a segment until pool exhausts, seeded", () => {
  const pool: GroundedGrievance[] = ["a", "b", "c"].map((q) => ({
    segment: "s", anxiety: q, verbatimQuote: q, sourceUrl: "", sourceClass: "", verified: true,
  }));
  const a = sampleGrievances(pool, 3, "seed1");
  expect(new Set(a.map((x) => x.anxiety)).size).toBe(3);
  const a2 = sampleGrievances(pool, 3, "seed1");
  expect(a2.map((x) => x.anxiety)).toEqual(a.map((x) => x.anxiety));
  const over = sampleGrievances(pool, 5, "seed1");
  expect(over.length).toBe(5);
});

test("cohortDiversity = distinct anxieties / personas", () => {
  expect(cohortDiversity(["x", "x", "y", "z"])).toBeCloseTo(3 / 4, 5);
  expect(cohortDiversity([])).toBe(0);
});
