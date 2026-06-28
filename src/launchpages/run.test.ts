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
