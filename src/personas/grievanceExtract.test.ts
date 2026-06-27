import { test, expect } from "bun:test";
import { shouldUseSourceForGrievances, containsQuote, dedupeByQuote, verifyGrievances, extractGroundedGrievances } from "./grievanceExtract.ts";

const src = (sourceClass: string, rawText: string) => ({ finalUrl: "u", sourceClass, independent: sourceClass === "community", rawText }) as any;

test("source filtering includes community, and marketplace only with negative complaint markers", () => {
  expect(shouldUseSourceForGrievances(src("community", "anything"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("marketplace", "this serum stings and caused irritation"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("marketplace", "brightens skin and hydrates"))).toBe(false);
  expect(shouldUseSourceForGrievances(src("brand", "review stings"))).toBe(false);
  expect(shouldUseSourceForGrievances(src("editorial", "review stings"))).toBe(false);
});

test("unknown source included only when review-context + complaint markers appear", () => {
  expect(shouldUseSourceForGrievances(src("unknown", "customer reviews say this serum stings and caused irritation"))).toBe(true);
  expect(shouldUseSourceForGrievances(src("unknown", "this article says LAA can sting but is effective"))).toBe(false);
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

// Fake verifier that approves complaint-like quotes by a simple keyword (stands in for the LLM).
const fakeVerify = async (cands: any[]) =>
  cands.filter((c) => /sting|irritat|orange|expensive|waste/i.test(c.verbatimQuote));

test("verifyGrievances keeps only indices the verifier LLM approves", async () => {
  const cands = [
    { anxiety: "a", verbatimQuote: "serum stings badly", segment: "s" },
    { anxiety: "b", verbatimQuote: "brightens skin nicely", segment: "s" },
  ];
  const llm = { completeJson: async () => ({ keep: [0] }) } as any;
  const out = await verifyGrievances(cands, llm);
  expect(out).toHaveLength(1);
  expect(out[0]!.verbatimQuote).toBe("serum stings badly");
});

test("verifyGrievances fails closed (returns []) when the verifier errors", async () => {
  const cands = [{ anxiety: "a", verbatimQuote: "serum stings badly", segment: "s" }];
  const llm = { completeJson: async () => { throw new Error("down"); } } as any;
  const out = await verifyGrievances(cands, llm);
  expect(out).toEqual([]);
});

test("extractGroundedGrievances keeps contained, valid-segment, verifier-approved complaints", async () => {
  const extractLlm = { completeJson: async () => ({ grievances: [
    { anxiety: "stinging fear", verbatimQuote: "serum stings badly", segment: "sensitive skin buyer" },
    { anxiety: "marketing", verbatimQuote: "brightens skin nicely", segment: "sensitive skin buyer" },
    { anxiety: "hallucinated", verbatimQuote: "not in source", segment: "sensitive skin buyer" },
    { anxiety: "bad segment", verbatimQuote: "turned orange", segment: "wrong segment" },
  ] }) } as any;
  const sources = [{ finalUrl: "u", sourceClass: "marketplace", independent: false, rawText: "This serum stings badly and brightens skin nicely and turned orange fast." }] as any;
  const out = await extractGroundedGrievances(sources, [{ seed: "sensitive skin buyer" }], extractLlm, { maxTotal: 10, verify: fakeVerify as any });
  // contained + valid segment: "serum stings badly", "brightens skin nicely". verifier keeps only the complaint.
  expect(out).toHaveLength(1);
  expect(out[0]!.verbatimQuote).toBe("serum stings badly");
  expect(out[0]!.verified).toBe(true);
  expect(out[0]!.sourceClass).toBe("marketplace");
});

test("extractGroundedGrievances returns [] when no usable sources", async () => {
  const llm = { completeJson: async () => ({ grievances: [] }) } as any;
  const out = await extractGroundedGrievances([{ finalUrl: "u", sourceClass: "brand", independent: false, rawText: "stings" }] as any, [{ seed: "s" }], llm, { verify: fakeVerify as any });
  expect(out).toEqual([]);
});

test("extractGroundedGrievances skips malformed LLM items with missing verbatimQuote", async () => {
  const badLlm = { completeJson: async () => ({ grievances: [
    { anxiety: "missing quote", segment: "sensitive skin buyer" },
    { anxiety: "valid", verbatimQuote: "serum stings badly", segment: "sensitive skin buyer" },
  ] }) } as any;
  const sources = [{ finalUrl: "u", sourceClass: "marketplace", independent: false, rawText: "This serum stings badly." }] as any;
  const out = await extractGroundedGrievances(sources, [{ seed: "sensitive skin buyer" }], badLlm, { verify: fakeVerify as any });
  expect(out).toHaveLength(1);
  expect(out[0]!.anxiety).toBe("valid");
});
