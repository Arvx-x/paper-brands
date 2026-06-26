import { existsSync } from "node:fs";
import { packs as builtin } from "./lipcare.ts";
import { CategoryPackSchema, type CategoryPack } from "./types.ts";

/**
 * Resolve a category by id. Generated packs in ./packs/<id>.json override or
 * extend the built-in packs, so any category created by the Market Intelligence
 * agents is immediately usable by the tournament/optimizer.
 */
export async function resolvePack(idOrPath: string): Promise<CategoryPack> {
  // Explicit file path.
  if (idOrPath.endsWith(".json")) {
    return loadPackFile(idOrPath);
  }
  // Generated pack on disk takes precedence.
  const diskPath = `packs/${idOrPath}.json`;
  if (existsSync(diskPath)) {
    return loadPackFile(diskPath);
  }
  // Fall back to built-in.
  const b = builtin[idOrPath];
  if (b) return b;

  throw new Error(
    `Unknown category '${idOrPath}'. Built-in: ${Object.keys(builtin).join(", ")}. ` +
      `Or generate one: bun run intel --category="..." --geo="..." --currency=...`,
  );
}

async function loadPackFile(path: string): Promise<CategoryPack> {
  const data = await Bun.file(path).json();
  return CategoryPackSchema.parse(data);
}
