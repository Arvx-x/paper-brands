import { test, expect } from "bun:test";
import { renderCardForDeep, renderPitchFlat, normalizeLen } from "./card.ts";
import type { BlindCard } from "../brand/types.ts";

const card: BlindCard = {
  label: "OPTION-A",
  headline: "Fade dark spots, gently",
  body: "Clinical pigmentation care for sensitive skin.",
  claims: ["10% niacinamide", "fragrance-free"],
  format: "30ml serum",
  priceMinor: 69900,
  pitch: "flat fallback",
};

test("deep render includes structured sections and price in major units", () => {
  const out = renderCardForDeep(card, "INR");
  expect(out).toContain("OPTION-A");
  expect(out).toContain("Fade dark spots");
  expect(out).toContain("10% niacinamide");
  expect(out).toContain("699"); // 69900 minor -> 699 major
  expect(out).toContain("30ml serum");
});

test("flat pitch render is a single line for single-shot", () => {
  const out = renderPitchFlat(card, "INR");
  expect(out.split("\n").length).toBe(1);
  expect(out).toContain("699");
});

test("normalizeLen truncates to a word budget without cutting mid-word", () => {
  const r = normalizeLen("one two three four five", 3);
  expect(r).toBe("one two three");
});
