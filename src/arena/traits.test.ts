import { test, expect } from "bun:test";
import { deriveTraits } from "./traits.ts";
import type { Persona } from "../personas/cohort.ts";
import type { CategoryPack } from "../categories/types.ts";

const pack = {
  currency: "INR",
  priceBands: [
    { label: "budget", lowMinor: 20000, highMinor: 50000 },
    { label: "mid", lowMinor: 50000, highMinor: 100000 },
    { label: "premium", lowMinor: 100000, highMinor: 200000 },
  ],
} as CategoryPack;

const base: Persona = {
  id: "p1", segment: "s", name: "n", age: 30, context: "c",
  budgetSensitivity: "high", primaryNeed: "x", anxieties: ["got a rash once"],
  decisionStyle: "cautious researcher", shoppingContext: "browsing",
};

test("traits are in 0..1 and basePMax anchors to category median band (not an option)", () => {
  const t = deriveTraits(base, pack, "seedA");
  for (const k of ["skepticism", "impulsivity", "priceConsciousness"] as const) {
    expect(t[k]).toBeGreaterThanOrEqual(0);
    expect(t[k]).toBeLessThanOrEqual(1);
  }
  // median band is "mid" (50000..100000) => anchor near its midpoint, scaled by budget sensitivity.
  expect(t.basePMax).toBeGreaterThan(20000);
  expect(t.basePMax).toBeLessThan(150000);
  expect(t.reluctancePrior).toContain("rash");
});

test("high budgetSensitivity => higher priceConsciousness than low", () => {
  const hi = deriveTraits({ ...base, budgetSensitivity: "high" }, pack, "s");
  const lo = deriveTraits({ ...base, budgetSensitivity: "low" }, pack, "s");
  expect(hi.priceConsciousness).toBeGreaterThan(lo.priceConsciousness);
});

test("same seed deterministic; different seed differs (jitter present)", () => {
  const a = deriveTraits(base, pack, "seedA");
  const b = deriveTraits(base, pack, "seedA");
  const c = deriveTraits(base, pack, "seedB");
  expect(a.skepticism).toBe(b.skepticism);
  expect(a.skepticism).not.toBe(c.skepticism);
});
