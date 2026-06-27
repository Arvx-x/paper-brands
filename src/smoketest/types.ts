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

// SmokeResultRow: shape of one row in the operator-filled results CSV.
// Used as documentation; parseResultsCsv reads raw CSV strings directly.
export interface SmokeResultRow {
  conceptId: string;
  pageVisitors: number;  // denominator: unique page visitors
  notifyClicks: number;  // numerator: notify-me button clicks
}
