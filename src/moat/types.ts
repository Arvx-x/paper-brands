export type MoatAxisName =
  | "copyability"
  | "proprietaryInsight"
  | "distributionWedge"
  | "brandTrustDurability";

export const MOAT_AXES: MoatAxisName[] = [
  "copyability",
  "proprietaryInsight",
  "distributionWedge",
  "brandTrustDurability",
];

export interface MoatAxis {
  name: MoatAxisName;
  score: number;       // 0..1
  rationale: string;
}

export interface MoatScore {
  conceptId: string;
  name: string;
  axes: MoatAxis[];
  overall: number;     // 0..1, equal-weight mean
  warnings: string[];
}

export interface MoatReport {
  scored: number;
  concepts: MoatScore[];
  degraded: boolean;
}
