import type { CalibrationObservation } from "../calibration/types.ts";
import type { SmokeExperiment } from "./types.ts";

export interface SkippedRow {
  conceptId: string;
  reason: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const REQUIRED_HEADER = ["conceptId", "pageVisitors", "notifyClicks"];

export function parseResultsCsv(
  experiment: SmokeExperiment,
  csvText: string,
  recordedAt: string,
): { observations: CalibrationObservation[]; skipped: SkippedRow[] } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("smoketest: empty results CSV");
  const header = lines[0]!.split(",").map((h) => h.trim());
  if (REQUIRED_HEADER.some((h, i) => header[i] !== h)) {
    throw new Error(`smoketest: bad CSV header; expected "${REQUIRED_HEADER.join(",")}"`);
  }

  const byId = new Map(experiment.concepts.map((c) => [c.conceptId, c]));
  const observations: CalibrationObservation[] = [];
  const skipped: SkippedRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const conceptId = cells[0] ?? "";
    const visitors = Number(cells[1]);
    const clicks = Number(cells[2]);
    const concept = byId.get(conceptId);

    if (!concept) { skipped.push({ conceptId, reason: "unknown conceptId (not in experiment)" }); continue; }
    if (!Number.isFinite(visitors) || !Number.isFinite(clicks)) { skipped.push({ conceptId, reason: "non-numeric visitors/clicks" }); continue; }
    if (visitors <= 0) { skipped.push({ conceptId, reason: "pagevisitors must be > 0 (visitors=0 not allowed)" }); continue; }
    if (clicks < 0) { skipped.push({ conceptId, reason: "negative clicks value" }); continue; }
    if (clicks > visitors) { skipped.push({ conceptId, reason: "clicks exceed visitors (CTR > 1 not possible)" }); continue; }

    observations.push({
      id: `smoke-${experiment.category}-${conceptId}-${experiment.builtAt}`,
      category: experiment.category,
      syntheticScore: concept.syntheticScore,
      realOutcome: clamp01(clicks / visitors),
      source: "smoke-test",
      unit: "concept",
      label: `${concept.name} smoke`,
      realMetric: "notify CTR",
      recordedAt,
      notes: `visitors=${visitors}, clicks=${clicks}`,
    });
  }

  return { observations, skipped };
}
