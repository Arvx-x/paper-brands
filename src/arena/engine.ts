import type { EngineTraits } from "./traits.ts";

export interface Grades {
  traumaResolutionScore: number; // 0..10
  valueScore: number;            // 0..10
  pressureScore: number;         // 0..10
  impulseTriggers: { scarcity: boolean; socialProof: boolean; novelty: boolean; emotionalAppeal: boolean };
  desiredAction: "WANT_TO_BUY" | "STILL_OBJECTING" | "WALKING_AWAY";
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const g01 = (v: number) => clamp(Number(v) || 0, 0, 10) / 10;

export function computeWtp(
  t: EngineTraits,
  grades: Grades,
  cumulativePressure: number,
): { wtp: number; breakdown: { trustGain: number; valueGain: number; impulseGain: number; pressurePenalty: number } } {
  const base = t.basePMax;
  const trauma = g01(grades.traumaResolutionScore);
  const value = g01(grades.valueScore);
  const tr = grades.impulseTriggers;
  const triggerCount = (tr.scarcity ? 1 : 0) + (tr.socialProof ? 1 : 0) + (tr.novelty ? 1 : 0) + (tr.emotionalAppeal ? 1 : 0);

  const trustGain = base * trauma * 0.5;
  const valueGain = base * value * 0.45;
  const impulseGain = base * (triggerCount * 0.12) * t.impulsivity;
  const pressurePenalty = base * cumulativePressure * (0.25 + 0.5 * t.skepticism);

  const raw = base + trustGain + valueGain + impulseGain - pressurePenalty;
  const wtp = Math.max(Math.round(raw), Math.round(base * 0.7));
  return {
    wtp,
    breakdown: {
      trustGain: Math.round(trustGain), valueGain: Math.round(valueGain),
      impulseGain: Math.round(impulseGain), pressurePenalty: Math.round(pressurePenalty),
    },
  };
}

export interface Decision { decision: "BUY" | "PUSH_BACK" | "REJECT"; conviction: number }

export function decide(
  t: EngineTraits,
  grades: Grades,
  wtp: number,
  price: number,
  turn: number,
  cumulativePressure: number,
  rng: () => number,
): Decision {
  if (price > wtp) return { decision: "PUSH_BACK", conviction: 0 };

  const value = g01(grades.valueScore);
  const trauma = g01(grades.traumaResolutionScore);
  const headroom = clamp((wtp - price) / Math.max(wtp, 1), 0, 1);
  let conviction =
    0.55 * value + 0.30 * trauma + 0.15 * headroom -
    0.35 * t.skepticism * (1 - trauma) - 0.40 * cumulativePressure;
  conviction = clamp(conviction, 0, 1);

  const wantsOut = grades.desiredAction === "WALKING_AWAY";

  if (turn >= 4) {
    return rng() < conviction ? { decision: "BUY", conviction } : { decision: "REJECT", conviction };
  }
  if (wantsOut && conviction < 0.25) return { decision: "REJECT", conviction };
  const buyProb = clamp(conviction - 0.15, 0, 1);
  if (rng() < buyProb) return { decision: "BUY", conviction };
  return { decision: "PUSH_BACK", conviction };
}
