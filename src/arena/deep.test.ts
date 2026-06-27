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

test("competitor wins when it is the most convincing affordable option", async () => {
  // Only the competitor (conceptId starts 'competitor:') is convinced+affordable.
  // negotiate is per-card; competitor card price = midPrice(mid band)=75000, candidate=60000.
  // Make the HIGHER-priced card (competitor) win by conviction, both affordable.
  const everyoneAffordableCompetitorBest = async (_t: any, card: any) =>
    card.priceMinor >= 70000
      ? { conviction: 0.9, finalWtp: 200000, affordable: true, bought: true, turns: 2, errored: false, lastObjection: "o" }
      : { conviction: 0.3, finalWtp: 200000, affordable: true, bought: false, turns: 3, errored: false, lastObjection: "o" };
  const arena = new DeepNegotiationArena(pack, 4, everyoneAffordableCompetitorBest as any);
  const res = await arena.run({ candidates, cohort, pack, opts: { seed: 1 } });
  expect(res[0]!.pickedConceptId.startsWith("competitor:")).toBe(true);
});

test("errored:true (not abstained) when every option fails", async () => {
  const allError = async () => ({ conviction: 0, finalWtp: 0, affordable: false, bought: false, turns: 1, errored: true, lastObjection: "" });
  const arena = new DeepNegotiationArena(pack, 4, allError as any);
  const res = await arena.run({ candidates, cohort, pack, opts: { seed: 1 } });
  expect(res[0]!.errored).toBe(true);
  expect(res[0]!.abstained).toBe(false);
  expect(res[0]!.pickedConceptId).toBe("");
});

test("includeCompetitors:false excludes competitor options from the slate", async () => {
  // Record which cards negotiate saw.
  const seen: string[] = [];
  const recorder = async (_t: any, card: any) => {
    seen.push(card.label);
    return { conviction: 0.1, finalWtp: 0, affordable: false, bought: false, turns: 4, errored: false, lastObjection: "o" };
  };
  const arena = new DeepNegotiationArena(pack, 4, recorder as any);
  await arena.run({ candidates, cohort, pack, opts: { seed: 1, includeCompetitors: false } });
  // Only candidates => only OPTION-A (1 candidate fixture). No competitor label.
  expect(seen.length).toBe(candidates.length);
});

test("same seed => identical results (determinism)", async () => {
  const byPrice = async (_t: any, card: any) => card.priceMinor <= 70000
    ? { conviction: 0.8, finalWtp: 90000, affordable: true, bought: true, turns: 2, errored: false, lastObjection: "o" }
    : { conviction: 0.1, finalWtp: 40000, affordable: false, bought: false, turns: 4, errored: false, lastObjection: "o" };
  const arena = new DeepNegotiationArena(pack, 4, byPrice as any);
  const a = await arena.run({ candidates, cohort, pack, opts: { seed: 7 } });
  const b = await arena.run({ candidates, cohort, pack, opts: { seed: 7 } });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("parallel option negotiation yields identical results to a fixed-output fake (deterministic, order-independent)", async () => {
  // negotiate fake returns per-card deterministic outcomes but resolves in RANDOM time,
  // so if selection depended on completion order, results would vary. They must not.
  const fake = async (_t: any, card: any) => {
    await new Promise((r) => setTimeout(r, Math.random() * 5)); // jittered resolution
    // conviction keyed to price so the winner is deterministic by VALUE, not timing.
    const conviction = card.priceMinor <= 60000 ? 0.8 : 0.4;
    return { conviction, finalWtp: 90000, affordable: true, bought: conviction > 0.5, turns: 2, errored: false, lastObjection: "o" };
  };
  // reuse the existing pack/candidates/cohort fixtures in this file (or import as needed)
  const arena = new DeepNegotiationArena(pack, 4, fake as any);
  const a = await arena.run({ candidates, cohort, pack, opts: { seed: 9 } });
  const b = await arena.run({ candidates, cohort, pack, opts: { seed: 9 } });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // identical across runs despite jitter
});

test("winning pick carries rich signals (confidence, perOptionWtpMinor, turnsToDecision)", async () => {
  const win = async (_t: any, card: any) => ({ conviction: 0.7, finalWtp: 90000, affordable: true, bought: true, turns: 2, errored: false, lastObjection: "safety" });
  const arena = new DeepNegotiationArena(pack, 4, win as any);
  const res = await arena.run({ candidates, cohort, pack, opts: { seed: 1 } });
  expect(res[0]!.confidence).toBeGreaterThan(0);
  expect(res[0]!.turnsToDecision).toBe(2);
  expect(Object.keys(res[0]!.perOptionWtpMinor ?? {}).length).toBeGreaterThanOrEqual(1);
});
