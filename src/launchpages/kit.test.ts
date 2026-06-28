import { test, expect } from "bun:test";
import { deriveLiteKit } from "./kit.ts";
import { BrandKitSchema } from "../creative/types.ts";

function concept(over: Partial<any> = {}) {
  return { id: "C1", name: "Heritage Balm", positioning: "traditional Indian ingredients, premium hydration",
    targetCustomer: "young Indians", coreInsight: "cultural authenticity matters", productPromise: "nourish",
    heroSku: "Heritage Balm 10g", priceMinor: 49900, priceBand: "premium", tagline: "Embrace heritage",
    claims: ["natural"], packagingDirection: "x", brandVoice: "warm and rooted", landingHeadline: "h",
    topAdAngles: [], objections: [], launchRisks: [], ...over } as any;
}

test("produces a schema-valid BrandKit", () => {
  const kit = deriveLiteKit(concept());
  expect(() => BrandKitSchema.parse(kit)).not.toThrow();
});

test("brandName from concept, palette has real hex, voice.tone from brandVoice", () => {
  const kit = deriveLiteKit(concept());
  expect(kit.brandName).toBe("Heritage Balm");
  expect(kit.palette.length).toBeGreaterThanOrEqual(3);
  for (const sw of kit.palette) expect(sw.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  expect(kit.voice.tone).toContain("warm");
});

test("deterministic: same concept -> identical kit", () => {
  expect(JSON.stringify(deriveLiteKit(concept()))).toBe(JSON.stringify(deriveLiteKit(concept())));
});

test("missing brandVoice -> sane default tone", () => {
  const kit = deriveLiteKit(concept({ brandVoice: "" }));
  expect(kit.voice.tone.length).toBeGreaterThan(0);
});
