import type { BrandConcept } from "../brand/types.ts";
import type { Persona } from "../personas/cohort.ts";
import type { CategoryPack } from "../categories/types.ts";

export interface ArenaInput {
  candidates: BrandConcept[];
  cohort: Persona[];
  pack: CategoryPack;
  opts?: { includeCompetitors?: boolean; seed?: number };
}

export interface MatchResult {
  personaId: string;
  segment: string;
  pickedConceptId: string;
  pickedLabel: string;
  willingnessToPayMinor: number;
  reason: string;
  topObjection: string;
  // optional enrichment from richer arenas:
  confidence?: number;
  abstained?: boolean;
  errored?: boolean;
  perOptionWtpMinor?: Record<string, number>;
  turnsToDecision?: number;
}

export interface BuyerArena {
  readonly kind: "single-shot" | "deep-negotiation";
  readonly costClass: "cheap" | "expensive";
  run(input: ArenaInput): Promise<MatchResult[]>;
}

export interface CalibrationPair {
  auditId: string;
  realName: string;
  arenaWinRate: number;
  tractionScore: number;
  picks: number;
  trials: number;
}

export interface CorrelationCheck {
  n: number;
  spearmanRho: number;
  verdict: "plausible" | "weak" | "none-or-negative" | "insufficient-n";
  note: string;
}
