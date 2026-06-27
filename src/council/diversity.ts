import { makeRng } from "../arena/stats.ts";
import type { LLMClient } from "../llm/client.ts";

export interface WedgeFingerprint {
  wedge: string;
  segment: string;
  tier: string;
}

export interface WedgeTag {
  territoryIndex: number;
  territoryName: string;
  fingerprint: WedgeFingerprint;
}

export interface DiversitySelection {
  selectedIndices: number[];
  distinctWedgeCount: number;
  spannedWedges: string[];
  rerolled: boolean;
  warning?: "lowConceptDiversity";
}

export interface DiversityReport {
  requested: number;
  distinctWedgeCount: number;
  spannedWedges: string[];
  poolSize: number;
  rerolled: boolean;
  warning?: "lowConceptDiversity";
}

const fpKey = (f: WedgeFingerprint) => `${f.wedge}|${f.segment}|${f.tier}`;

export interface TerritoryLike {
  name: string;
  thesis: string;
  primarySegment: string;
}

const normSlug = (s: unknown): string =>
  String(s ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function sentinel(index: number): WedgeFingerprint {
  return { wedge: `untagged-${index}`, segment: "unknown", tier: "unknown" };
}

/**
 * Classify each territory onto a (wedge, segment, tier) fingerprint via ONE batched LLM call.
 * Fail-clean: any territory the model fails to tag gets a sentinel-distinct fingerprint, so a
 * tagging failure degrades to "treat as distinct" and never fabricates duplicates.
 */
export async function tagWedges(
  territories: TerritoryLike[],
  packBandLabels: string[],
  llm: LLMClient,
): Promise<WedgeTag[]> {
  const bands = packBandLabels.map((b) => normSlug(b)).filter(Boolean);
  const bandSet = new Set(bands);

  let raw: { tags?: Array<{ territoryIndex: number; wedge?: string; segment?: string; tier?: string }> } = {};
  try {
    raw = await llm.completeJson({
      messages: [
        {
          role: "user",
          content:
            `Classify each brand territory onto a positioning "wedge fingerprint" with three axes.\n` +
            `Territories (index: name — thesis — primary segment):\n` +
            territories.map((t, i) => `${i}: ${t.name} — ${t.thesis} — ${t.primarySegment}`).join("\n") +
            `\n\nAxes:\n` +
            `- wedge: the core positioning angle (e.g. "clean", "longevity", "gifting", "price-disruption").\n` +
            `- segment: the primary buyer segment (e.g. "sensitive-skin", "gen-z-value").\n` +
            `- tier: MUST be exactly one of: ${bands.join(", ") || "value, premium"}.\n\n` +
            `Rules: each axis value is a short lowercase hyphenated slug (<=3 words). ` +
            `REUSE the SAME slug when two territories share an angle (do not invent synonyms).\n` +
            `Return ONLY JSON: { "tags": [ { "territoryIndex": <int>, "wedge", "segment", "tier" } ] }`,
        },
      ],
      temperature: 0,
    });
  } catch {
    raw = {};
  }

  const byIndex = new Map<number, { wedge?: string; segment?: string; tier?: string }>();
  for (const t of raw?.tags ?? []) {
    if (typeof t?.territoryIndex === "number") byIndex.set(t.territoryIndex, t);
  }

  return territories.map((terr, i) => {
    const hit = byIndex.get(i);
    if (!hit || !hit.wedge || !hit.segment) {
      return { territoryIndex: i, territoryName: terr.name, fingerprint: sentinel(i) };
    }
    const tier = normSlug(hit.tier);
    return {
      territoryIndex: i,
      territoryName: terr.name,
      fingerprint: {
        wedge: normSlug(hit.wedge),
        segment: normSlug(hit.segment),
        tier: bandSet.has(tier) ? tier : "unknown",
      },
    };
  });
}

/** Pure, deterministic greedy max-diversity selection over (wedge, segment, tier). */
export function selectDiverse(tags: WedgeTag[], n: number, seed: number): DiversitySelection {
  // 1. Deterministic order: shuffle by seed, then the greedy loop breaks ties by this order.
  const rng = makeRng(String(seed));
  const ordered = tags
    .map((t, i) => ({ t, i, k: rng() }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.t);

  const chosen: WedgeTag[] = [];
  const usedFp = new Set<string>();
  const usedWedge = new Set<string>();
  const usedSegment = new Set<string>();
  const usedTier = new Set<string>();
  const remaining = [...ordered];

  while (chosen.length < n && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const f = remaining[i]!.fingerprint;
      let score = 0;
      if (!usedFp.has(fpKey(f))) score += 1000;
      if (!usedWedge.has(f.wedge)) score += 100;
      if (!usedSegment.has(f.segment)) score += 10;
      if (!usedTier.has(f.tier)) score += 1;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    const pick = remaining.splice(bestIdx, 1)[0]!;
    chosen.push(pick);
    usedFp.add(fpKey(pick.fingerprint));
    usedWedge.add(pick.fingerprint.wedge);
    usedSegment.add(pick.fingerprint.segment);
    usedTier.add(pick.fingerprint.tier);
  }

  const distinctWedgeCount = new Set(chosen.map((c) => fpKey(c.fingerprint))).size;
  const spannedWedges = [...new Set(chosen.map((c) => c.fingerprint.wedge))].sort();
  return {
    selectedIndices: chosen.map((c) => c.territoryIndex),
    distinctWedgeCount,
    spannedWedges,
    rerolled: false,
  };
}
