/**
 * Craft standards — the difference between "AI made an ad" and "an elite studio
 * made this". Distilled from real art-direction critique of early output. Shared
 * by the renderer (positive direction + negatives), the council (how to spec),
 * and the jury (what to penalize), so the bar is enforced everywhere at once.
 */

/** Amateur tells that immediately cheapen a creative — penalize and avoid these. */
export const CRAFT_ANTIPATTERNS = [
  "Frankenstein compositing: subject, hands, and product looking pasted from separate sources with no shared light",
  "physically impossible staging (e.g. a hand awkwardly jammed under a chin) instead of a natural, believable pose",
  "inconsistent depth of field — a hyper-sharp product against an otherwise soft-focus scene",
  "gratuitous textures that don't fit the scene (water droplets on a matte product in a dry, soft setting)",
  "readability crutches: a white/dark gradient, scrim, or vignette slapped behind text to force legibility",
  "floating UI/CTA elements parked in dead space with no alignment to the rest of the layout",
  "generic default typography with no intentional tracking, leading, or weight contrast",
  "flat hierarchy where every text element shouts at the same volume",
  "cliché category copy that occupies premium space while saying nothing distinct",
  "plastic/waxy skin, warped hands or ears, melted or misspelled text, uncanny faces",
];

/** Positive craft principles every render must satisfy. */
export const CRAFT_DIRECTIVES = [
  "ONE unifying light source — subject, hands, and product share the same direction, colour temperature, and softness",
  "consistent depth of field across the whole frame; the product belongs to the same optical plane as everything else",
  "believable, relaxed staging and real human ergonomics — never a posed-prop look",
  "a deliberate compositional grid: text blocks and CTA align to shared margins/axes, not arbitrary placement",
  "solve text legibility through composition, contrast, and negative space — NEVER a gradient scrim",
  "typography with a point of view: intentional tracking, leading, scale jumps, and weight contrast that build a clear hierarchy (one dominant element)",
  "distinct, specific copy in the brand's voice — no recycled category tropes",
  "aggressively stripped back: remove every element that isn't earning its place; let negative space do the work",
];

/** Overused beauty/D2C copy tropes to avoid (extend per category as needed). */
export const CLICHE_COPY = [
  "Radiance, Reimagined",
  "Glow from within",
  "Skincare, Reimagined",
  "Effortless beauty",
  "Your skin but better",
  "Unlock your glow",
  "Beauty redefined",
  "Elevate your routine",
];

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

/**
 * ONE concise positive craft line for the IMAGE prompt. Image models respond to
 * tight, vivid, positive direction — not a 20-bullet compliance doc (that bloats
 * the prompt and, with negatives, can summon the very artifacts named). The full
 * lists live in the jury + council reasoning where they actually work.
 */
export function craftLineForPrompt(): string {
  return (
    `Craft: one unified soft light source across the whole frame, a single consistent depth of field, ` +
    `flattering and aspirational framing, a clean grid composition with generous negative space, and ` +
    `typography with real hierarchy whose legibility comes from contrast — never a gradient scrim. ` +
    `Expensive, minimal, magazine-grade, photorealistic.`
  );
}

/** One concise negative clause for the image prompt (folds the anti-patterns). */
export const SHORT_NEGATIVE =
  "AI artifacts, plastic or waxy skin, warped hands, extra fingers, melted or misspelled text, " +
  "obvious compositing, mismatched lighting, gradient text scrims, floating UI elements, " +
  "cluttered busy layouts, unflattering extreme macro skin crops, generic stock-photo look";

/** Block injected into the jury rubric. */
export function craftStandardsForJury(): string {
  return (
    `Penalize HARD any of these amateur tells (each should pull visualQuality/conversion down sharply):\n` +
    `${bullets(CRAFT_ANTIPATTERNS)}\n` +
    `Reward only when the craft principles are genuinely met: unified lighting, consistent depth of field, ` +
    `grid-aligned layout, legibility solved by composition (no scrims), typography with real hierarchy, and distinct copy.`
  );
}

/** Block injected into the copy/spec stage. */
export function craftStandardsForSpec(): string {
  return (
    `Hold to elite craft standards:\n${bullets(CRAFT_DIRECTIVES)}\n` +
    `Banned clichés (do not use or paraphrase): ${CLICHE_COPY.join("; ")}.`
  );
}
