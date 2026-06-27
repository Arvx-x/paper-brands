import { test, expect } from "bun:test";
import { DeepNegotiationArena } from "./deep.ts";

const pack = {
  currency: "INR",
  priceBands: [{ label: "mid", lowMinor: 50000, highMinor: 100000 }],
  competitorArchetypes: [],
  benchmarkBrands: [
    { auditId: "bm-a", realName: "RealA", claims: ["x"], priceMinor: 60000, format: "f", reviewCount: 100, rating: 4, retailer: "r", tractionScore: 0.8, evidence: [] },
  ],
} as any;

const candidates = [{
  id: "c1", name: "X", positioning: "p", targetCustomer: "t", coreInsight: "i",
  productPromise: "pp", heroSku: "30ml", priceMinor: 60000, priceBand: "mid",
  tagline: "tg", claims: ["c"], packagingDirection: "pd", brandVoice: "v",
  landingHeadline: "lh", topAdAngles: [], objections: [], launchRisks: [],
}] as any;

const cohort = [{ id: "p1", segment: "s", name: "Asha", age: 30, context: "c", budgetSensitivity: "medium", primaryNeed: "n", anxieties: ["a"], decisionStyle: "d", shoppingContext: "b" }] as any;

test("benchmark brand appears in the slate as a benchmark: concept (never its real name)", async () => {
  const seenCards: string[] = [];
  const recorder = async (_t: any, card: any) => {
    seenCards.push(JSON.stringify(card));
    return { conviction: 0.1, finalWtp: 0, affordable: false, bought: false, turns: 4, errored: false, lastObjection: "o" };
  };
  const arena = new DeepNegotiationArena(pack, 4, recorder as any);
  await arena.run({ candidates, cohort, pack, opts: { seed: 1, includeCompetitors: true } });
  const all = seenCards.join(" ");
  expect(all).not.toContain("RealA");           // blind control
  expect(seenCards.length).toBe(2);             // 1 candidate + 1 benchmark
});
