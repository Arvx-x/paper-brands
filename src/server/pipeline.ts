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
  cohortSize = 80,
): Promise<void> {
  const runFoundry = deps.runFoundry ?? realRunFoundry;
  const runLaunchpages = deps.runLaunchpages ?? realRunLaunchpages;

  onEvent({ type: "run-started", category });
  try {
    await runFoundry({ categoryId: category, candidates: 8, cohortSize, onEvent });
    const lp = await runLaunchpages({ onEvent });
    const pageUrls = (lp.built ?? []).map((b: any) => ({
      name: b.name,
      url: "/" + String(b.indexPath).replace(/^\.?\//, ""),
    }));
    onEvent({ type: "run-complete", pageUrls });
  } catch (e) {
    onEvent({ type: "run-error", message: (e as Error).message });
  }
}
