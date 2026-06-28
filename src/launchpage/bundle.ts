import { mkdir, copyFile } from "node:fs/promises";
import type { CreativeAssets } from "./types.ts";

interface AssetMap { rel: string; src: string }

function plannedAssets(assets: CreativeAssets): AssetMap[] {
  const list: AssetMap[] = [];
  if (assets.logoPath) list.push({ rel: "assets/logo.png", src: assets.logoPath });
  if (assets.heroPath) list.push({ rel: "assets/hero.png", src: assets.heroPath });
  if (assets.packagingPath) list.push({ rel: "assets/packaging.png", src: assets.packagingPath });
  (assets.adPaths ?? []).forEach((src, i) => list.push({ rel: `assets/ad-${i + 1}.png`, src }));
  return list;
}

export async function bundleAssets(
  html: string,
  assets: CreativeAssets,
  outDir: string,
): Promise<{ assetsCopied: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  await mkdir(`${outDir}/assets`, { recursive: true });

  const planned = plannedAssets(assets);
  const assetsCopied: string[] = [];
  for (const a of planned) {
    try {
      await copyFile(a.src, `${outDir}/${a.rel}`);
      assetsCopied.push(a.rel);
    } catch {
      warnings.push(`asset copy failed for ${a.rel} (source ${a.src})`);
    }
  }

  const referenced = [...html.matchAll(/<img[^>]+src="(assets\/[^"]+)"/gi)].map((m) => m[1]!);
  for (const ref of referenced) {
    if (!assetsCopied.includes(ref)) warnings.push(`html references missing asset '${ref}'`);
  }

  await Bun.write(`${outDir}/index.html`, html);
  return { assetsCopied, warnings };
}
