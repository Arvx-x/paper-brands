import { test, expect } from "bun:test";
import { spearman } from "./stats.ts";

test("perfect monotonic increasing => rho ~ 1", () => {
  const rho = spearman([[1, 10], [2, 20], [3, 30], [4, 40]]);
  expect(rho).toBeCloseTo(1, 5);
});

test("perfect monotonic decreasing => rho ~ -1", () => {
  const rho = spearman([[1, 40], [2, 30], [3, 20], [4, 10]]);
  expect(rho).toBeCloseTo(-1, 5);
});

test("ties handled via average ranks", () => {
  const rho = spearman([[1, 5], [1, 6], [2, 7], [3, 8]]);
  expect(rho).toBeGreaterThanOrEqual(-1);
  expect(rho).toBeLessThanOrEqual(1);
});

test("fewer than 2 points => 0", () => {
  expect(spearman([[1, 1]])).toBe(0);
  expect(spearman([])).toBe(0);
});
