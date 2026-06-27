# AGENTS.md

Working notes for anyone (human or AI) modifying this repo. Read `README.md` for
what the product does and `QUALITY.md` for the rigor contract. This file is about
*how the code is built and the traps to avoid.*

## Runtime & commands

- **Bun + TypeScript, ESM.** No build step; run files directly with `bun`.
- `bun run typecheck` — `tsc --noEmit`. Must stay green. Run it after every change.
- Every command is a `case` in `src/cli.ts`. Flags: `arg("name")` reads
  `--name=value`, `flag("name")` reads boolean `--name`.
- `.env` holds keys; `data/`, `packs/`, `out/`, `structures/evals/` are gitignored.
  Versioned `structures/*.json` are tracked (the compounding asset).

## Two subsystems

- **Brand foundry** — `scrape/ → intel/ → categories/ → agents/+council/ →
  personas/ → arena/+scoring/ → optimizer/`. Produces `BrandConcept`s.
- **Creative factory** — `src/creative/`. Consumes a `BrandConcept`, produces a
  visual identity + a scored, optimized creative library.

Data flows as JSON on disk between stages; each stage is independently runnable.

## Core conventions

- **Provider-aware models.** Everything addresses models as `provider:model`
  (`config.ts`, `resolveModel`). Text + arena use the OpenAI-compatible layer
  (`llm/client.ts`). Don't hardcode providers in feature code.
- **LLM JSON.** Use `LLMClient.completeJson<T>()` — it requests JSON, strips
  fences, salvages the largest brace-balanced substring, and does one repair
  retry at temp 0 with extra token headroom. Then validate with a zod schema.
  Models (esp. Gemini) sometimes nest a string field as an object or vary enum
  casing — schemas use tolerant coercion (`FlexString` in `creative/types.ts`,
  the case-insensitive enum in `personas/cohort.ts`). Prefer tolerance over
  hard-failing a whole run.
- **Disguise competitors / blind the arena.** Never leak real brand names into a
  simulator prompt; options are shown as `OPTION-x`.
- **Keep provenance.** Foundry claims carry quote+source+verification; creative
  runs persist specs, verdicts, and structure versions. Don't silently drop
  evidence or "degraded" flags.

## The image / vision client (`llm/imageClient.ts`)

Gemini image gen is **NOT** on the OpenAI-compat layer. Hard-won facts about the
**Interactions API** (post-training-cutoff; verify at ai.google.dev if it breaks):

- Endpoint `POST {geminiBaseUrl}/interactions`, header `x-goog-api-key`.
- Body: `{ model, input:[{type:"text",text},{type:"image",mime_type,data}], response_format:{type:"image", mime_type, aspect_ratio, image_size}, generation_config:{temperature, thinking_level}, system_instruction }`.
- `response_format.mime_type` must be **`image/jpeg`** (png is rejected).
- `thinking_level` for image models must be **`low`** (not `minimal`).
- Output image at `output_image.data` or `steps[*].content[*]` where `type==="image"`.
- Model ids that exist: `gemini-3.1-flash-image` (draft), `gemini-3-pro-image`
  (final). There is **no** `gemini-3.1-pro-image`.
- Reference/edit images go in `input` as `type:"image"` parts → this is how we
  keep product/logo consistent and how the visual-edit loop refines in place.
- The jury's **vision** path uses the OpenAI-compat `/chat/completions` with
  `image_url` data URLs (`PB_VISION_MODEL`), a separate, known-good transport.

## Creative quality: hard-won lessons (do not relearn these)

1. **Brief the model like a creative director; don't programmatically comp.**
   Decomposing into headline/CTA/product and instructing placement → templated,
   "Frankenstein" output. Give vivid art direction and let the model design the
   finished piece.
2. **Don't bloat the image prompt.** A 40-line wall of "AVOID x, y, z…" degrades
   image-model output and can summon the very artifacts named. Craft standards
   live in the **jury + council reasoning** (text), not dumped into the image
   prompt. Keep the prompt tight and positive.
3. **Casting is derived from the market, never hardcoded.** Authentic local
   talent across real diversity; gated by the jury `marketFit` axis.
4. **Identity images are references** for every later render → visual consistency.
5. **NEVER change the generation prompt and claim it's better without rendering
   and looking.** The prompt is the single highest-variance lever; a plausible
   "improvement" regressed it twice. Render a comparison first.

## The structure-as-data design (`creative/structure.ts`)

The entire generation pipeline (prompt template, spec fields, council roster,
jury rubric + gates) is one versioned `GenStructure` JSON. `defaultStructure()`
= v1 = current known-good behaviour. Consumers (`council`, `render`, `jury`,
`optimize`, `identity`, `factory`, `pipeline`) take an optional `structure` and
fall back to the default, so nothing regresses if it's absent.

- `composePrompt` fills `promptTemplate` placeholders: `{assetType} {aspect}
  {brandName} {brandSystem} {imagePrompt} {direction} {text} {directives}
  {negatives}`. A mutated template MUST keep `{imagePrompt}` and `{text}`
  (validated in `metaOptimize.validTemplate`).
- `metaOptimize.ts` hill-climbs the structure: propose variants → render a fixed
  eval set under each → jury-score → keep past a margin → save every version.
  The eval briefs are frozen so only the structure varies (apples-to-apples).

## How to extend

- **New category pack:** `bun run harvest` then `bun run intel` (writes
  `packs/<id>.json`), or hand-write one matching `categories/types.ts`.
- **New creative asset type / dimension:** add to `ASSET_PRESETS` in
  `creative/types.ts` (or just pass `--asset`/`--aspect` to `creative-gen`).
- **Change generation behaviour:** prefer editing the `GenStructure` (data) over
  hardcoding, so the meta-optimizer can reason about and evolve it.
- **New jury axis:** add to the structure's `rubric` (+ a gate if high-stakes);
  the jury and `scoreWith` are generic over rubric keys.

## Testing reality

There are no unit tests; validation is **live runs + looking at output**. For
loops, use `--dry` first (judges the composed prompt, spends no image credits)
to check wiring, then a small real run. Cheapest real check is a single
`creative-gen` (one render). Don't run large batches to validate a code change.
