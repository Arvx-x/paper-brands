import { test, expect } from "bun:test";
import { computeWtp, decide, type Grades } from "./engine.ts";
import { makeRng } from "./stats.ts";

const base = { basePMax: 10000, skepticism: 0.5, impulsivity: 0.4, priceConsciousness: 0.5, reluctancePrior: "x" };
const g = (o: Partial<Grades> = {}): Grades => ({
  traumaResolutionScore: 0, valueScore: 0, pressureScore: 0,
  impulseTriggers: { scarcity: false, socialProof: false, novelty: false, emotionalAppeal: false },
  desiredAction: "STILL_OBJECTING", ...o,
});

test("high value with no pressure stretches WTP above base", () => {
  const { wtp } = computeWtp(base, g({ valueScore: 9 }), 0);
  expect(wtp).toBeGreaterThan(base.basePMax);
});

test("impulse triggers gated by impulsivity trait", () => {
  const triggers = { scarcity: true, socialProof: true, novelty: false, emotionalAppeal: true };
  const impulsive = computeWtp({ ...base, impulsivity: 0.9 }, g({ impulseTriggers: triggers }), 0).wtp;
  const disciplined = computeWtp({ ...base, impulsivity: 0.1 }, g({ impulseTriggers: triggers }), 0).wtp;
  expect(impulsive).toBeGreaterThan(disciplined);
});

test("sustained pressure on a skeptic shrinks WTP below base (anti-sycophancy)", () => {
  const { wtp } = computeWtp({ ...base, skepticism: 0.9 }, g({ pressureScore: 8 }), 1.0);
  expect(wtp).toBeLessThan(base.basePMax);
});

test("price above WTP never buys", () => {
  const out = decide(base, g({ valueScore: 9 }), 20000 /*wtp*/, 30000 /*price*/, 4, 0, makeRng("z"));
  expect(out.decision).toBe("PUSH_BACK");
});

test("final turn: convinced + affordable buys with high probability", () => {
  let buys = 0;
  for (let i = 0; i < 500; i++) {
    const out = decide({ ...base, skepticism: 0.2 }, g({ valueScore: 9, traumaResolutionScore: 8, desiredAction: "WANT_TO_BUY" }),
      15000, 10000, 4, 0, makeRng("seed" + i));
    if (out.decision === "BUY") buys++;
  }
  expect(buys / 500).toBeGreaterThan(0.5);
});
