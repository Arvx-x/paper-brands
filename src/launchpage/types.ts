import type { BrandKit } from "../creative/types.ts";

export interface CreativeAssets {
  brandKit: BrandKit;
  logoPath?: string;
  heroPath?: string;
  packagingPath?: string;
  adPaths?: string[];
}

export interface BuildLandingPageOptions {
  outDir: string;
  experimentId?: string;
  model?: string;       // default "gemini-3-flash-preview"
  currency?: string;    // fallback price currency, default "INR"
}

export interface LandingPageResult {
  dir: string;
  indexPath: string;
  assetsCopied: string[];
  ctaInjected: "found-and-tagged" | "inserted";
  usedFallback: boolean;
  warnings: string[];
}
