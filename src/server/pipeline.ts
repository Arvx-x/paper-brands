import { runFoundry as realRunFoundry } from "../pipeline/foundry.ts";
import { runLaunchpages as realRunLaunchpages } from "../launchpages/run.ts";
import type { EmitInput } from "./events.ts";

export interface FoundryPipelineDeps {
  runFoundry?: typeof realRunFoundry;
  runLaunchpages?: typeof realRunLaunchpages;
}

export async function runFoundryPipeline(
  category: string,
  onEvent: (e: EmitInput) => void,
  deps: FoundryPipelineDeps = {},
): Promise<void> {
  const runFoundry = deps.runFoundry ?? realRunFoundry;
  const runLaunchpages = deps.runLaunchpages ?? realRunLaunchpages;

  onEvent({ type: "run-started", category });
  try {
    await runFoundry({ categoryId: category, candidates: 8, cohortSize: 80, mode: "deep", moat: true, onEvent } as any);
    const lp = await runLaunchpages({ onEvent } as any);
    const pageUrls = (lp.built ?? []).map((b: any) => ({
      name: b.name,
      url: "/" + String(b.indexPath).replace(/^\.?\//, ""),
    }));
    onEvent({ type: "run-complete", pageUrls });
  } catch (e) {
    onEvent({ type: "run-error", message: (e as Error).message });
  }
}
