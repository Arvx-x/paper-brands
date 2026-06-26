import { LLMClient } from "../llm/client.ts";
import { ImageClient, readImage, type ImageBlob } from "../llm/imageClient.ts";
import { brandKitDigest } from "./brandkit.ts";
import { renderCreative, composeEditPrompt } from "./render.ts";
import { juryScore } from "./jury.ts";
import {
  CreativeSpecSchema,
  type BrandKit,
  type CreativeSpec,
  type JuryVerdict,
  type RenderedCreative,
} from "./types.ts";

export interface CreativeOptimizeOptions {
  kit: BrandKit;
  spec: CreativeSpec;
  rounds: number;
  /** Candidates rendered for the initial spec; best is the starting champion. */
  bestOf?: number;
  /** Fresh text-mutated explorers rendered alongside each refine round. */
  variantsPerRound?: number;
  /**
   * Minimum jury-score gain (0..100) required to accept a challenger. Guards
   * against churning the champion on LLM scoring noise — a small but real margin
   * is more trustworthy than any improvement (cf. the win-rate optimizer's known
   * "no significance margin" issue).
   */
  acceptMargin?: number;
  refImages?: ImageBlob[];
  outDir: string;
  dry?: boolean;
  llm?: LLMClient;
  imageClient?: ImageClient;
}

export interface CreativeOptimizeStep {
  round: number;
  championScore: number;
  challengerScore: number;
  accepted: boolean;
  how: string;
}

export interface CreativeOptimizeResult {
  champion: RenderedCreative;
  verdict: JuryVerdict;
  startScore: number;
  finalScore: number;
  history: CreativeOptimizeStep[];
}

interface Candidate {
  rendered: RenderedCreative;
  verdict: JuryVerdict;
  blob: ImageBlob | null;
}

/**
 * Optimize a creative to high polish in two moves:
 *   1. best-of-N — render several takes of the initial spec, jury-pick the best;
 *   2. visual iteration — each round, the jury critiques the ACTUAL champion
 *      image, then we EDIT that image (passing it back as a reference) to apply
 *      only the targeted fixes, plus one fresh text-mutated explorer for reach.
 * Editing-in-place is what converges to craft instead of re-rolling the dice.
 * Falls back to fresh text renders in --dry mode (no image to edit).
 */
export async function optimizeCreative(
  opts: CreativeOptimizeOptions,
): Promise<CreativeOptimizeResult> {
  const llm = opts.llm ?? new LLMClient();
  const ic = opts.imageClient ?? new ImageClient();
  const bestOf = opts.bestOf ?? 2;
  const explorers = opts.variantsPerRound ?? 1;
  const margin = opts.acceptMargin ?? 1.5;

  const renderScore = async (
    spec: CreativeSpec,
    o: { stem: string; refImages?: ImageBlob[]; promptOverride?: string },
  ): Promise<Candidate> => {
    const rendered = await renderCreative(opts.kit, spec, {
      tier: "flash",
      refImages: o.refImages ?? opts.refImages,
      promptOverride: o.promptOverride,
      nameStem: o.stem,
      dry: opts.dry,
      outDir: `${opts.outDir}/iter`,
      client: ic,
    });
    const verdict = await juryScore(rendered, opts.kit, { imageClient: ic, llm });
    const blob =
      opts.dry || rendered.imagePath.endsWith(".prompt.txt")
        ? null
        : await readImage(
            rendered.imagePath,
            rendered.imagePath.endsWith(".jpg") ? "image/jpeg" : "image/png",
          ).catch(() => null);
    return { rendered, verdict, blob };
  };

  // 1) best-of-N initial render.
  const initial = await Promise.all(
    Array.from({ length: Math.max(1, bestOf) }, (_, i) =>
      renderScore(opts.spec, { stem: `${opts.spec.id}-init-${i + 1}` }).catch(() => null),
    ),
  );
  let champion = pickBest(initial.filter((c): c is Candidate => c !== null));
  if (!champion) throw new Error(`optimize: all initial renders failed for ${opts.spec.id}`);
  const startScore = champion.verdict.overall;
  const history: CreativeOptimizeStep[] = [];

  // 2) visual iteration rounds.
  for (let round = 1; round <= opts.rounds; round++) {
    const contenders: { cand: Candidate; how: string }[] = [];

    // (a) In-place edit of the champion image with the jury's fixes.
    if (champion.blob) {
      const editPrompt = composeEditPrompt(opts.kit, champion.rendered.spec, champion.verdict.fixes);
      const edited = await renderScore(champion.rendered.spec, {
        stem: `${opts.spec.id}-r${round}-edit`,
        refImages: [champion.blob],
        promptOverride: editPrompt,
      }).catch(() => null);
      if (edited) contenders.push({ cand: edited, how: "visual-edit" });
    }

    // (b) Fresh text-mutated explorers (also the only path in --dry mode).
    const mutated = await proposeVariants(llm, opts.kit, champion.rendered.spec, champion.verdict, explorers);
    const explored = await Promise.all(
      mutated.map((m, i) =>
        renderScore(m.spec, { stem: `${opts.spec.id}-r${round}-alt${i + 1}` })
          .then((c) => ({ cand: c, how: `respec:${m.lever}` }))
          .catch(() => null),
      ),
    );
    for (const e of explored) if (e) contenders.push(e);

    const best = contenders.sort((a, b) => b.cand.verdict.overall - a.cand.verdict.overall)[0];
    const accepted = !!best && best.cand.verdict.overall >= champion.verdict.overall + margin;
    history.push({
      round,
      championScore: champion.verdict.overall,
      challengerScore: best?.cand.verdict.overall ?? 0,
      accepted,
      how: best?.how ?? "(none)",
    });
    console.error(
      `  round ${round}: champ ${champion.verdict.overall.toFixed(1)} vs ` +
        `${(best?.cand.verdict.overall ?? 0).toFixed(1)} -> ${accepted ? "ACCEPT" : "keep"} | ${best?.how ?? ""}`,
    );
    if (accepted && best) champion = best.cand;
  }

  return {
    champion: champion.rendered,
    verdict: champion.verdict,
    startScore,
    finalScore: champion.verdict.overall,
    history,
  };
}

function pickBest(cands: Candidate[]): Candidate | null {
  if (cands.length === 0) return null;
  return cands.sort((a, b) => b.verdict.overall - a.verdict.overall)[0]!;
}

interface Variant {
  spec: CreativeSpec;
  lever: string;
}

const LEVERS = [
  "headline + subhead clarity and hook",
  "composition and visual hierarchy",
  "lighting, lens, and depth of field",
  "color grade and contrast for scroll-stop",
  "texture and material realism",
];

async function proposeVariants(
  llm: LLMClient,
  kit: BrandKit,
  champion: CreativeSpec,
  verdict: JuryVerdict,
  n: number,
): Promise<Variant[]> {
  if (n <= 0) return [];
  const out: Variant[] = [];
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const lever = LEVERS[i % LEVERS.length]!;
      try {
        const raw = await llm.completeJson<Record<string, unknown>>({
          messages: [
            {
              role: "system",
              content:
                "You are an award-winning art director improving a brand creative. Push the " +
                "specified lever hard while staying strictly within the BrandKit. Keep all " +
                "art-direction fields populated and concrete. Return the COMPLETE spec JSON.",
            },
            {
              role: "user",
              content:
                `BrandKit:\n${brandKitDigest(kit)}\n\n` +
                `Jury critique: ${verdict.critique}\nFixes: ${verdict.fixes.join("; ")}\n\n` +
                `Current spec JSON:\n${JSON.stringify(champion)}\n\n` +
                `Aggressively improve the lever: ${lever}. Keep id="${champion.id}", ` +
                `briefId, assetType, aspect. Return the COMPLETE spec JSON with the same keys.`,
            },
          ],
          temperature: 0.95,
        });
        const spec = CreativeSpecSchema.parse({
          ...raw,
          id: champion.id,
          briefId: champion.briefId,
          assetType: champion.assetType,
          aspect: champion.aspect,
        });
        out.push({ spec, lever });
      } catch {
        /* skip failed variant */
      }
    }),
  );
  return out;
}
