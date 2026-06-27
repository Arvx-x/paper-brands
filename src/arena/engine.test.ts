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

test("sustained pressure (cumulativePressure) on a skeptic shrinks WTP below base (anti-sycophancy)", () => {
  const { wtp } = computeWtp({ ...base, skepticism: 0.9 }, g(), 1.0);
  expect(wtp).toBeLessThan(base.basePMax);
});

test("grades.pressureScore alone does NOT move WTP (it is consumed upstream as cumulativePressure)", () => {
  const noPressure = computeWtp(base, g({ pressureScore: 0 }), 0).wtp;
  const highPressureGrade = computeWtp(base, g({ pressureScore: 10 }), 0).wtp;
  expect(highPressureGrade).toBe(noPressure);
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

test("NaN numeric inputs fail safe (no NaN leaks; unaffordable => PUSH_BACK)", () => {
  expect(computeWtp(base, g({ valueScore: 5 }), NaN).wtp).not.toBeNaN();
  const out = decide(base, g({ valueScore: 9 }), NaN as unknown as number, 1000, 4, 0, () => 0.0);
  expect(out.decision).toBe("PUSH_BACK");
  expect(out.conviction).not.toBeNaN();
});

test("breakdown components are consistent with wtp when above the floor", () => {
  const r = computeWtp(base, g({ traumaResolutionScore: 6, valueScore: 6 }), 0);
  const sum = base.basePMax + r.breakdown.trustGain + r.breakdown.valueGain + r.breakdown.impulseGain - r.breakdown.pressurePenalty;
  // wtp equals rounded raw (above floor); allow rounding slack of a few units from component rounding.
  expect(Math.abs(r.wtp - sum)).toBeLessThanOrEqual(2);
});

test("WTP is floored at 70% of base under crushing pressure", () => {
  const { wtp } = computeWtp({ ...base, skepticism: 1 }, g(), 1.5);
  expect(wtp).toBe(Math.round(base.basePMax * 0.7));
});

test("mid-negotiation: walking away with low conviction REJECTs early", () => {
  const out = decide(base, g({ valueScore: 0, traumaResolutionScore: 0, desiredAction: "WALKING_AWAY" }), 10000, 5000, 2, 0, () => 0.99);
  expect(out.decision).toBe("REJECT");
});

test("mid-negotiation: affordable but not yet convinced keeps deliberating (PUSH_BACK)", () => {
  const out = decide(base, g({ valueScore: 4 }), 10000, 5000, 2, 0, () => 0.99);
  expect(out.decision).toBe("PUSH_BACK");
});
