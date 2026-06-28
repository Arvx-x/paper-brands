function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const NOTIFY_TEXT = /notify|waitlist|join|launch|sign ?up|early access/i;

const TRACK_SCRIPT = `<script>
function PB_TRACK(){ /* operator integration point */ }
function pbNotify(){ PB_TRACK("notify", document.getElementById("notify-cta").dataset); var ok=document.getElementById("notify-ok"); if(ok) ok.style.display="block"; }
</script>`;

function canonicalCta(conceptId: string, experimentId?: string): string {
  const exp = experimentId ? ` data-experiment-id="${esc(experimentId)}"` : "";
  return `<div style="text-align:center;margin:32px 0">
<button id="notify-cta" data-cta="notify" data-concept-id="${esc(conceptId)}"${exp} onclick="pbNotify()" style="background:#171411;color:#fff;border:0;border-radius:999px;padding:14px 26px;font-size:16px;cursor:pointer">Notify me at launch</button>
<p id="notify-ok" style="display:none;margin-top:12px;color:#15803d;font-weight:600">You're on the list \u2705</p>
</div>`;
}

/** Deterministically guarantee a single countable notify CTA + PB_TRACK script. Idempotent. */
export function injectNotifyCta(
  html: string,
  ids: { conceptId: string; experimentId?: string },
): { html: string; mode: "found-and-tagged" | "inserted" } {
  let out = html;
  let mode: "found-and-tagged" | "inserted";

  if (out.includes('id="notify-cta"')) {
    // Already has the element — patch missing data attrs if needed, then fall through to script.
    if (!out.includes('data-concept-id=')) {
      const exp = ids.experimentId ? ` data-experiment-id="${esc(ids.experimentId)}"` : "";
      out = out.replace(/(<[^>]*id="notify-cta"[^>]*)(>)/i,
        `$1 data-cta="notify" data-concept-id="${esc(ids.conceptId)}"${exp} onclick="pbNotify()"$2`);
    }
    mode = "found-and-tagged";
  } else {
    // Try to find a notify-ish <button> or <a> by its inner text and tag it.
    // Use a two-pass approach: find candidates by simple tag boundary, check inner text.
    const tagRe = /<(button|a)\b[^]*?<\/\1>/gi;
    let tagged = false;
    out = out.replace(tagRe, (full, tag) => {
      if (tagged) return full;
      // Extract inner text (strip tags) to check against NOTIFY_TEXT
      const innerText = full.replace(/<[^>]+>/g, "");
      if (!NOTIFY_TEXT.test(innerText)) return full;
      tagged = true;
      const exp = ids.experimentId ? ` data-experiment-id="${esc(ids.experimentId)}"` : "";
      // Inject attrs into the opening tag
      return full.replace(
        new RegExp(`^<${tag}\\b`, "i"),
        `<${tag} id="notify-cta" data-cta="notify" data-concept-id="${esc(ids.conceptId)}"${exp} onclick="pbNotify()"`,
      );
    });
    if (tagged) {
      mode = "found-and-tagged";
      if (!out.includes('id="notify-ok"')) {
        out = insertBeforeBodyEnd(out, `<p id="notify-ok" style="display:none">You're on the list \u2705</p>`);
      }
    } else {
      out = insertBeforeBodyEnd(out, canonicalCta(ids.conceptId, ids.experimentId));
      mode = "inserted";
    }
  }

  // ensure tracking script exactly once
  if (!out.includes("function pbNotify")) {
    out = insertBeforeBodyEnd(out, TRACK_SCRIPT);
  }
  return { html: out, mode };
}

function insertBeforeBodyEnd(html: string, snippet: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  return html + "\n" + snippet;
}
