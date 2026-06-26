import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { CategoryPackSchema, type CategoryPack } from "./types.ts";

/**
 * Resolve a category by id, path, or generated pack. The platform is a
 * category-blind engine: there are NO built-in verticals compiled in. Every
 * pack — including the lipcare pilot — is data on disk under packs/<id>.json,
 * created by the Market Intelligence agents (or hand-seeded). This keeps the
 * module graph free of any single category's assumptions.
 */
const PACK_DIR = "packs";

export async function resolvePack(idOrPath: string): Promise<CategoryPack> {
  // Explicit file path.
  if (idOrPath.endsWith(".json")) return loadPackFile(idOrPath);
  // Pack on disk by id.
  const diskPath = `${PACK_DIR}/${idOrPath}.json`;
  if (existsSync(diskPath)) return loadPackFile(diskPath);

  const available = await listPacks();
  throw new Error(
    `Unknown category '${idOrPath}'. Available packs: ${available.join(", ") || "(none)"}. ` +
      `Generate one: bun run intel --category="..." --geo="..." --currency=...`,
  );
}

/** Slugs of every pack available on disk (for help/error messages). */
export async function listPacks(): Promise<string[]> {
  try {
    return (await readdir(PACK_DIR))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

async function loadPackFile(path: string): Promise<CategoryPack> {
  const data = await Bun.file(path).json();
  return CategoryPackSchema.parse(data);
}
