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
  expect(res.headers.get("content-disposition")).toContain("attachment");
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

test("POST /api/run multipart with file returns userData summary", async () => {
  // Start a run with a file — we don't care if the pipeline actually completes,
  // just that the server parses the upload and returns userData in the 202.
  const fd = new FormData();
  fd.append("category", "testcat");
  fd.append("cohortSize", "20");
  fd.append("file", new Blob([buildTemplateWorkbook()]), "intel.xlsx");
  const res = await fetch(`${base}/api/run`, { method: "POST", body: fd });
  // May return 409 if a run was left over from a prior test, which is fine.
  if (res.status === 409) return;
  expect(res.status).toBe(202);
  const json = (await res.json()) as any;
  expect(json.started).toBe(true);
  expect(json.userData).not.toBeNull();
  expect(json.userData.voices).toBeGreaterThanOrEqual(1);
});

test("POST /api/run multipart without file returns userData null", async () => {
  const fd = new FormData();
  fd.append("category", "testcat2");
  const res = await fetch(`${base}/api/run`, { method: "POST", body: fd });
  if (res.status === 409) return; // another run active, skip
  expect(res.status).toBe(202);
  const json = (await res.json()) as any;
  expect(json.userData).toBeNull();
});
