import { test, expect } from "bun:test";
import { shouldUseSourceForGrievances, containsQuote, dedupeByQuote, looksLikeComplaint } from "./grievanceExtract.ts";

const src = (sourceClass: string, rawText: string) => ({ finalUrl: "u", sourceClass, independent: sourceClass === "community", rawText }) as any;

test("source filtering includes community, and marketplace only with negative complaint markers", () => {
  expect(shouldUseSourceForGrievances(src("community", "anything"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("marketplace", "this serum stings and caused irritation"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("marketplace", "brightens skin and hydrates"))).toBe(false);
  expect(shouldUseSourceForGrievances(src("brand", "review stings"))).toBe(false);
  expect(shouldUseSourceForGrievances(src("editorial", "review stings"))).toBe(false);
});

test("unknown source included only when complaint markers appear", () => {
  expect(shouldUseSourceForGrievances(src("unknown", "customer reviews say this serum stings and caused irritation"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("unknown", "this article says LAA can sting but is effective"))).toBe(false);
  expect(shouldUseSourceForGrievances(src("unknown", "best vitamin c serum guide"))).toBe(false);
});

test("containment verification normalizes case/punctuation/spacing", () => {
  expect(containsQuote("This serum STINGS badly!", "serum stings badly")).toBe(true);
  expect(containsQuote("This serum works well", "caused rash")).toBe(false);
});

test("looksLikeComplaint filters positives and keeps negative use experiences", () => {
  expect(looksLikeComplaint("this serum stings badly and caused irritation")).toBe(true);
  expect(looksLikeComplaint("I completely loved the visible results")).toBe(false);
  expect(looksLikeComplaint("Brightens Skin and promotes collagen")).toBe(false);
  expect(looksLikeComplaint("Fades dark spots")).toBe(false);
  expect(looksLikeComplaint("Non-sticky texture")).toBe(false);
  expect(looksLikeComplaint("Discontinue if irritation occurs")).toBe(false);
  expect(looksLikeComplaint("Slightly expensive")).toBe(true);
  expect(looksLikeComplaint("May irritate sensitive skin")).toBe(true);
});

test("dedupe by normalized quote", () => {
  const items = [
    { verbatimQuote: "It stings badly!", anxiety: "stinging", segment: "s" },
    { verbatimQuote: "it stings badly", anxiety: "burning", segment: "s" },
    { verbatimQuote: "turned orange", anxiety: "oxidation", segment: "s" },
  ];
  expect(dedupeByQuote(items).map((i) => i.verbatimQuote)).toEqual(["It stings badly!", "turned orange"]);
});
import { extractGroundedGrievances } from "./grievanceExtract.ts";

const fakeLlm = {
  completeJson: async () => ({ grievances: [
    { anxiety: "stinging fear", verbatimQuote: "serum stings badly", segment: "sensitive skin buyer" },
    { anxiety: "hallucinated", verbatimQuote: "not in source", segment: "sensitive skin buyer" },
    { anxiety: "bad segment", verbatimQuote: "turned orange", segment: "wrong segment" },
  ] }),
} as any;

test("extractGroundedGrievances keeps only contained quotes with valid segments", async () => {
  const sources = [{ finalUrl: "u", sourceClass: "marketplace", independent: false, rawText: "This serum stings badly and turned orange fast." }] as any;
  const out = await extractGroundedGrievances(sources, [{ seed: "sensitive skin buyer" }], fakeLlm, { maxTotal: 10 });
  expect(out).toHaveLength(1);
  expect(out[0]!.verified).toBe(true);
  expect(out[0]!.anxiety).toBe("stinging fear");
  expect(out[0]!.sourceUrl).toBe("u");
  expect(out[0]!.sourceClass).toBe("marketplace");
});

test("extractGroundedGrievances returns [] when no usable sources", async () => {
  const out = await extractGroundedGrievances([{ finalUrl: "u", sourceClass: "brand", independent: false, rawText: "stings" }] as any, [{ seed: "s" }], fakeLlm);
  expect(out).toEqual([]);
});
