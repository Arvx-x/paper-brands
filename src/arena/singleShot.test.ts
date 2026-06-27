import { test, expect } from "bun:test";
import { SingleShotArena } from "./singleShot.ts";

const minimalPack = { currency: "INR", competitorArchetypes: [], priceBands: [{ label: "mid", lowMinor: 50000, highMinor: 100000 }] } as any;
const candidate = {
  id: "c1", name: "X", positioning: "p", targetCustomer: "t", coreInsight: "i",
  productPromise: "pp", heroSku: "30ml", priceMinor: 60000, priceBand: "mid",
  tagline: "tg", claims: ["c"], packagingDirection: "pd", brandVoice: "v",
  landingHeadline: "lh", topAdAngles: [], objections: [], launchRisks: [],
} as any;
const persona = { id: "p1", segment: "s", name: "n", age: 30, context: "c", budgetSensitivity: "medium", primaryNeed: "n", anxieties: ["a"], decisionStyle: "d", shoppingContext: "browsing" } as any;

test("SingleShotArena advertises its kind and cost on the contract", () => {
  const a = new SingleShotArena(minimalPack);
  expect(a.kind).toBe("single-shot");
  expect(a.costClass).toBe("cheap");
  expect(typeof a.run).toBe("function");
});

test("a failed LLM choice yields errored:true (not a silent drop)", async () => {
  const stubLlm = { completeJson: async () => { throw new Error("llm down"); } } as any;
  const arena = new SingleShotArena(minimalPack, stubLlm, 2);
  const res = await arena.run({ candidates: [candidate], cohort: [persona], pack: minimalPack, opts: { includeCompetitors: false } });
  expect(res).toHaveLength(1);
  expect(res[0]!.errored).toBe(true);
  expect(res[0]!.pickedConceptId).toBe("");
});
