import { test, expect, afterAll } from "bun:test";
import { startServer } from "./server.ts";
import { buildTemplateWorkbook } from "../userdata/template.ts";

const srv = startServer(0);
const base = `http://localhost:${srv.port}`;
afterAll(() => srv.stop());

test("GET /api/template streams an xlsx attachment", async () => {
  const res = await fetch(`${base}/api/template`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("spreadsheetml");
  const buf = await res.arrayBuffer();
  expect(buf.byteLength).toBeGreaterThan(1000);
});

test("POST /api/parse returns a summary for an uploaded workbook", async () => {
  const fd = new FormData();
  fd.append("file", new Blob([buildTemplateWorkbook()]), "intel.xlsx");
  const res = await fetch(`${base}/api/parse`, { method: "POST", body: fd });
  expect(res.status).toBe(200);
  const json = (await res.json()) as any;
  expect(json.summary.voices).toBeGreaterThanOrEqual(1);
  expect(Array.isArray(json.warnings)).toBe(true);
});

test("POST /api/parse rejects a non-workbook with 400", async () => {
  const fd = new FormData();
  fd.append("file", new Blob([new TextEncoder().encode("nope")]), "x.xlsx");
  const res = await fetch(`${base}/api/parse`, { method: "POST", body: fd });
  expect(res.status).toBe(400);
});
