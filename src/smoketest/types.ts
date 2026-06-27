export interface SmokeConcept {
  conceptId: string;
  name: string;
  syntheticScore: number;   // 0..1, arena win-rate at build time
  slug: string;             // filesystem-safe; page + CSV display
  pagePath: string;         // relative, e.g. "pages/sunshield-lip-balm.html"
}

export interface SmokeExperiment {
  category: string;
  currency: string;
  builtAt: string;          // ISO
  realMetric: "notify CTR";
  source: "smoke-test";
  unit: "concept";
  tournamentRef?: string;
  concepts: SmokeConcept[];
}

export interface SmokeResultRow {
  conceptId: string;
  pageVisitors: number;
  notifyClicks: number;
}
