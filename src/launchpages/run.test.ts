import { test, expect } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLaunchpages } from "./run.ts";

function finalist(id: string, name: string, winRate: number) {
  return { rank: 1, winRate, winRateCiLow: 0, winRateCiHigh: 1, avgWtpMinor: 1000,
    concept: { id, name, positioning: "p", targetCustomer: "t", coreInsight: "c", productPromise: "pp",
      heroSku: "sku", priceMinor: 49900, priceBand: "premium", tagline: "t", claims: [], packagingDirection: "x",
      brandVoice: "x", landingHeadline: "h", topAdAngles: [], objections: [], launchRisks: [] } };
}

function fakeDeps(overrides: any = {}) {
  const calls: any = { identity: [], optimize: [], build: [] };
  return {
    calls,
    deps: {
      readFinalists: async () => ({ categoryId: "lipcare-india", finalists: [
        finalist("A", "Alpha", 0.3), finalist("B", "Beta", 0.2), finalist("C", "Gamma", 0.1),
      ] }),
      buildBrandKit: async (c: any) => ({
        brandId: c.id, brandName: c.name, essence: "test essence",
        palette: [{ name: "Ink", hex: "#171411", role: "primary" }],
        typography: { headingMood: "bold", bodyMood: "clean", pairing: "x" },
        artDirection: "a", casting: "", moodKeywords: ["bold"], logoDirection: "l",
        packagingDirection: "p", voice: { tone: "warm", doSay: [], dontSay: [] },
        visualDos: [], visualDonts: [], negativePrompt: "", competitiveNotes: [],
      }),
      buildNarrative: async () => ({
        brandId: "test", vision: "v", mission: "m", originStory: "o",
        values: [], manifesto: "man", customerStory: "c", tagline: "t",
      }),
      generateMotif: async () => null,
      generateIdentity: async (kit: any, o: any) => { calls.identity.push({ kit, o }); return { logo: { imagePath: o.outDir + "/logo.png" }, packaging: { imagePath: o.outDir + "/pack.png" }, refImages: [] }; },
      optimizeCreative: async (o: any) => { calls.optimize.push(o); return { champion: { imagePath: o.outDir + "/product.png" } }; },
      buildLandingPage: async (concept: any, assets: any, _llm: any, o: any) => { calls.build.push({ concept, assets, o }); await writeFile(join(o.outDir, "index.html"), "<html></html>"); return { dir: o.outDir, indexPath: join(o.outDir, "index.html"), assetsCopied: [], ctaInjected: "inserted", usedFallback: false, warnings: [] }; },
      ...overrides,
    },
  };
}

test("builds all finalists, writes manifest with conceptId/syntheticScore/pagePath", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  const { deps, calls } = fakeDeps();
  const res = await runLaunchpages({ outDir: out }, deps as any);
  expect(res.built.map((b) => b.conceptId)).toEqual(["A", "B", "C"]);
  expect(calls.identity).toHaveLength(3);
  expect(calls.optimize).toHaveLength(3);
  const manifest = await Bun.file(res.manifestPath).json();
  expect(manifest.source).toBe("smoke-test");
  expect(manifest.concepts.find((c: any) => c.conceptId === "A").syntheticScore).toBe(0.3);
  expect(manifest.concepts[0].pagePath).toContain("index.html");
  await rm(out, { recursive: true, force: true });
});

test("resume: a finalist whose index.html exists is skipped", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  await mkdir(join(out, "a"), { recursive: true });
  await writeFile(join(out, "a", "index.html"), "<html></html>");
  const { deps } = fakeDeps();
  const res = await runLaunchpages({ outDir: out }, deps as any);
  expect(res.skipped).toContain("A");
  expect(res.built.map((b) => b.conceptId)).toEqual(["B", "C"]);
  await rm(out, { recursive: true, force: true });
});

test("fail-isolation: one finalist's identity throws -> failed, others built", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  const { deps } = fakeDeps({
    generateIdentity: async (kit: any, o: any) => {
      if (o.outDir.endsWith("/b")) throw new Error("render timeout");
      return { logo: { imagePath: o.outDir + "/logo.png" }, packaging: { imagePath: o.outDir + "/pack.png" }, refImages: [] };
    },
  });
  const res = await runLaunchpages({ outDir: out }, deps as any);
  expect(res.failed.map((f) => f.conceptId)).toEqual(["B"]);
  expect(res.built.map((b) => b.conceptId)).toEqual(["A", "C"]);
  await rm(out, { recursive: true, force: true });
});

test("manifest only includes built finalists", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  const { deps } = fakeDeps({
    buildLandingPage: async (_c: any, _a: any, _l: any, o: any) => {
      if (o.outDir.endsWith("/c")) throw new Error("build fail");
      await writeFile(join(o.outDir, "index.html"), "<html></html>");
      return { dir: o.outDir, indexPath: join(o.outDir, "index.html"), assetsCopied: [], ctaInjected: "inserted", usedFallback: false, warnings: [] };
    },
  });
  const res = await runLaunchpages({ outDir: out }, deps as any);
  const manifest = await Bun.file(res.manifestPath).json();
  expect(manifest.concepts.map((c: any) => c.conceptId).sort()).toEqual(["A", "B"]);
  await rm(out, { recursive: true, force: true });
});

test("missing finalists -> throws", async () => {
  const out = await mkdtemp(join(tmpdir(), "lpgs-"));
  const { deps } = fakeDeps({ readFinalists: async () => ({ categoryId: "x", finalists: [] }) });
  await expect(runLaunchpages({ outDir: out }, deps as any)).rejects.toThrow();
  await rm(out, { recursive: true, force: true });
});

test("card builder uses real buildBrandKit, builds narrative+motif, emits card-identity", async () => {
  const events: any[] = [];
  let kitCalled = false, narrCalled = false, motifCalled = false;
  const dir = `/tmp/pb-cards-${Date.now()}`;
  await runLaunchpages(
    { outDir: dir, onEvent: (e) => events.push(e) },
    {
      readFinalists: async () => ({ categoryId: "lipcare", finalists: [finalist("verdant", "Verdant", 0.4)] }),
      buildBrandKit: async (c: any) => { kitCalled = true; return {
        brandId: c.id, brandName: c.name, essence: "clinical botanical",
        palette: [{ name: "Pine", hex: "#1f3d2b", role: "primary" }],
        typography: { headingMood: "bold", bodyMood: "clean", pairing: "x" },
        artDirection: "a", casting: "", moodKeywords: ["rugged"], logoDirection: "l",
        packagingDirection: "p", voice: { tone: "calm", doSay: [], dontSay: [] },
        visualDos: [], visualDonts: [], negativePrompt: "", competitiveNotes: [] }; },
      buildNarrative: async () => { narrCalled = true; return {
        brandId: "verdant", vision: "no cracked lips", mission: "m", originStory: "born on a trek",
        values: [], manifesto: "go further", customerStory: "c", tagline: "t" }; },
      generateMotif: async () => { motifCalled = true; return { imagePath: `${dir}/verdant/motif.png` }; },
      generateIdentity: async (_kit: any, o: any) => ({ logo: { imagePath: o.outDir + "/logo.png" },
        packaging: { imagePath: o.outDir + "/pack.png" }, refImages: [] }) as any,
      optimizeCreative: async (o: any) => ({ champion: { imagePath: o.outDir + "/product.png" } }) as any,
      buildLandingPage: async (_c: any, _a: any, _l: any, o: any) => {
        await Bun.write(o.outDir + "/index.html", "<html></html>");
        return { indexPath: o.outDir + "/index.html", usedFallback: false, warnings: [] } as any;
      },
    } as any,
  );
  expect(kitCalled).toBe(true);
  expect(narrCalled).toBe(true);
  expect(motifCalled).toBe(true);
  const ci = events.find((e) => e.type === "card-identity");
  expect(ci?.vision).toBe("no cracked lips");
  expect(ci?.palette[0].hex).toBe("#1f3d2b");
  expect(await Bun.file(`${dir}/verdant/brandkit.json`).exists()).toBe(true);
  expect(await Bun.file(`${dir}/verdant/narrative.json`).exists()).toBe(true);
});

test("card builder falls back to deriveLiteKit when buildBrandKit throws", async () => {
  const events: any[] = [];
  const dir = `/tmp/pb-cards-fb-${Date.now()}`;
  await runLaunchpages(
    { outDir: dir, onEvent: (e) => events.push(e) },
    {
      readFinalists: async () => ({ categoryId: "lipcare", finalists: [finalist("verdant", "Verdant", 0.4)] }),
      buildBrandKit: async () => { throw new Error("kit llm down"); },
      buildNarrative: async () => ({ brandId: "verdant", vision: "", mission: "", originStory: "",
        values: [], manifesto: "", customerStory: "", tagline: "t" }),
      generateMotif: async () => null,
      generateIdentity: async (_kit: any, o: any) => ({ logo: { imagePath: o.outDir + "/logo.png" },
        packaging: { imagePath: o.outDir + "/pack.png" }, refImages: [] }) as any,
      optimizeCreative: async (o: any) => ({ champion: { imagePath: o.outDir + "/product.png" } }) as any,
      buildLandingPage: async (_c: any, _a: any, _l: any, o: any) => {
        await Bun.write(o.outDir + "/index.html", "<html></html>");
        return { indexPath: o.outDir + "/index.html", usedFallback: false, warnings: [] } as any;
      },
    } as any,
  );
  // Still produced a card-identity from the lite kit fallback and did not crash.
  expect(events.some((e) => e.type === "card-identity")).toBe(true);
});
