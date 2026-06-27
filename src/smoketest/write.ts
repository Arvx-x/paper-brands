import { mkdir } from "node:fs/promises";
import type { BrandConcept } from "../brand/types.ts";
import type { SmokeExperiment } from "./types.ts";
import { renderPdpPage } from "./page.ts";
import { slugify } from "./experiment.ts";

function dirFor(category: string, baseDir: string): string {
  return `${baseDir}/${slugify(category)}/smoketest`;
}

export async function writeExperiment(
  experiment: SmokeExperiment,
  concepts: BrandConcept[],
  baseDir = "data",
): Promise<{ dir: string; pages: number }> {
  const dir = dirFor(experiment.category, baseDir);
  await mkdir(`${dir}/pages`, { recursive: true });

  await Bun.write(`${dir}/experiment.json`, JSON.stringify(experiment, null, 2));

  const csv =
    "conceptId,pageVisitors,notifyClicks\n" +
    experiment.concepts.map((c) => `${c.conceptId},0,0`).join("\n") + "\n";
  await Bun.write(`${dir}/results-template.csv`, csv);

  const byId = new Map(concepts.map((c) => [c.id, c]));
  let pages = 0;
  for (const sc of experiment.concepts) {
    const concept = byId.get(sc.conceptId);
    if (!concept) continue;
    const html = renderPdpPage(concept, { currency: experiment.currency, experimentId: experiment.builtAt });
    await Bun.write(`${dir}/${sc.pagePath}`, html);
    pages++;
  }
  return { dir, pages };
}

export async function readExperiment(category: string, baseDir = "data"): Promise<SmokeExperiment | null> {
  const path = `${dirFor(category, baseDir)}/experiment.json`;
  try {
    const f = Bun.file(path);
    if (!(await f.exists())) return null;
    return (await f.json()) as SmokeExperiment;
  } catch {
    return null;
  }
}
