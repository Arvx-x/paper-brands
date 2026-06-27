import { test, expect } from "bun:test";
import { shouldUseSourceForGrievances, containsQuote, dedupeByQuote } from "./grievanceExtract.ts";

const src = (sourceClass: string, rawText: string) => ({ finalUrl: "u", sourceClass, independent: sourceClass === "community", rawText }) as any;

test("source filtering includes marketplace/community and excludes brand/editorial", () => {
  expect(shouldUseSourceForGrievances(src("marketplace", "anything"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("community", "anything"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("brand", "review stings"))).toBe(false);
  expect(shouldUseSourceForGrievances(src("editorial", "review stings"))).toBe(false);
});

test("unknown source included only when complaint markers appear", () => {
  expect(shouldUseSourceForGrievances(src("unknown", "this serum stings and caused irritation"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("unknown", "best vitamin c serum guide"))).toBe(false);
});

test("containment verification normalizes case/punctuation/spacing", () => {
  expect(containsQuote("This serum STINGS badly!", "serum stings badly")).toBe(true);
  expect(containsQuote("This serum works well", "caused rash")).toBe(false);
});

test("dedupe by normalized quote", () => {
  const items = [
    { verbatimQuote: "It stings badly!", anxiety: "stinging", segment: "s" },
    { verbatimQuote: "it stings badly", anxiety: "burning", segment: "s" },
    { verbatimQuote: "turned orange", anxiety: "oxidation", segment: "s" },
  ];
  expect(dedupeByQuote(items).map((i) => i.verbatimQuote)).toEqual(["It stings badly!", "turned orange"]);
});
