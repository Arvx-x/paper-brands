# Paper Brands

An **agentic brand foundry**. Point it at a product category and it will, *before
any inventory exists*:

1. **Research** the market from the real web (reviews, forums, marketplaces, prices).
2. **Invent** candidate private-label brands with an expert-agent council.
3. **Stress-test** them in a blind synthetic buyer arena → a relative win-rate.
4. **Build the creative** — a full visual identity + a self-optimizing library of
   high-polish ad/marketing creatives, rendered for real with image-gen models.

It is one horizontal engine; quality comes from **vertical data packs** and from
**optimization loops** that climb on a measurable signal.

> ⚠️ Synthetic scores (arena win-rate, jury creative score) are **hypothesis
> filters, not proof of demand.** They are directional until calibrated against
> real smoke-test CTR / signup data. The moat is that calibration loop — not
> "we use agents." See `QUALITY.md` for the operating contract every step must meet.

---

## Two halves

```
                          ┌──────────────────────── BRAND FOUNDRY ───────────────────────┐
  category ─▶ harvest ─▶ intel ─▶ CategoryPack ─▶ Council ─▶ candidate brands ─▶ Arena ─▶ win-rate
  (real web research)     (pack)                  (6 agents)                    (blind buyers)
                                                                                     │
                                                                            best candidate
                                                                                     ▼
                          ┌──────────────────────── CREATIVE FACTORY ────────────────────┐
   BrandConcept ─▶ BrandKit ─▶ identity (logo+packaging) ─▶ brief ─▶ spec ─▶ render ─▶ Jury
   (+ casting from market)        (jury-picked, become refs)                  │        (6 judges)
                                                                       hill-climb (best-of-N +
                                                                       visual edit loop) ─▶ library
```

Everything is JSON/data on disk and every loop keeps provenance, so runs are
inspectable, cacheable, and overridable.

---

## Quick start

```bash
cp .env.example .env          # fill PB_API_KEY (OpenAI) and/or PB_GOOGLE_API_KEY (Gemini)
bun install

# ── Brand foundry ───────────────────────────────────────────────
bun run harvest    --category="lip balm" --geo="India" --currency=INR   # research → data/<slug>/corpus.json
bun run intel      --category="lip balm" --geo="India" --currency=INR    # → a CategoryPack in packs/
bun run tournament --category=lipcare --candidates=4 --cohort=40         # council → blind arena → leaderboard
bun run optimize   --category=lipcare --rounds=5                         # hill-climb the best candidate's win-rate

# ── Creative factory ────────────────────────────────────────────
bun run creative   --concept=out/concept.json --geo=India --assets=ad-square,ad-story
bun run creative   --concept=out/concept.json --dry                     # run the whole loop, spend NO image credits
bun run creative-gen --brand="<name>" --asset=ad-story --aspect=9:16 --purpose="launch teaser"

# ── Optimize the generation STRUCTURE itself (meta-loop) ─────────
bun run structure-optimize --concept=out/concept.json --geo=India --rounds=2 --variants=2
bun run creative   --concept=out/concept.json --use-structure           # render with the winning structure
```

A `--concept=<path>` is a JSON `BrandConcept` (see `src/brand/types.ts`); the
foundry produces these, or you can hand-write one to drive the creative factory
directly.

---

## Models & providers

Models are addressed as `provider:model`. Two providers, both OpenAI-compatible
for text: `openai` and `google` (Gemini). Image generation uses Gemini's native
**Interactions API**.

```bash
PB_MODEL=openai:gpt-4o-mini            # council / strategy (text)
PB_SIM_MODEL=google:gemini-2.5-flash   # high-volume arena buyer simulations
PB_IMAGE_MODEL=gemini-3.1-flash-image  # creative drafts / optimizer iterations
PB_IMAGE_MODEL_PRO=gemini-3-pro-image  # final hero renders (aka nano-banana-pro)
PB_VISION_MODEL=gemini-2.5-flash       # the multimodal creative jury
```

Any command takes per-run overrides: `--model=...`, `--sim-model=...`,
`--provider=...`. Routing everything to Gemini works: add
`--model=google:gemini-2.5-flash`.

---

## The Brand Foundry

| Path | Role |
|------|------|
| `src/scrape/` | Real-web research: multi-provider search (OpenAI + Gemini), raw page fetch, price discovery + clustering |
| `src/intel/` | `plan.ts` derives a category-tailored research plan; `market.ts` builds a `CategoryPack` from the evidence |
| `src/categories/` | `CategoryPack` schema + registry (built-ins + generated `packs/*.json`) |
| `src/agents/` + `src/council/` | The 6-specialist council that turns a pack into fully-specified candidate brands |
| `src/personas/` | Evidence-backed synthetic buyer cohort |
| `src/arena/` + `src/scoring/` | Blind choice trials (candidates vs **disguised** competitors) → relative win-rate |
| `src/optimizer/` | Hill-climb a candidate's win-rate by mutating name/tagline/claim/price/offer |

**Grounding & provenance:** `harvest` fetches *raw* source pages; pack claims
carry `{quote, sourceUrl, verified}` (verified by literal containment +
independent-model entailment); confidence = f(attribution, independence, n);
degraded corpora are flagged, never hidden. `intel` grounds in this corpus by
default (`--no-ground` to skip). The full rigor contract is `QUALITY.md`.

**Blind arena:** competitor archetypes are disguised (no real names) and every
option is shown under a neutral `OPTION-x` label, controlling for LLM
pretraining bias so the score is purely relative.

---

## The Creative Factory (`src/creative/`)

Once a brand candidate exists, the factory builds its visual+verbal system and a
self-optimizing library — the same `Pack → Council → Arena → Optimizer` spine,
applied to visuals.

| Strategy pipeline | Creative pipeline |
|---|---|
| `CategoryPack` | **`BrandKit`** — palette (hex), type mood, art direction, voice, **casting** (derived from the target market), do/don't, negatives |
| `Council` | **Creative Council** — Art Director, Copywriter, Brand Guardian, Performance Marketer, Competitor-Creative Analyst, Prompt Engineer |
| `Arena` win-rate | **Jury** — 6 multimodal judges on a harsh curve score the *rendered image* → 0..100, with hard gates |
| `optimize()` | **`optimizeCreative()`** — best-of-N + visual-edit iteration; keep only past a significance margin |

**Flow:** `concept → [competitor-creative research] → BrandKit → identity (logo +
packaging, jury-picked) → brief → spec → render → jury → hill-climb → final pro
render → library`.

Key mechanics (learned the hard way — see AGENTS.md):
- **Casting is derived from the market, never hardcoded.** For an India brand →
  authentic Indian talent across the real range of skin tones (not a foreign
  stand-in, not one stereotyped tone). Gated by the jury's `marketFit` axis.
- **Identity images become reference inputs** to every later render, so the
  product/logo stay consistent across the whole library (a stick stays a stick).
- **Brief the model like a creative director, don't micro-place pixels.** The
  prompt carries vivid art direction; the model designs the finished piece.
- **Visual iteration edits the actual image** with the jury's targeted fixes
  (image passed back as a reference) instead of re-rolling from text.
- The jury score is a **synthetic quality signal** — calibrate before trusting.

---

## Optimizing the generation *structure* (the meta-loop)

The whole generation pipeline — prompt template, the spec fields the council
fills, the council roster, the jury rubric + gates — is expressed as **one
versioned JSON artifact**: a `GenStructure` (`src/creative/structure.ts`). `v1`
encodes the current known-good behaviour.

`structure-optimize` runs an **autonomous hill-climb on that structure**: a
meta-art-director model proposes structure variants (informed by the jury's
critique of the current structure's output), each variant renders a small fixed
eval set, the jury scores it, and a variant is kept only if it beats the
champion by a margin. Every version is saved to `structures/vN.json`
(`active.json` = winner) so it's inspectable and reversible, and the structure
**compounds** across runs.

```bash
bun run structure-optimize --concept=out/concept.json --geo=India --rounds=2 --variants=2
bun run creative --concept=out/concept.json --use-structure   # use the winning structure
```

---

## Layout

```
src/
  config.ts          provider/model resolution (text + image + vision)
  cli.ts             every command lives here
  llm/
    client.ts        provider-aware OpenAI-compatible text client (+ robust JSON)
    imageClient.ts   Gemini Interactions API (image gen) + multimodal vision (jury)
  scrape/  intel/  categories/  agents/  council/  personas/  arena/  scoring/  optimizer/   ← brand foundry
  creative/          ← creative factory (types, brandkit, council, identity, render,
                       jury, optimize, factory, pipeline, standards, structure, metaOptimize)
data/      <slug>/corpus.json, plan.json, brandkit.json        (gitignored)
packs/     generated CategoryPacks                              (gitignored)
out/       tournament + creative outputs, rendered images       (gitignored)
structures/ vN.json + active.json (versioned GenStructures)     (evals/ gitignored)
QUALITY.md  the rigor contract every pipeline step must satisfy
AGENTS.md   architecture, conventions, and gotchas for contributors/agents
```

---

## Status / honesty

- Brand foundry (research → pack → council → arena → optimizer) and the creative
  factory + structure meta-loop are implemented and run end-to-end.
- Image generation, the multimodal jury, and the meta-optimizer are validated on
  live runs; the structure loop has been validated in `--dry` and small live runs.
- **Not yet done:** calibration against real smoke-test CTR/signup (the thing
  that would make any synthetic score trustworthy); per-dimension hardening of
  the foundry continues per `QUALITY.md` Part 4.
