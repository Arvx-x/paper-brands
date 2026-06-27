import { test, expect } from "bun:test";
import { Council } from "./council.ts";

// Minimal pack stub; only fields the Council reads need to be plausible.
const pack: any = {
  name: "Fragrance", geography: "India", currency: "INR",
  unmetNeeds: [], purchaseTriggers: [], rejectionReasons: [],
  priceBands: [{ label: "value" }, { label: "premium" }],
  competitorArchetypes: [], complianceNotes: [],
};

// Fake agent council via a fake LLM is heavy; instead we stub the Council's own methods.
// We test the orchestration: over-generate -> tag -> select -> re-roll -> report.

function makeCouncil(territoriesByCall: any[][], tagsByCall: any[][], avoidCalls: string[][] = []) {
  const c = new Council(pack, { completeJson: async () => ({}) } as any);
  let propCall = 0, tagCall = 0;
  (c as any).proposeTerritories = async (_perAgent = 2, _avoid: string[] = []) => {
    avoidCalls.push([..._avoid]);
    return territoriesByCall[propCall++] ?? [];
  };
  // stub specifyBrand to echo a concept from the territory
  (c as any).specifyBrand = async (t: any) => ({
    id: t.name.toLowerCase().replace(/\s+/g, "-"), name: t.name, positioning: t.thesis,
    targetCustomer: "x", coreInsight: "x", productPromise: "x", heroSku: "x",
    priceMinor: 100000, priceBand: "premium", tagline: "x", claims: [], packagingDirection: "x",
    brandVoice: "x", landingHeadline: "x", topAdAngles: [], objections: [], launchRisks: [],
  });
  // stub the tagger module call by monkeypatching via injected tagFn
  (c as any).__tagFn = async (terrs: any[]) => (tagsByCall[tagCall++] ?? []).map((f: any, i: number) => ({
    territoryIndex: i, territoryName: terrs[i]?.name ?? `t${i}`, fingerprint: f,
  }));
  return c;
}

test("rich pool -> no re-roll, distinct slate, no warning", async () => {
  const terrs = [
    { name: "A", thesis: "clean", primarySegment: "sensitive-skin" },
    { name: "B", thesis: "longevity", primarySegment: "everyday" },
    { name: "C", thesis: "gifting", primarySegment: "luxury" },
  ];
  const tags = [
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { wedge: "longevity", segment: "everyday", tier: "value" },
    { wedge: "gifting", segment: "luxury", tier: "premium" },
  ];
  const c = makeCouncil([terrs], [tags]);
  const { concepts, diversity } = await c.generateCandidates(3, 0);
  expect(concepts).toHaveLength(3);
  expect(diversity.rerolled).toBe(false);
  expect(diversity.distinctWedgeCount).toBe(3);
  expect(diversity.warning).toBeUndefined();
});

test("collapsed pool -> triggers ONE re-roll, then flags lowConceptDiversity if still collapsed", async () => {
  const collapsed = [
    { name: "A", thesis: "clean", primarySegment: "sensitive-skin" },
    { name: "B", thesis: "clean2", primarySegment: "sensitive-skin" },
    { name: "C", thesis: "clean3", primarySegment: "sensitive-skin" },
  ];
  const sameTags = [
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
  ];
  // both the first pool and the re-roll pool collapse to one wedge
  const c = makeCouncil([collapsed, collapsed], [sameTags, sameTags]);
  const { diversity } = await c.generateCandidates(3, 0);
  expect(diversity.rerolled).toBe(true);
  expect(diversity.distinctWedgeCount).toBe(1);
  expect(diversity.warning).toBe("lowConceptDiversity");
});

test("collapsed first pool + distinct re-roll -> improves diversity and passes avoid-list", async () => {
  const first = [
    { name: "A", thesis: "clean", primarySegment: "sensitive-skin" },
    { name: "B", thesis: "clean2", primarySegment: "sensitive-skin" },
    { name: "C", thesis: "clean3", primarySegment: "sensitive-skin" },
  ];
  const second = [
    { name: "D", thesis: "long-lasting in heat", primarySegment: "everyday" },
    { name: "E", thesis: "premium gifting", primarySegment: "luxury" },
  ];
  const firstTags = [
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
    { wedge: "clean", segment: "sensitive-skin", tier: "premium" },
  ];
  const secondTags = [
    { wedge: "longevity", segment: "everyday", tier: "value" },
    { wedge: "gifting", segment: "luxury", tier: "premium" },
  ];
  const avoidCalls: string[][] = [];
  const c = makeCouncil([first, second], [firstTags, secondTags], avoidCalls);
  const { concepts, diversity } = await c.generateCandidates(3, 0);
  expect(diversity.rerolled).toBe(true);
  expect(diversity.distinctWedgeCount).toBe(3);
  expect(diversity.warning).toBeUndefined();
  expect(avoidCalls[1]).toEqual(["clean"]);
  expect(concepts.map((x) => x.name)).toEqual(expect.arrayContaining(["D", "E"]));
});
