import type { BlindCard } from "../brand/types.ts";
import type { EngineTraits } from "./traits.ts";
import { computeWtp, decide, type Grades } from "./engine.ts";
import { renderCardForDeep } from "./card.ts";
import { makeRng } from "./stats.ts";
import { gradeCard } from "./grader.ts";

export interface NegotiationOutcome {
  conviction: number;
  finalWtp: number;
  affordable: boolean;
  bought: boolean;
  turns: number;
  errored: boolean;
  lastObjection: string;
}

type GraderFn = (
  card: string,
  traits: EngineTraits,
  turn: number,
) => Promise<Grades & { spokenObjection: string }>;

const MAX_TURNS = 4;

/** One persona deliberating over one FIXED card across up to 4 turns. */
export async function negotiate(
  traits: EngineTraits,
  card: BlindCard,
  currency: string,
  seed: string,
  grader: GraderFn = gradeCard,
): Promise<NegotiationOutcome> {
  const rng = makeRng(`${seed}::${card.label}`);
  const rendered = renderCardForDeep(card, currency);
  let cumulativePressure = 0;
  let wtp = traits.basePMax;
  let conviction = 0;
  let lastObjection = "";

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let grades: Grades & { spokenObjection: string };
    try {
      grades = await grader(rendered, traits, turn);
    } catch {
      return { conviction: 0, finalWtp: wtp, affordable: card.priceMinor <= wtp, bought: false, turns: turn, errored: true, lastObjection };
    }
    lastObjection = grades.spokenObjection || lastObjection;

    const turnPressure = Math.max(0, Math.min(10, grades.pressureScore)) / 10;
    cumulativePressure = Math.max(0, Math.min(1.5, cumulativePressure * 0.6 + turnPressure));

    wtp = computeWtp(traits, grades, cumulativePressure).wtp;
    const d = decide(traits, grades, wtp, card.priceMinor, turn, cumulativePressure, rng);
    conviction = d.conviction;

    if (d.decision === "BUY") return { conviction, finalWtp: wtp, affordable: true, bought: true, turns: turn, errored: false, lastObjection };
    if (d.decision === "REJECT") return { conviction, finalWtp: wtp, affordable: card.priceMinor <= wtp, bought: false, turns: turn, errored: false, lastObjection };
  }
  return { conviction, finalWtp: wtp, affordable: card.priceMinor <= wtp, bought: false, turns: MAX_TURNS, errored: false, lastObjection };
}
