import { test, expect } from "bun:test";
import { negotiate } from "./negotiation.ts";
import type { Grades } from "./engine.ts";

const traits = { basePMax: 10000, skepticism: 0.3, impulsivity: 0.4, priceConsciousness: 0.5, reluctancePrior: "x" };
const card = { label: "OPTION-A", headline: "h", body: "b", claims: ["c"], format: "f", priceMinor: 8000, pitch: "p" };

const fixedGrader = (g: Partial<Grades>) => async (): Promise<Grades & { spokenObjection: string }> => ({
  traumaResolutionScore: 0, valueScore: 0, pressureScore: 0,
  impulseTriggers: { scarcity: false, socialProof: false, novelty: false, emotionalAppeal: false },
  desiredAction: "STILL_OBJECTING", spokenObjection: "o", ...g,
});

test("strong value + affordable price => bought with conviction and a final WTP", async () => {
  const r = await negotiate(traits, card, "INR", "seed1",
    fixedGrader({ valueScore: 10, traumaResolutionScore: 9, desiredAction: "WANT_TO_BUY" }));
  expect(r.bought).toBe(true);
  expect(r.finalWtp).toBeGreaterThanOrEqual(card.priceMinor);
  expect(r.conviction).toBeGreaterThan(0);
});

test("price above any reachable WTP => not bought, affordable=false", async () => {
  const dear = { ...card, priceMinor: 100000 };
  const r = await negotiate(traits, dear, "INR", "seed1", fixedGrader({ valueScore: 1 }));
  expect(r.bought).toBe(false);
  expect(r.affordable).toBe(false);
});

test("grader error mid-run is tolerated (option scored 0, not a crash)", async () => {
  const throwing = async () => { throw new Error("llm down"); };
  const r = await negotiate(traits, card, "INR", "seed1", throwing as any);
  expect(r.errored).toBe(true);
  expect(r.conviction).toBe(0);
});
