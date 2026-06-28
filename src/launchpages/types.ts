export interface LaunchpagesOptions {
  finalistsPath?: string;
  outDir?: string;
  experimentId?: string;
  pageModel?: string;
  rounds?: number;
  bestOf?: number;
  currency?: string;
}

export interface BuiltPage {
  conceptId: string;
  name: string;
  slug: string;
  bundleDir: string;
  indexPath: string;
  syntheticScore: number;
  usedFallback: boolean;
  warnings: string[];
}

export interface LaunchpagesResult {
  outDir: string;
  built: BuiltPage[];
  skipped: string[];
  failed: { conceptId: string; reason: string }[];
  manifestPath: string;
}
