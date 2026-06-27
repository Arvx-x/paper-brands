import type { LLMClient } from "../llm/client.ts";
import type { BrandConcept } from "../brand/types.ts";
import type { CategoryPack } from "../categories/types.ts";
import type { MoatAxis, MoatAxisName, MoatScore } from "./types.ts";
import { MOAT_AXES } from "./types.ts";
import { rollUp } from "./rollup.ts";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function neutralAxis(name: MoatAxisName, note: string): MoatAxis {
  return { name, score: 0.5, rationale: note };
}

function assemble(
  conceptId: string,
  name: string,
  rawAxes: Array<{ name?: string; score?: unknown; rationale?: unknown }> | undefined,
): MoatScore {
  const warnings: string[] = [];
  const byName = new Map<string, { score?: unknown; rationale?: unknown }>();
  for (const a of rawAxes ?? []) {
    if (typeof a?.name === "string") byName.set(a.name, a);
  }
  const axes: MoatAxis[] = MOAT_AXES.map((axisName) => {
    const hit = byName.get(axisName);
    if (!hit) {
      warnings.push(`axis ${axisName} missing from LLM output (defaulted neutral)`);
      return neutralAxis(axisName, "(not scored)");
    }
    const n = typeof hit.score === "number" ? hit.score : Number.NaN;
    if (!Number.isFinite(n)) {
      warnings.push(`axis ${axisName} non-numeric (defaulted neutral)`);
      return neutralAxis(axisName, typeof hit.rationale === "string" ? hit.rationale : "(not scored)");
    }
    return {
      name: axisName,
      score: clamp01(n),
      rationale: typeof hit.rationale === "string" && hit.rationale.trim() ? hit.rationale : "(no rationale)",
    };
  });
  return { conceptId, name, axes, overall: rollUp(axes), warnings };
}

/** Score each generated concept on the 4 moat axes via ONE batched LLM call. Fail-clean. */
export async function scoreMoat(
  concepts: BrandConcept[],
  pack: CategoryPack,
  llm: LLMClient,
): Promise<MoatScore[]> {
  const competitors = (pack.competitorArchetypes ?? []).map((a) => ({
    codeName: a.codeName, description: a.description, strengths: a.strengths, weaknesses: a.weaknesses,
  }));

  let raw: { scores?: Array<{ conceptId?: string; axes?: any[] }> } = {};
  try {
    raw = await llm.completeJson({
      messages: [
        {
          role: "user",
          content:
            `Rate each brand concept's DEFENSIBILITY (moat) on four axes, each 0..1 where HIGHER = MORE defensible.\n` +
            `Axes:\n` +
            `- copyability: RESISTANCE to being copied (1 = very hard for an incumbent to replicate, 0 = trivial commodity).\n` +
            `- proprietaryInsight: how non-obvious/unique the core insight is (1 = unique, 0 = generic).\n` +
            `- distributionWedge: channel or positioning edge vs competitors (1 = strong wedge, 0 = none).\n` +
            `- brandTrustDurability: ability to build defensible affinity/trust (1 = durable, 0 = forgettable).\n\n` +
            `Each axis needs a ONE-SENTENCE rationale grounded in the concept and the competitors below.\n\n` +
            `Competitors (disguised):\n${JSON.stringify(competitors, null, 2)}\n\n` +
            `Concepts:\n` +
            concepts.map((c) => JSON.stringify({ id: c.id, name: c.name, positioning: c.positioning, coreInsight: c.coreInsight, productPromise: c.productPromise, claims: c.claims, priceBand: c.priceBand, targetCustomer: c.targetCustomer })).join("\n") +
            `\n\nIMPORTANT: Most generic D2C concepts are EASY to copy and have GENERIC insights — reserve high scores on ANY axis for genuinely hard-to-replicate, non-obvious ideas. Do NOT give every concept high scores across the board.\n` +
            `Return ONLY JSON: { "scores": [ { "conceptId", "axes": [ { "name", "score", "rationale" } ] } ] }`,
        },
      ],
      temperature: 0,
    });
  } catch (e) {
    console.warn("[moat] scoreMoat LLM call failed:", (e as Error)?.message ?? e);
    raw = {};
  }

  const byId = new Map<string, any[]>();
  for (const s of Array.isArray(raw?.scores) ? raw.scores : []) {
    if (typeof s?.conceptId === "string") byId.set(s.conceptId, Array.isArray(s.axes) ? s.axes : []);
  }

  return concepts.map((c) => {
    const rawAxes = byId.get(c.id);
    if (!rawAxes) {
      const ms = assemble(c.id, c.name, []);
      ms.warnings.push("concept missing from LLM output (all axes neutral)");
      return ms;
    }
    return assemble(c.id, c.name, rawAxes);
  });
}
