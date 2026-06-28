import { test, expect } from "bun:test";
import { injectNotifyCta } from "./cta.ts";

const ids = { conceptId: "C1", experimentId: "exp1" };

function count(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

test("tags an existing waitlist button (found-and-tagged), single #notify-cta", () => {
  const html = `<html><body><h1>Brand</h1><button>Join the waitlist</button></body></html>`;
  const { html: out, mode } = injectNotifyCta(html, ids);
  expect(mode).toBe("found-and-tagged");
  expect(count(out, /id="notify-cta"/g)).toBe(1);
  expect(out).toContain('data-concept-id="C1"');
  expect(out).toContain('data-experiment-id="exp1"');
});

test("inserts canonical CTA when no notify-ish button exists", () => {
  const html = `<html><body><h1>Brand</h1><p>copy</p></body></html>`;
  const { html: out, mode } = injectNotifyCta(html, ids);
  expect(mode).toBe("inserted");
  expect(count(out, /id="notify-cta"/g)).toBe(1);
  expect(out).toContain('data-concept-id="C1"');
});

test("PB_TRACK script always present, not duplicated", () => {
  const html = `<html><body><button>Notify me</button></body></html>`;
  const { html: out } = injectNotifyCta(html, ids);
  expect(count(out, /function pbNotify/g)).toBe(1);
  expect(count(out, /PB_TRACK/g)).toBeGreaterThanOrEqual(1);
});

test("idempotent: injecting twice yields one CTA and one script", () => {
  const html = `<html><body><p>x</p></body></html>`;
  const once = injectNotifyCta(html, ids).html;
  const twice = injectNotifyCta(once, ids).html;
  expect(count(twice, /id="notify-cta"/g)).toBe(1);
  expect(count(twice, /function pbNotify/g)).toBe(1);
});

test("escapes injected ids", () => {
  const { html: out } = injectNotifyCta(`<html><body><p>x</p></body></html>`, { conceptId: '"><script>', experimentId: "e" });
  expect(out).not.toContain('"><script>');
  expect(out).toContain("&quot;&gt;&lt;script&gt;");
});

test("malformed/empty html -> inserts, no throw", () => {
  const { html: out, mode } = injectNotifyCta("not really html", ids);
  expect(mode).toBe("inserted");
  expect(out).toContain('id="notify-cta"');
});
