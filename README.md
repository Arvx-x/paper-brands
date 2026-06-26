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

# Scrape a real evidence corpus for a category (scripted; saved to ./data/<id>/)
bun run harvest     --category="lip balm" --geo="India" --results=10 --pages=25

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

## Scraping & grounding (`src/scrape/`)

`bun run harvest` runs an intent-driven query plan (best-of, complaints,
buying guides, ingredients-to-avoid, price comparison, ...) entirely through
**scripts** — no agent browser. Pipeline:

1. `search.ts` — multi-provider web search. **Keyed APIs preferred** (set any of
   `PB_SERPER_KEY` / `PB_BRAVE_KEY` / `PB_TAVILY_KEY`); no-key fallbacks
   (SearXNG, Jina-reader-on-SERP, DDG-lite) work but mainstream sites heavily
   rate-limit, so quality benefits a lot from a key.
2. `http.ts` — `fetchReadable` pulls full page text via direct fetch, falling
   back to the Jina reader proxy for JS-heavy/soft-blocked pages.
3. `harvest.ts` — dedupes, applies a relevance filter, saves `data/<id>/corpus.json`.

`intel --ground` feeds the corpus to the Market Intelligence agents, which must
ground unmet needs / rejection reasons / price bands / archetypes in real
phrasing (archetypes still disguised). Agent-browser is a supported manual
fallback for hard-blocked sources; the default path is scripted.

> Reality check from this build: no-key search of mainstream review/marketplace
> sites is heavily bot-gated. For "scrape immensely" at quality, add a search
> API key — the keyed provider is wired and preferred automatically.

## Roadmap

- [x] Council → candidates → blind arena → win-rate (this scaffold)
- [x] Autoresearch optimizer: mutate name/tagline/claim/price/offer, keep if win-rate ↑ (`src/optimizer/`, `bun run optimize`)
- [x] Market Intelligence agents auto-build a CategoryPack from a brief — any category (`src/intel/`, `bun run intel`)
- [x] Programmatic scraping/grounding: harvest a real corpus, ground the pack in it (`src/scrape/`, `bun run harvest`, `intel --ground`)
- [ ] Calibration: log synthetic score vs real smoke-test CTR/signup
- [ ] Calibration: log synthetic score vs real smoke-test CTR/signup
- [ ] Creative Factory (landing pages, ads, packaging mockups)
- [ ] Smoke Test Launcher + Evidence Dashboard
- [ ] Additional category packs (sunscreen, hair serums, supplements, ...)
