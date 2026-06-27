import { LLMClient } from "../llm/client.ts";
import { ImageClient, type ImageBlob } from "../llm/imageClient.ts";
import { CreativeCouncil } from "./council.ts";
import { renderCreative } from "./render.ts";
import { juryScore } from "./jury.ts";
import {
  GenStructureSchema,
  defaultStructure,
  saveStructure,
  type GenStructure,
} from "./structure.ts";
import { CreativeBriefSchema, type BrandKit, type CreativeBrief } from "./types.ts";

export interface MetaOptimizeOptions {
  kit: BrandKit;
  /** Identity references so eval renders are consistent (logo/packaging). */
  refImages?: ImageBlob[];
  /** Asset types the eval set renders (kept small — every variant re-renders these). */
  evalAssets?: string[];
  rounds?: number;
  /** Structure variants proposed per round. */
  variantsPerRound?: number;
  /** Minimum aggregate-score gain to accept a new structure version. */
  acceptMargin?: number;
  startStructure?: GenStructure;
  dry?: boolean;
  structuresDir?: string;
  llm?: LLMClient;
  imageClient?: ImageClient;
}

export interface MetaStep {
  round: number;
  bestVersion: number;
  championScore: number;
  challengerScore: number;
  accepted: boolean;
  changelog: string;
}

export interface MetaOptimizeResult {
  champion: GenStructure;
  startScore: number;
  finalScore: number;
  history: MetaStep[];
}

interface Eval {
  score: number;
  /** Aggregated jury critique across the eval set — feeds the next mutation. */
  notes: string;
}

/**
 * Autonomous hill-climb over the GENERATION STRUCTURE itself (prompt template,
 * spec fields, council, jury rubric/gates). Each round a meta-art-director model
 * proposes structure variants informed by the jury's critique of the current
 * structure's output; we render a fixed eval set under each, score with that
 * structure's own jury, and keep a variant only if it beats the champion by a
 * margin. Versions are persisted so the structure compounds and is reversible.
 *
 * The brief set is generated ONCE from the start structure and frozen, so across
 * variants only the structure varies — an apples-to-apples comparison.
 */
export async function optimizeStructure(opts: MetaOptimizeOptions): Promise<MetaOptimizeResult> {
  const llm = opts.llm ?? new LLMClient();
  const ic = opts.imageClient ?? new ImageClient();
  const rounds = opts.rounds ?? 3;
  const n = opts.variantsPerRound ?? 2;
  const margin = opts.acceptMargin ?? 1.5;
  const evalAssets = opts.evalAssets?.length ? opts.evalAssets : ["ad-square"];

  let champion = opts.startStructure ?? defaultStructure();
  const briefs = freezeBriefs(evalAssets);

  const evaluate = async (structure: GenStructure): Promise<Eval> => {
    const council = new CreativeCouncil(opts.kit, llm, structure);
    const results = await Promise.all(
      briefs.map(async (brief, i) => {
        const spec = await council.specifyCreative(brief).catch(() => null);
        if (!spec) return null;
        const rendered = await renderCreative(opts.kit, spec, {
          tier: "flash",
          refImages: opts.refImages,
          structure,
          nameStem: `v${structure.version}-${brief.assetType}-${i}`,
          dry: opts.dry,
          outDir: `${opts.structuresDir ?? "structures"}/evals`,
          client: ic,
        }).catch(() => null);
        if (!rendered) return null;
        return juryScore(rendered, opts.kit, { structure, imageClient: ic, llm }).catch(() => null);
      }),
    );
    const ok = results.filter((v): v is NonNullable<typeof v> => v !== null);
    if (ok.length === 0) return { score: 0, notes: "all eval renders failed" };
    const score = ok.reduce((s, v) => s + v.overall, 0) / ok.length;
    const notes = ok.map((v) => `${v.critique} Fixes: ${v.fixes.join("; ")}`).join(" || ").slice(0, 2500);
    return { score: Math.round(score * 10) / 10, notes };
  };

  let champEval = await evaluate(champion);
  const startScore = champEval.score;
  await saveStructure(champion, opts.structuresDir);
  console.error(`[meta] baseline v${champion.version}: ${startScore.toFixed(1)}`);

  const history: MetaStep[] = [];
  let versionCounter = champion.version;

  for (let round = 1; round <= rounds; round++) {
    const variants = await proposeStructures(llm, champion, champEval.notes, n, () => ++versionCounter);

    let best: { s: GenStructure; e: Eval } | null = null;
    for (const v of variants) {
      const e = await evaluate(v).catch(() => null);
      if (!e) continue;
      console.error(`[meta]   v${v.version} (${v.changelog.slice(0, 60)}): ${e.score.toFixed(1)}`);
      await saveStructure(v, opts.structuresDir); // keep every version for inspection/rollback
      if (!best || e.score > best.e.score) best = { s: v, e };
    }

    const accepted = !!best && best.e.score >= champEval.score + margin;
    history.push({
      round,
      bestVersion: best?.s.version ?? champion.version,
      championScore: champEval.score,
      challengerScore: best?.e.score ?? 0,
      accepted,
      changelog: best?.s.changelog ?? "(none)",
    });
    console.error(
      `[meta] round ${round}: champ v${champion.version} ${champEval.score.toFixed(1)} vs ` +
        `v${best?.s.version} ${(best?.e.score ?? 0).toFixed(1)} -> ${accepted ? "ACCEPT" : "keep"}`,
    );

    if (accepted && best) {
      champion = best.s;
      champEval = best.e;
    }
  }

  await saveStructure(champion, opts.structuresDir); // active.json = winner
  return { champion, startScore, finalScore: champEval.score, history };
}

/** Fixed eval briefs (no LLM) so the brief is identical across all structures. */
function freezeBriefs(assets: string[]): CreativeBrief[] {
  return assets.map((a) =>
    CreativeBriefSchema.parse({
      id: `eval-${a}`,
      assetType: a,
      purpose: `flagship launch ${a} that has to stop the scroll and feel premium`,
      audience: "the brand's core target customer",
      channel: a,
      bigIdea: `a striking, unmistakably on-brand ${a} hero creative`,
      mustInclude: [],
    }),
  );
}

async function proposeStructures(
  llm: LLMClient,
  current: GenStructure,
  critique: string,
  n: number,
  nextVersion: () => number,
): Promise<GenStructure[]> {
  const focuses = [
    "the image-prompt template wording and how art direction is framed",
    "the specFields and specSystem (what the council is asked to decide)",
    "the council roster/charters and the jury rubric weights or gates",
  ];
  const out: GenStructure[] = [];
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const focus = focuses[i % focuses.length]!;
      try {
        const raw = await llm.completeJson<Record<string, unknown>>({
          temperature: 0.8,
          maxTokens: 4096,
          messages: [
            {
              role: "system",
              content:
                "You are a meta art director optimizing a creative-generation PIPELINE that is " +
                "expressed entirely as one JSON object (a GenStructure). Improving this JSON improves " +
                "every creative it produces. Make a focused, sensible improvement; do not gratuitously " +
                "rewrite everything. Keep the JSON the SAME SHAPE (same keys). The promptTemplate MUST " +
                "keep the placeholders {assetType} {aspect} {brandName} {brandSystem} {imagePrompt} " +
                "{direction} {text} {directives} {negatives}. Return the COMPLETE updated GenStructure JSON.",
            },
            {
              role: "user",
              content:
                `Current GenStructure:\n${JSON.stringify(current)}\n\n` +
                `The jury's critique of what this structure produced:\n${critique || "(no critique captured)"}\n\n` +
                `Propose an improved structure, focusing especially on: ${focus}. ` +
                `Write a clear one-line 'changelog' describing exactly what you changed and why. ` +
                `Return ONLY the complete JSON object.`,
            },
          ],
        });
        const parsed = GenStructureSchema.parse({
          ...raw,
          version: nextVersion(),
          parentVersion: current.version,
        });
        if (!validTemplate(parsed.promptTemplate)) return; // reject broken templates
        out.push(parsed);
      } catch {
        /* skip invalid variant */
      }
    }),
  );
  return out;
}

/** A usable template must at least place the creative description and the copy. */
function validTemplate(t: string): boolean {
  return t.includes("{imagePrompt}") && t.includes("{text}");
}
