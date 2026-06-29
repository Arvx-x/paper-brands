// src/creative/motif.test.ts
import { test, expect } from "bun:test";
import { generateMotif } from "./motif.ts";

const kit: any = {
  brandName: "Verdant", essence: "clinical botanical",
  moodKeywords: ["rugged", "clinical"], palette: [{ name: "Pine", hex: "#1f3d2b", role: "primary" }],
};

test("generateMotif returns the written path on success", async () => {
  const ic: any = { generate: async () => ({ base64: "AAAA", mime: "image/png" }) };
  const dir = `/tmp/pb-motif-${Date.now()}`;
  const r = await generateMotif(kit, { outDir: dir, imageClient: ic });
  expect(r?.imagePath).toBe(`${dir}/motif.png`);
  expect(await Bun.file(r!.imagePath).exists()).toBe(true);
});

test("generateMotif returns null on generation failure (no throw)", async () => {
  const ic: any = { generate: async () => { throw new Error("img fail"); } };
  const r = await generateMotif(kit, { outDir: `/tmp/pb-motif-${Date.now()}`, imageClient: ic });
  expect(r).toBeNull();
});
