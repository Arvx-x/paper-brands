import { test, expect } from "bun:test";
import { composeEquity } from "./calibrate.ts";

test("composeEquity averages only present components", () => {
  expect(composeEquity({ search: 0.2, distribution: 0.4 })).toBeCloseTo(0.3, 5);
  expect(composeEquity({ social: 0.6 })).toBeCloseTo(0.6, 5);
});

test("composeEquity returns undefined when no components present", () => {
  expect(composeEquity({})).toBeUndefined();
  expect(composeEquity(undefined)).toBeUndefined();
});

test("composeEquity does NOT zero-fill missing components", () => {
  // search alone at 0.6 -> 0.6, not 0.2 (would be if distribution/social zero-filled)
  expect(composeEquity({ search: 0.6 })).toBeCloseTo(0.6, 5);
});
