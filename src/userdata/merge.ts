// src/userdata/merge.ts
import type { UserVoice, UserSku, UserCompetitor, UserOverrides, UserIntel } from "./types.ts";
import type { EvidenceSource } from "../intel/market.ts";
import type { PriceObservation } from "../scrape/prices.ts";
import type { CategoryPack } from "../categories/types.ts";

/**
 * Each user voice becomes a synthetic, user-provided source whose rawText IS the
 * quote. The intel containment gate then passes correctly because the user is the
 * source. Internal notes are marked non-independent so they cannot masquerade as
 * independent market voice.
 */
export function voicesToSources(voices: UserVoice[]): EvidenceSource[] {
  return voices.map((v, i) => ({
    finalUrl: `user://${encodeURIComponent(v.source)}#${i}`,
    sourceClass: "first-party",
    independent: v.independent,
    rawText: v.quote,
  }));
}
