import { test, expect } from "bun:test";
import { wilsonInterval, wilsonMoePct, mean, stddev, makeRng } from "./stats.ts";

test("wilson interval is valid at p=0 (Wald would give 0)", () => {
  const { low, high } = wilsonInterval(0, 10);
  expect(low).toBe(0);
  expect(high).toBeGreaterThan(0.2); // ~0.278, not 0
});

test("wilson MoE shrinks as n grows", () => {
  expect(wilsonMoePct(0.5, 100)).toBeLessThan(wilsonMoePct(0.5, 25));
});

test("mean and stddev", () => {
  expect(mean([12, 20, 16])).toBeCloseTo(16, 5);
  expect(stddev([12, 20, 16])).toBeCloseTo(4, 5);
  expect(stddev([5])).toBe(0); // <2 points
});

test("seeded rng is deterministic per seed and differs across seeds", () => {
  const a1 = makeRng("x")();
  const a2 = makeRng("x")();
  const b = makeRng("y")();
  expect(a1).toBe(a2);
  expect(a1).not.toBe(b);
  expect(a1).toBeGreaterThanOrEqual(0);
  expect(a1).toBeLessThan(1);
});
