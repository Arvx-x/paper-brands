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

# Generate a CategoryPack for ANY category (saved to ./packs/<id>.json)
bun run intel       --category="Face Sunscreen" --geo="India" --currency=INR

bun run tournament  --category=lipcare --candidates=4 --cohort=40 --out=out
bun run winrate     --category=lipcare --candidates=4 --cohort=40   # single number
bun run optimize    --category=lipcare --candidates=3 --cohort=20 --rounds=5  # hill-climb

# Per-run provider A/B (any command):
bun run tournament  --category=lipcare --model=openai:gpt-4o --sim-model=google:gemini-2.5-flash
```

Generated packs in `./packs/` override built-ins of the same id, so any
category the intel agents create is immediately usable by tournament/optimize.

## Roadmap

- [x] Council → candidates → blind arena → win-rate (this scaffold)
- [x] Autoresearch optimizer: mutate name/tagline/claim/price/offer, keep if win-rate ↑ (`src/optimizer/`, `bun run optimize`)
- [x] Market Intelligence agents auto-build a CategoryPack from a brief — any category (`src/intel/`, `bun run intel`)
- [ ] Ground intel in mined reviews/listings/ads/search demand (currently model-knowledge)
- [ ] Calibration: log synthetic score vs real smoke-test CTR/signup
- [ ] Creative Factory (landing pages, ads, packaging mockups)
- [ ] Smoke Test Launcher + Evidence Dashboard
- [ ] Additional category packs (sunscreen, hair serums, supplements, ...)
