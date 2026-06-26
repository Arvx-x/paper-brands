/**
 * The research team. Each analyst owns a lens, with a tailored system prompt
 * and a query plan focused on its sources. They run in parallel over OpenAI
 * web search; their findings are merged into a multi-lens corpus.
 */
export interface Analyst {
  id: string;
  lens: string;
  system: string;
  /** Build the analyst's queries for a given category + geography. */
  queries: (category: string, geo: string) => string[];
}

const g = (geo: string) => (geo ? ` in ${geo}` : "");

export const ANALYSTS: Analyst[] = [
  {
    id: "social-chatter",
    lens: "Community & forums (Reddit, Quora, forums)",
    system:
      "You are a social listening analyst focused on COMMUNITY chatter — Reddit " +
      "(r/IndianSkincareAddicts, r/SkincareAddiction), Quora, forums. Surface the " +
      "real language people use: recommendations, holy-grail products, recurring " +
      "complaints, and 'what should I buy' threads. Quote actual phrasing.",
    queries: (c, geo) => [
      `${c} reddit recommendations${g(geo)}`,
      `${c} holy grail OR favourite thread reddit`,
      `${c} complaints "doesn't work" forum OR reddit`,
      `what ${c} do people actually recommend${g(geo)}`,
    ],
  },
  {
    id: "social-media",
    lens: "Social media (X/Twitter, Instagram, TikTok)",
    system:
      "You are a social-media trend analyst focused on X/Twitter, Instagram, and " +
      "TikTok. Surface viral products, influencer/derm-influencer talking points, " +
      "trending claims and aesthetics, and what creates buzz or backlash. Note " +
      "hashtags, formats, and the emotional hooks that drive shares.",
    queries: (c, geo) => [
      `${c} viral tiktok OR instagram${g(geo)}`,
      `${c} trend twitter OR X 2024 2025`,
      `${c} influencer recommendation${g(geo)}`,
    ],
  },
  {
    id: "marketplace",
    lens: "Marketplaces (Amazon, Flipkart, Nykaa)",
    system:
      "You are a marketplace analyst reading Amazon, Flipkart, and Nykaa listings " +
      "and ratings. Surface best-sellers, star ratings, the most common 1-2 star " +
      "complaints, pack sizes, and how products are merchandised. Be specific about " +
      "what wins and loses on the shelf.",
    queries: (c, geo) => [
      `best selling ${c}${g(geo)} amazon flipkart nykaa`,
      `${c} 1 star reviews common complaints amazon`,
      `${c} bestseller ratings${g(geo)}`,
    ],
  },
  {
    id: "reviews",
    lens: "Editorial reviews & buying guides",
    system:
      "You are a review analyst reading editorial reviews, dermatologist articles, " +
      "and buying guides (Vogue, magazines, derm blogs). Surface expert-endorsed " +
      "criteria, ingredient guidance, what experts say to avoid, and how 'good' is " +
      "defined by credible voices.",
    queries: (c, geo) => [
      `${c} buying guide what to look for dermatologist`,
      `${c} ingredients to avoid expert${g(geo)}`,
      `best ${c} editorial review${g(geo)}`,
    ],
  },
  {
    id: "competitive",
    lens: "Competitive & brand landscape",
    system:
      "You are a competitive analyst mapping the brand landscape. Surface the major " +
      "players, their positioning, price tiers, hero claims, and where each is " +
      "strong or weak. Identify white space no incumbent owns well.",
    queries: (c, geo) => [
      `top ${c} brands${g(geo)} positioning`,
      `${c} premium vs budget brands${g(geo)}`,
      `${c} market white space unmet need${g(geo)}`,
    ],
  },
  {
    id: "trends",
    lens: "Demand & emerging trends",
    system:
      "You are a trend/demand analyst. Surface what is growing — emerging " +
      "ingredients, formats, claims, and consumer shifts — and seasonal or regional " +
      "demand patterns relevant to launching a new product now.",
    queries: (c, geo) => [
      `${c} emerging trends 2025${g(geo)}`,
      `${c} new ingredient OR format growing demand`,
      `${c} consumer shift${g(geo)}`,
    ],
  },
];
