# Paper Brands

Agentic brand foundry. Turn a category into evidence-ranked, launchable
private-label brands **before inventory exists** — via an expert-agent council,
synthetic buyer simulation, and (next) real-world smoke tests.

> Win-rate from the synthetic arena is a **hypothesis filter, not proof of
> demand.** It is directional until calibrated against real smoke-test CTR /
> signup data. The moat is that calibration loop, not "we use agents."

## Pipeline (v0)

```
CategoryPack ──▶ Council ──▶ Candidate brands
                                  │
              Persona cohort ─────┤
                                  ▼
                          Blind Arena  (candidates vs DISGUISED competitors)
                                  ▼
                            Win-rate score
```

Competitor archetypes are **disguised** (no real brand names) and every option
is shown to buyer agents under a neutral `OPTION-x` label — this controls for
LLM pretraining bias and name recognition, so the score is purely relative.

## Layout

| Path | Role |
|------|------|
| `src/categories/` | Vertical packs (quality lives here). `lipcare.ts` is the pilot. |
| `src/agents/` | Specialist agents + council charters |
| `src/council/` | Territory generation → fully-specified brand concepts |
| `src/personas/` | Evidence-backed buyer cohort generation |
| `src/arena/` | Blind choice trials |
| `src/scoring/` | Relative win-rate report |
| `src/pipeline/` | End-to-end tournament |
| `src/llm/` | Provider-aware OpenAI-compatible client |

## Models & providers

Models are addressed as `provider:model`. Two providers are built in (both via
OpenAI-compatible endpoints): `openai` and `google` (Gemini). Strategy/council
runs on a strong model; the high-volume simulation arena defaults to fast/cheap
Gemini Flash.

```
PB_MODEL=openai:gpt-4o-mini          # council / strategy
PB_SIM_MODEL=google:gemini-2.5-flash # arena buyer simulations
```

## Run

```bash
cp .env.example .env   # fill PB_API_KEY + PB_GOOGLE_API_KEY
bun install

# Research a category with the analyst team + price intel (saved to ./data/<id>/)
bun run harvest     --category="lip balm" --geo="India" --currency=INR

# Generate a CategoryPack for ANY category (add --ground to use the corpus)
bun run intel       --category="lip balm" --geo="India" --currency=INR --ground

bun run tournament  --category=lipcare --candidates=4 --cohort=40 --out=out
bun run winrate     --category=lipcare --candidates=4 --cohort=40   # single number
bun run optimize    --category=lipcare --candidates=3 --cohort=20 --rounds=5  # hill-climb

# Per-run provider A/B (any command):
bun run tournament  --category=lipcare --model=openai:gpt-4o --sim-model=google:gemini-2.5-flash
```

Generated packs in `./packs/` override built-ins of the same id, so any
category the intel agents create is immediately usable by tournament/optimize.

## Research team & grounding (`src/scrape/`, `src/intel/analysts.ts`)

`bun run harvest` runs a **team of analyst agents**, each owning a lens and a
tailored query plan, over **OpenAI native web search** (`*-search-preview`,
synthesized answers with real citations — no brittle SERP scraping):

| Lens | Sources |
|------|---------|
| `social-chatter` | Reddit, Quora, forums |
| `social-media` | X/Twitter, Instagram, TikTok |
| `marketplace` | Amazon, Flipkart, Nykaa (best-sellers, 1–2★ complaints) |
| `reviews` | Editorial / dermatologist buying guides |
| `competitive` | Brand landscape, positioning, white space |
| `trends` | Emerging ingredients, formats, demand shifts |

Analysts run over **both OpenAI and Gemini grounded web search** (`research.ts`),
merging two indexes for wider coverage.

### Pricing (`prices.ts`) — layered + dynamic

Pricing is its own layered discovery, not a guess:
1. Fan out many queries (tiers × retailers × sub-segments) across **OpenAI +
   Gemini** grounded search to find as many real SKUs as possible.
2. Consolidate into structured records with a strict JSON pass.
3. Normalize pack size → **price-per-gram** (so 4g sticks vs 10g tubs compare).
4. Gently drop only absurd rows (never nuke small samples).
5. **Cluster prices to discover the natural number of tiers** (k chosen by
   silhouette, `cluster.ts`) — dynamic labels, ranges, shares, per-gram medians,
   and example SKUs. No hardcoded 3 tiers.

These data-derived bands override the strategy model's bands; archetype price
positioning is constrained to the discovered tier labels.

`intel --ground` feeds the multi-lens corpus + the derived bands to the Market
Intelligence agents (archetypes stay disguised). Run a subset with
`--lenses=marketplace,social-chatter`.

> Note: `search.ts` / `http.ts` keep a no-key scripted fallback (SearXNG, Jina
> reader, DDG-lite) for environments without an OpenAI key, but the default and
> recommended path is OpenAI web search.

## Creative Factory (`src/creative/`, `bun run creative`)

Once a brand candidate exists, the Creative Factory builds its **visual + verbal
system and a self-optimizing library of high-polish creatives** — the same
`Pack → Council → Arena → Optimizer` spine, applied to visuals:

| Strategy pipeline | Creative pipeline |
|---|---|
| `CategoryPack` | **`BrandKit`** — palette (hex), type mood, art direction, voice, do/don't, negative prompt |
| `Council` (strategy agents) | **Creative Council** — Art Director, Copywriter, Brand Guardian, Performance Marketer, Competitor-Creative Analyst, Prompt Engineer |
| `Arena` (blind buyer win-rate) | **Jury** — multimodal vision panel scores the *rendered* image (polish / brand-consistency / clarity / conversion / differentiation) → 0..100 |
| `optimize()` hill-climb | **`optimizeCreative()`** — mutate copy/layout/prompt, re-render, keep if jury score ↑ |

Flow: `concept → [competitor-creative research] → BrandKit → identity (logo +
packaging, jury-picked) → brief → spec → render → jury → hill-climb → final pro
render → library`. The chosen **logo/packaging become reference images** fed into
every later render, so the whole library stays visually consistent. The resulting
BrandKit + identity refs then power on-demand generation of **any asset at any
dimension** (`creative-gen`).

Rendering uses **Gemini image models** via the Interactions API
(`PB_IMAGE_MODEL` flash for drafts/iterations, `PB_IMAGE_MODEL_PRO` for finals);
the jury sees pixels via the OpenAI-compat vision layer (`PB_VISION_MODEL`).

```bash
# Full loop from a category (seeds a tournament, then builds creatives)
bun run creative --category=lipcare --assets=ad-square,ad-story,landing-hero --research --rounds=3

# From a saved concept JSON; --dry judges the prompt instead of spending image credits
bun run creative --concept=out/concept.json --dry

# Build just the BrandKit
bun run brandkit --concept=out/concept.json --research

# Generate ANY asset at ANY dimension on demand, on-brand
bun run creative-gen --brand="<name>" --asset=ad-story --aspect=9:16 --purpose="ramp-up launch teaser"
```

> Same caveat as the arena: the jury score is a **synthetic quality signal**, a
> hypothesis filter — calibrate it against real engagement before trusting it.

## Roadmap

- [x] Council → candidates → blind arena → win-rate (this scaffold)
- [x] Autoresearch optimizer: mutate name/tagline/claim/price/offer, keep if win-rate ↑ (`src/optimizer/`, `bun run optimize`)
- [x] Market Intelligence agents auto-build a CategoryPack from a brief — any category (`src/intel/`, `bun run intel`)
- [x] Programmatic scraping/grounding: harvest a real corpus, ground the pack in it (`src/scrape/`, `bun run harvest`, `intel --ground`)
- [x] Creative Factory: BrandKit → identity → self-optimizing creative library, any asset/dimension (`src/creative/`, `bun run creative`)
- [ ] Calibration: log synthetic score vs real smoke-test CTR/signup
- [ ] Smoke Test Launcher + Evidence Dashboard
- [ ] Additional category packs (sunscreen, hair serums, supplements, ...)
