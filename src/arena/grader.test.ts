import { test, expect } from "bun:test";
import { GradesSchema, buildGraderPrompt } from "./grader.ts";

test("GradesSchema accepts a well-formed grade object", () => {
  const parsed = GradesSchema.parse({
    traumaResolutionScore: 7, valueScore: 6, pressureScore: 2,
    impulseTriggers: { scarcity: true, socialProof: false, novelty: false, emotionalAppeal: false },
    desiredAction: "STILL_OBJECTING", spokenObjection: "is it safe?",
  });
  expect(parsed.valueScore).toBe(6);
  expect(parsed.impulseTriggers.scarcity).toBe(true);
});

test("GradesSchema coerces/repairs an out-of-range score and bad action", () => {
  const parsed = GradesSchema.parse({
    traumaResolutionScore: 99, valueScore: -5, pressureScore: 3,
    impulseTriggers: {}, desiredAction: "MAYBE", spokenObjection: "",
  });
  expect(parsed.traumaResolutionScore).toBeLessThanOrEqual(10);
  expect(parsed.valueScore).toBeGreaterThanOrEqual(0);
  expect(parsed.desiredAction).toBe("STILL_OBJECTING"); // fallback
});

test("prompt is third-person and contains the rendered card + persona traits", () => {
  const p = buildGraderPrompt(
    "OPTION-A\nHeadline: hi\nClaims: x\nPrice: 699 INR",
    { name: "Asha", demographic: "30, designer", reluctancePrior: "rash once", skepticism: 0.8, impulsivity: 0.3, priceConsciousness: 0.6 } as any,
    2,
  );
  expect(p).toContain("OPTION-A");
  expect(p).toContain("Asha");
  expect(p).toContain("rash once");
  expect(p.toLowerCase()).toContain("do not"); // anti-sycophancy clause
});
