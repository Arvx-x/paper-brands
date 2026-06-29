// src/brand/narrative.test.ts
import { test, expect } from "bun:test";
import { BrandNarrativeSchema } from "./narrative.ts";

test("BrandNarrativeSchema parses a full narrative", () => {
  const n = BrandNarrativeSchema.parse({
    brandId: "verdant", vision: "v", mission: "m", originStory: "o",
    values: [{ name: "Honest", description: "d" }], manifesto: "man",
    customerStory: "c", tagline: "t",
  });
  expect(n.values[0]!.name).toBe("Honest");
});

test("BrandNarrativeSchema defaults missing arrays/strings", () => {
  const n = BrandNarrativeSchema.parse({ brandId: "x" });
  expect(n.values).toEqual([]);
  expect(n.vision).toBe("");
});

import { buildNarrative, saveNarrative, loadNarrative } from "./narrative.ts";

const concept: any = {
  id: "verdant", name: "Verdant", positioning: "clinical botanical repair",
  coreInsight: "balms fail at altitude", targetCustomer: "trekkers",
  productPromise: "barrier repair", heroSku: "Balm", priceMinor: 34900, priceBand: "premium",
  tagline: "Repair that lasts the climb", claims: ["SPF 30"], packagingDirection: "tube",
  brandVoice: "calm expert", landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [],
};
const kit: any = { essence: "clinical botanical", voice: { tone: "calm expert", doSay: [], dontSay: [] } };

test("buildNarrative returns schema-valid narrative from LLM JSON", async () => {
  const llm: any = { completeJson: async () => ({
    vision: "a world where outdoor skin never cracks", mission: "repair lips at altitude",
    originStory: "born on a Himalayan trek", values: [{ name: "Rigor", description: "clinical proof" }],
    manifesto: "go further", customerStory: "she summits at dawn", tagline: "Repair that lasts the climb",
  }) };
  const n = await buildNarrative(concept, kit, llm);
  expect(n.brandId).toBe("verdant");
  expect(n.vision).toContain("outdoor skin");
  expect(n.values[0]!.name).toBe("Rigor");
});

test("buildNarrative falls back to concept fields when LLM omits them", async () => {
  const llm: any = { completeJson: async () => ({}) };
  const n = await buildNarrative(concept, kit, llm);
  expect(n.vision).toBe(concept.positioning);
  expect(n.originStory).toBe(concept.coreInsight);
  expect(n.values).toEqual([]);
});

test("buildNarrative does not throw when LLM rejects (uses fallbacks)", async () => {
  const llm: any = { completeJson: async () => { throw new Error("llm down"); } };
  const n = await buildNarrative(concept, kit, llm);
  expect(n.brandId).toBe("verdant");
  expect(n.tagline).toBe(concept.tagline);
});

test("saveNarrative/loadNarrative round-trip", async () => {
  const dir = `/tmp/pb-narr-${Date.now()}`;
  const n = await buildNarrative(concept, kit, { completeJson: async () => ({}) } as any);
  await saveNarrative(n, dir);
  const back = await loadNarrative(dir);
  expect(back?.brandId).toBe("verdant");
});
