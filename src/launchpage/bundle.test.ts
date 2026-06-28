import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleAssets } from "./bundle.ts";

async function srcImg(dir: string, name: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, "PNGDATA");
  return p;
}

test("copies present assets to assets/ and writes index.html", async () => {
  const src = await mkdtemp(join(tmpdir(), "lp-src-"));
  const out = await mkdtemp(join(tmpdir(), "lp-out-"));
  const logo = await srcImg(src, "logo.png");
  const hero = await srcImg(src, "hero.png");
  const html = `<html><body><img src="assets/logo.png"><img src="assets/hero.png"></body></html>`;
  const res = await bundleAssets(html, { brandKit: {} as any, logoPath: logo, heroPath: hero }, out);

  expect(res.assetsCopied.sort()).toEqual(["assets/hero.png", "assets/logo.png"]);
  expect(await Bun.file(join(out, "index.html")).exists()).toBe(true);
  expect(await Bun.file(join(out, "assets", "logo.png")).exists()).toBe(true);
  expect(await Bun.file(join(out, "assets", "hero.png")).exists()).toBe(true);
  expect(res.warnings).toHaveLength(0);
  await rm(src, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});

test("html references an asset that was not provided -> warning, no crash", async () => {
  const out = await mkdtemp(join(tmpdir(), "lp-out-"));
  const html = `<html><body><img src="assets/hero.png"></body></html>`;
  const res = await bundleAssets(html, { brandKit: {} as any }, out);
  expect(res.warnings.some((w) => w.includes("hero"))).toBe(true);
  expect(await Bun.file(join(out, "index.html")).exists()).toBe(true);
  await rm(out, { recursive: true, force: true });
});

test("adPaths copied as ad-1.png, ad-2.png", async () => {
  const src = await mkdtemp(join(tmpdir(), "lp-src-"));
  const out = await mkdtemp(join(tmpdir(), "lp-out-"));
  const a1 = await srcImg(src, "a1.png");
  const a2 = await srcImg(src, "a2.png");
  const html = `<html><body><img src="assets/ad-1.png"><img src="assets/ad-2.png"></body></html>`;
  const res = await bundleAssets(html, { brandKit: {} as any, adPaths: [a1, a2] }, out);
  expect(res.assetsCopied.sort()).toEqual(["assets/ad-1.png", "assets/ad-2.png"]);
  await rm(src, { recursive: true, force: true });
  await rm(out, { recursive: true, force: true });
});
