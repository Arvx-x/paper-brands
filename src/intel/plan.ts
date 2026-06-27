import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { LLMClient } from "../llm/client.ts";

/**
 * A ResearchPlan is the category-agnostic "how to research THIS category"
 * config. It replaces what used to be a hardcoded, skincare/India-specific
 * analyst roster. The plan is derived per (category, geography) by an agent and
 * persisted as data (data/<slug>/plan.json) — inspectable, cacheable, and
 * overridable — so the platform engine itself stays category-blind.
 *
 * The unitOfMeasure is the key decoupling: lipcare is priced per gram, but
 * supplements are per serving, electronics per unit, subscriptions per month.
 * The engine must not assume weight.
 */

export const UnitOfMeasureSchema = z.object({
  /** What price normalizes against in this category. */
  kind: z.enum(["weight", "volume", "count", "serving", "duration", "none"]).catch("none"),
  /** Display unit, e.g. "g", "ml", "capsule", "serving", "month". */
  unit: z.string().default("unit"),
  /** Tokens to detect a quantity in a raw pack-size string (e.g. ["g","gram","ml"]). */
  aliases: z.array(z.string()).default([]),
});
export type UnitOfMeasure = z.infer<typeof UnitOfMeasureSchema>;

export const ResearchLensSchema = z.object({
  id: z.string(),
  lens: z.string().describe("human label for what this lens looks at"),
  system: z.string().describe("analyst system prompt for this lens"),
  /** Concrete queries (already interpolated with category + geography). */
  queries: z.array(z.string()),
});
export type ResearchLens = z.infer<typeof ResearchLensSchema>;

export const ResearchPlanSchema = z.object({
  category: z.string(),
  geography: z.string(),
  currency: z.string(),
  /** Where listings/prices live for THIS category + geo. */
  retailers: z.array(z.string()),
  /** Communities/social venues where this category is discussed. */
  communities: z.array(z.string()),
  /** Meaningful product variants/sub-segments (e.g. tinted, medicated). */
  subtypes: z.array(z.string()),
  unitOfMeasure: UnitOfMeasureSchema,
  lenses: z.array(ResearchLensSchema),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

export interface PlanBrief {
  category: string;
  geography?: string;
  currency?: string;
}

const g = (geo: string) => (geo ? ` in ${geo}` : "");

/**
 * Deterministic, category-blind fallback plan. Generic lens *intents* with no
 * vertical-specific sources baked in — used when no agent-derived plan exists
 * or the planner fails. Concrete sources are left to the model at query time.
 */
export function defaultPlan(brief: PlanBrief): ResearchPlan {
  const c = brief.category;
  const geo = brief.geography ?? "";
  const lenses: ResearchLens[] = [
    {
      id: "social-chatter",
      lens: "Community & forums",
      system:
        "You are a social-listening analyst reading community discussion (Reddit, " +
        "Quora, niche forums) for this category. Surface the real language people " +
        "use: recommendations, recurring complaints, and 'what should I buy' threads. " +
        "Quote actual phrasing.",
      queries: [
        `${c} recommendations reddit OR forum${g(geo)}`,
        `${c} "holy grail" OR favourite thread`,
        `${c} complaints "doesn't work" OR disappointed forum`,
        `what ${c} do people actually recommend${g(geo)}`,
      ],
    },
    {
      id: "social-media",
      lens: "Social media trends",
      system:
        "You are a social-media trend analyst (X/Twitter, Instagram, TikTok, YouTube). " +
        "Surface viral products, influencer talking points, trending claims and " +
        "aesthetics, and what creates buzz or backlash. Note hashtags, formats, and " +
        "the emotional hooks that drive shares.",
      queries: [
        `${c} viral tiktok OR instagram${g(geo)}`,
        `${c} trend 2024 2025`,
        `${c} influencer recommendation${g(geo)}`,
      ],
    },
    {
      id: "marketplace",
      lens: "Marketplaces & retail listings",
      system:
        "You are a marketplace analyst reading retailer listings and ratings for this " +
        "category. Surface best-sellers, star ratings, the most common 1-2 star " +
        "complaints, pack/size options, and how products are merchandised. Be specific " +
        "about what wins and loses on the shelf.",
      queries: [
        `best selling ${c}${g(geo)} reviews ratings`,
        `${c} 1 star reviews common complaints`,
        `${c} bestseller${g(geo)}`,
      ],
    },
    {
      id: "reviews",
      lens: "Editorial reviews & buying guides",
      system:
        "You are a review analyst reading editorial reviews, expert articles, and " +
        "buying guides for this category. Surface expert-endorsed criteria, what " +
        "experts say to avoid, and how 'good' is defined by credible voices.",
      queries: [
        `${c} buying guide what to look for expert`,
        `${c} what to avoid expert${g(geo)}`,
        `best ${c} editorial review${g(geo)}`,
      ],
    },
    {
      id: "competitive",
      lens: "Competitive & brand landscape",
      system:
        "You are a competitive analyst mapping the brand landscape. Surface the major " +
        "players, their positioning, price tiers, hero claims, and where each is " +
        "strong or weak. Report where incumbents already serve buyers WELL as well as " +
        "any genuinely underserved need. Do not assume a gap exists — 'the market is " +
        "well served here' is a valid finding.",
      queries: [
        `top ${c} brands${g(geo)} positioning`,
        `${c} premium vs budget brands${g(geo)}`,
        `${c} what buyers love and what frustrates them${g(geo)}`,
      ],
    },
    {
      id: "trends",
      lens: "Demand & emerging trends",
      system:
        "You are a trend/demand analyst. Surface what is growing — emerging features, " +
        "formats, claims, and consumer shifts — plus seasonal or regional demand " +
        "patterns relevant to launching now.",
      queries: [
        `${c} emerging trends 2025${g(geo)}`,
        `${c} new feature OR format growing demand`,
        `${c} consumer shift${g(geo)}`,
      ],
    },
  ];

  return {
    category: c,
    geography: geo,
    currency: brief.currency ?? "USD",
    retailers: ["major online marketplaces", "category specialist retailers", "brand websites"],
    communities: ["Reddit", "Quora", "category forums", "Instagram", "TikTok", "YouTube"],
    subtypes: [],
    unitOfMeasure: { kind: "none", unit: "unit", aliases: [] },
    lenses,
  };
}

/**
 * Agent-derived research plan: an LLM tailors the lenses, sources, retailers,
 * sub-segments, and the pricing unit-of-measure to THIS category + geography.
 * Falls back to defaultPlan() on any failure so harvest never hard-blocks.
 */
export async function buildResearchPlan(
  brief: PlanBrief,
  llm = new LLMClient(),
): Promise<ResearchPlan> {
  const fallback = defaultPlan(brief);
  try {
    const raw = await llm.completeJson<Record<string, unknown>>({
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You design a research plan for analysing a product category in a given " +
            "market. Tailor everything to the category: the right communities, the " +
            "right retailers/marketplaces, the meaningful sub-segments, and CRUCIALLY " +
            "the unit a buyer uses to judge value (weight for creams, servings for " +
            "supplements, count for capsules, duration for subscriptions, or none for " +
            "single-unit goods like electronics or apparel). Never assume weight.",
        },
        {
          role: "user",
          content:
            `Category: ${brief.category}\n` +
            `Geography: ${brief.geography ?? "(global)"}\n` +
            `Currency: ${brief.currency ?? "USD"}\n\n` +
            `Return JSON with EXACTLY these keys:\n` +
            `- retailers[]: the specific marketplaces/retailers where this category is bought ${g(brief.geography ?? "")}\n` +
            `- communities[]: the specific forums/subreddits/social venues where it is discussed\n` +
            `- subtypes[]: meaningful product variants/sub-segments\n` +
            `- unitOfMeasure: { kind (weight|volume|count|serving|duration|none), unit (display, e.g. "g","serving","month"), aliases[] (tokens to detect quantity in a pack-size string) }\n` +
            `- lenses[]: 5-7 of { id (slug), lens (label), system (analyst prompt naming the SPECIFIC sources to read), queries[] (3-4 concrete web queries already mentioning "${brief.category}"${brief.geography ? ` and "${brief.geography}"` : ""}) }\n` +
            `Return ONLY the JSON object.`,
        },
      ],
    });
    const parsed = ResearchPlanSchema.parse({
      category: brief.category,
      geography: brief.geography ?? "",
      currency: brief.currency ?? "USD",
      retailers: raw.retailers ?? fallback.retailers,
      communities: raw.communities ?? fallback.communities,
      subtypes: raw.subtypes ?? [],
      unitOfMeasure: raw.unitOfMeasure ?? fallback.unitOfMeasure,
      lenses: raw.lenses ?? fallback.lenses,
    });
    // Guard: a degenerate plan (no lenses) is worse than the deterministic default.
    return parsed.lenses.length ? parsed : fallback;
  } catch (e) {
    console.error(`[plan] agent planning failed, using default plan: ${(e as Error).message}`);
    return fallback;
  }
}

export async function saveResearchPlan(plan: ResearchPlan, dir?: string): Promise<string> {
  const d = dir ?? `data/${slug(plan.category)}`;
  await mkdir(d, { recursive: true });
  const path = `${d}/plan.json`;
  await Bun.write(path, JSON.stringify(plan, null, 2));
  return path;
}

export async function loadResearchPlan(category: string, dir?: string): Promise<ResearchPlan | null> {
  const path = `${dir ?? `data/${slug(category)}`}/plan.json`;
  try {
    return ResearchPlanSchema.parse(await Bun.file(path).json());
  } catch {
    return null;
  }
}

/**
 * Mandatory INDEPENDENT lenses, always injected regardless of what the agent
 * planned. Source selection upstream dominates everything downstream (principle
 * 19), and the agent tends to over-index on marketing/SEO sources — so we force
 * genuine customer voice: community discussion, complaints, and independent
 * editorial. Queries are site-targeted to actually surface those domains.
 */
function mandatoryIndependentLenses(c: string, geo: string): ResearchLens[] {
  return [
    {
      id: "community-voice",
      lens: "Independent community discussion (Reddit/Quora/forums)",
      system:
        "You read REAL user discussion on Reddit, Quora, and forums. Surface verbatim " +
        "customer language — recommendations, holy-grail picks, and especially honest " +
        "gripes. Quote ACTUAL USERS, never brands, sellers, or marketing copy.",
      queries: [
        `${c} review site:reddit.com`,
        `${c} recommendations site:quora.com${g(geo)}`,
        `${c} honest review reddit${g(geo)}`,
        `${c} what actually works forum discussion${g(geo)}`,
      ],
    },
    {
      id: "complaints",
      lens: "Complaints & negative reviews",
      system:
        "You hunt DISSATISFACTION: 1-star reviews, 'doesn't work', irritation/allergy, " +
        "stickiness, wears off, returns/refunds. Quote the actual complaint language from " +
        "real buyers — this is the most important and most under-surfaced signal.",
      queries: [
        `${c} 1 star review complaint${g(geo)}`,
        `${c} "doesn't work" OR disappointed review`,
        `${c} irritation OR allergic reaction review${g(geo)}`,
        `${c} "waste of money" OR returned review`,
      ],
    },
    {
      id: "editorial-independent",
      lens: "Independent editorial & expert reviews",
      system:
        "You read INDEPENDENT editorial reviews and dermatologist/expert guidance — NOT " +
        "brand-owned blogs and NOT sponsored 'best of' listicles. Surface candid expert " +
        "criteria and honest pros/cons.",
      queries: [
        `${c} dermatologist review${g(geo)}`,
        `${c} independent review not sponsored${g(geo)}`,
        `best ${c}${g(geo)} expert buying guide tested`,
      ],
    },
  ];
}

/** Inject mandatory independent lenses (dedup by id) into any plan. */
function ensureIndependentLenses(plan: ResearchPlan): ResearchPlan {
  const have = new Set(plan.lenses.map((l) => l.id));
  const add = mandatoryIndependentLenses(plan.category, plan.geography).filter((l) => !have.has(l.id));
  return add.length ? { ...plan, lenses: [...plan.lenses, ...add] } : plan;
}

/**
 * Resolve the plan for a harvest: prefer a persisted plan, else derive one via
 * the agent and persist it, else fall back to the deterministic default. The
 * mandatory independent lenses are injected last, so customer-voice sourcing is
 * guaranteed even for an old cached plan.
 */
export async function resolvePlan(
  brief: PlanBrief,
  opts: { mode?: "auto" | "default"; llm?: LLMClient } = {},
): Promise<ResearchPlan> {
  if (opts.mode === "default") return ensureIndependentLenses(defaultPlan(brief));
  const existing = await loadResearchPlan(brief.category);
  if (existing) return ensureIndependentLenses(existing);
  const plan = await buildResearchPlan(brief, opts.llm);
  await saveResearchPlan(plan).catch(() => {});
  return ensureIndependentLenses(plan);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
