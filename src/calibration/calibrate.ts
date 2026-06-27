import type { EquityComponents } from "./types.ts";
import { CalibrationStore } from "./store.ts";
import { fitCalibration } from "./model.ts";
import type { CalibrationResult } from "./types.ts";

/** Equal-weight mean of PRESENT equity components (missing omitted, not zero-filled). */
export function composeEquity(components?: EquityComponents): number | undefined {
  if (!components) return undefined;
  const vals = [components.search, components.distribution, components.social]
    .filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return undefined;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export async function calibrate(
  category: string,
  rawWinRate: number,
  equityScore?: number,
  baseDir = "data",
): Promise<CalibrationResult> {
  const file = await new CalibrationStore(category, baseDir).read();
  return fitCalibration(file.observations).apply(rawWinRate, equityScore);
}
