import { mkdir } from "node:fs/promises";
import type { CalibrationFile, CalibrationObservation } from "./types.ts";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inUnit(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

function validate(o: CalibrationObservation): void {
  if (!inUnit(o.syntheticScore)) throw new Error(`syntheticScore must be 0..1 (got ${o.syntheticScore})`);
  if (!inUnit(o.realOutcome)) throw new Error(`realOutcome must be 0..1 (got ${o.realOutcome})`);
  if (o.equityScore !== undefined && !inUnit(o.equityScore)) throw new Error(`equityScore must be 0..1 (got ${o.equityScore})`);
  for (const [k, v] of Object.entries(o.equityComponents ?? {})) {
    if (!inUnit(v)) throw new Error(`equity component ${k} must be 0..1 (got ${v})`);
  }
}

export class CalibrationStore {
  private readonly dir: string;
  constructor(private readonly category: string, baseDir = "data") {
    this.dir = `${baseDir}/${slug(category)}`;
  }
  private get path(): string { return `${this.dir}/calibration.json`; }

  async read(): Promise<CalibrationFile> {
    const empty: CalibrationFile = { category: this.category, observations: [] };
    try {
      const f = Bun.file(this.path);
      if (!(await f.exists())) return empty;
      const data = (await f.json()) as CalibrationFile;
      if (!data || !Array.isArray(data.observations)) return empty;
      return data;
    } catch {
      console.error(`[calibration] WARN: corrupt ${this.path}; treating as empty`);
      return empty;
    }
  }

  async record(o: CalibrationObservation): Promise<void> {
    validate(o);
    const file = await this.read();
    const observations = file.observations.filter((x) => x.id !== o.id);
    observations.push(o);
    await mkdir(this.dir, { recursive: true });
    await Bun.write(this.path, JSON.stringify({ category: this.category, observations }, null, 2));
  }
}
