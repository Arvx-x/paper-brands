import { test, expect } from "bun:test";
import { aggregateRunStats } from "./tournament.ts";

test("aggregateRunStats computes mean and sample std", () => {
  const s = aggregateRunStats([0.2, 0.4, 0.3]);
  expect(s.runs).toBe(3);
  expect(s.meanWinRate).toBeCloseTo(0.3, 5);
  expect(s.stdWinRate).toBeCloseTo(0.1, 5); // sample std of [.2,.4,.3]
});
