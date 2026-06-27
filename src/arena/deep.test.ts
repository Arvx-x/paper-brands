import { test, expect } from "bun:test";
import { DeepNegotiationArena } from "./deep.ts";

const pack = {
  currency: "INR",
  priceBands: [{ label: "mid", lowMinor: 50000, highMinor: 100000 }],
  competitorArchetypes: [{ codeName: "ALPHA", description: "premium", pricePositioning: "mid", claims: ["x"], strengths: [], weaknesses: [], evidence: [], realExamples: [] }],
} as any;

const candidates = [{
  id: "c1", name: "X", positioning: "p", targetCustomer: "t", coreInsight: "i",
  productPromise: "pp", heroSku: "30ml", priceMinor: 60000, priceBand: "mid",
  tagline: "tg", claims: ["c"], packagingDirection: "pd", brandVoice: "v",
  landingHeadline: "lh", topAdAngles: [], objections: [], launchRisks: [],
}] as any;

const cohort = [{ id: "p1", segment: "s", name: "Asha", age: 30, context: "c", budgetSensitivity: "medium", primaryNeed: "n", anxieties: ["a"], decisionStyle: "researcher", shoppingContext: "browsing" }] as any;

test("candidate wins when it is the only convinced+affordable option", async () => {
  // negotiate is called per CARD; distinguish by price (candidate 60000, competitor mid-band 75000).
  const byPrice = async (_t: any, card: any) => card.priceMinor <= 70000
    ? { conviction: 0.8, finalWtp: 90000, affordable: true, bought: true, turns: 2, errored: false, lastObjection: "o" }
    : { conviction: 0.1, finalWtp: 40000, affordable: false, bought: false, turns: 4, errored: false, lastObjection: "o" };
  const arena = new DeepNegotiationArena(pack, 4, byPrice as any);
  const res = await arena.run({ candidates, cohort, pack, opts: { seed: 1 } });
  expect(res).toHaveLength(1);
  expect(res[0]!.pickedConceptId).toBe("c1");
  expect(res[0]!.confidence).toBeGreaterThan(0);
});

test("abstains when nothing is affordable", async () => {
  const noneAfford = async () => ({ conviction: 0.1, finalWtp: 10000, affordable: false, bought: false, turns: 4, errored: false, lastObjection: "o" });
  const arena = new DeepNegotiationArena(pack, 4, noneAfford as any);
  const res = await arena.run({ candidates, cohort, pack, opts: { seed: 1 } });
  expect(res[0]!.abstained).toBe(true);
  expect(res[0]!.pickedConceptId).toBe("");
});

test("arena advertises kind and cost", () => {
  const arena = new DeepNegotiationArena(pack);
  expect(arena.kind).toBe("deep-negotiation");
  expect(arena.costClass).toBe("expensive");
});
