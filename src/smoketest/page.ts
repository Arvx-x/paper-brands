import type { BrandConcept } from "../brand/types.ts";

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SCRIPT_OPEN = '<script type="text/javascript">';
const SCRIPT_CLOSE = "</" + "script>";
const JS_BLOCK = `
  // PB_TRACK: no-op stub. Wire to GA/Plausible/GTM to count notify clicks.
  function PB_TRACK(){ /* operator integration point */ }
  function pbNotify(){
    PB_TRACK("notify", document.getElementById("notify-cta").dataset);
    document.getElementById("notify-ok").style.display = "block";
  }
`;

export function renderPdpPage(
  concept: BrandConcept,
  opts: { experimentId?: string; currency?: string } = {},
): string {
  const currency = opts.currency ?? "INR";
  const price = (concept.priceMinor / 100).toLocaleString("en-IN");
  const claims = (concept.claims ?? []).filter((c) => c && c.trim());
  const claimsHtml = claims.length
    ? `<ul class="claims">${claims.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
    : "";
  const expComment = opts.experimentId ? `<!-- experiment:${esc(opts.experimentId)} -->` : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(concept.name)}</title>
<style>
  :root{--ink:#171411;--accent:#1d4ed8}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:#faf7f2}
  main{max-width:560px;margin:0 auto;padding:48px 24px}
  h1{font-size:34px;line-height:1.1;margin:0 0 8px}
  .tagline{font-size:18px;color:#6b6258;margin:0 0 24px}
  .lead{font-size:16px;line-height:1.5}
  .claims{padding-left:20px;line-height:1.7}
  .price{font-weight:600;margin:20px 0}
  button{background:var(--ink);color:#fff;border:0;border-radius:999px;padding:14px 26px;font-size:16px;cursor:pointer}
  .ok{display:none;margin-top:16px;color:#15803d;font-weight:600}
</style></head>
<body>${expComment}
<main>
  <h1>${esc(concept.landingHeadline || concept.name)}</h1>
  <p class="tagline">${esc(concept.tagline)}</p>
  <p class="lead">${esc(concept.productPromise || concept.positioning)}</p>
  ${claimsHtml}
  <p class="price">${esc(concept.heroSku)} — ${esc(currency)} ${price}</p>
  <button id="notify-cta" data-cta="notify" data-concept-id="${esc(concept.id)}"${opts.experimentId ? ` data-experiment-id="${esc(opts.experimentId)}"` : ""} onclick="pbNotify()">Notify me at launch</button>
  <p class="ok" id="notify-ok">You're on the list ✅</p>
</main>
${SCRIPT_OPEN}${JS_BLOCK}${SCRIPT_CLOSE}
</body></html>`;
}
