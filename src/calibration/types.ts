export type CalibrationSource = "smoke-test" | "analog" | "manual" | "first-party";
export type CalibrationUnit = "brand" | "concept";

export interface EquityComponents {
  search?: number;        // 0..1 brand-name search/keyword demand
  distribution?: number;  // 0..1 retail/marketplace breadth
  social?: number;        // 0..1 social following
}

export interface CalibrationObservation {
  id: string;
  category: string;
  syntheticScore: number;            // 0..1 blind arena win-rate at observation time
  realOutcome: number;               // 0..1 observed proxy (e.g. fake-door CTR)
  equityScore?: number;              // 0..1 composite equity; optional
  equityComponents?: EquityComponents;
  source: CalibrationSource;
  unit: CalibrationUnit;
  label: string;
  realMetric: string;
  recordedAt: string;                // ISO
  notes?: string;
}

export interface CalibrationFile {
  category: string;
  observations: CalibrationObservation[];
}

export interface CalibrationResult {
  status: "uncalibrated" | "weak" | "calibrated";
  raw: number;
  calibrated: number;
  lo: number;
  hi: number;
  residualRmse: number | null;
  n: number;
  r2: number | null;
  method: "passthrough" | "linear" | "bivariate";
  realMetric: string | null;
  appealContribution: number;
  equityContribution: number;
  equityStatus: "not-learned" | "learned";
  warnings: string[];
}
