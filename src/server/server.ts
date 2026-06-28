import { resolve, sep } from "node:path";
import { RunBroadcaster, type Writer } from "./events.ts";
import { runFoundryPipeline as realRunFoundryPipeline } from "./pipeline.ts";
import { parseWorkbook } from "../userdata/parse.ts";
import { buildTemplateWorkbook } from "../userdata/template.ts";
import type { UserIntel } from "../userdata/types.ts";

export interface ServerDeps {
  runFoundryPipeline?: typeof realRunFoundryPipeline;
  outRoot?: string;
  uiRoot?: string;
}

export function makeHandler(deps: ServerDeps = {}) {
  const runFoundryPipeline = deps.runFoundryPipeline ?? realRunFoundryPipeline;
  const outRoot = resolve(deps.outRoot ?? "out");
  const uiRoot = resolve(deps.uiRoot ?? "public");
  const broadcaster = new RunBroadcaster();

  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Path traversal guard: Bun normalises '..' at Request construction time, so
    // /out/../../etc/passwd becomes /etc/passwd.  Any multi-segment path that does
    // not start with a known route prefix is the result of an escaped traversal and
    // must be rejected with 403 rather than silently 404'd.
    const segments = path.split("/").filter(Boolean);
    if (
      segments.length > 1 &&
      !path.startsWith("/api/") &&
      !path.startsWith("/out/")
    ) {
      return new Response("forbidden", { status: 403 });
    }

    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      const f = Bun.file(resolve(uiRoot, "index.html"));
      if (await f.exists()) return new Response(f, { headers: { "content-type": "text/html" } });
      return new Response("UI not built", { status: 404 });
    }

    if (req.method === "GET" && path === "/viewstate.js") {
      const built = await Bun.build({ entrypoints: [resolve("src/server/viewstate.ts")], target: "browser" });
      const js = built.success ? await built.outputs[0]?.text() : undefined;
      if (js) return new Response(js, { headers: { "content-type": "text/javascript" } });
      return new Response("// viewstate build failed", { status: 500 });
    }

    if (req.method === "POST" && path === "/api/run") {
      const snap = broadcaster.snapshot();
      if (snap.status === "running") {
        return Response.json({ error: "a run is already active" }, { status: 409 });
      }
      let category = "lipcare";
      let cohortSize = 80;
      let userIntel: UserIntel | undefined;
      const ctype = req.headers.get("content-type") ?? "";
      try {
        if (ctype.includes("multipart/form-data")) {
          const fd = await req.formData();
          category = String(fd.get("category") ?? category);
          cohortSize = Number(fd.get("cohortSize") ?? cohortSize) || 80;
          const file = fd.get("file");
          if (file instanceof Blob && file.size > 0) {
            userIntel = parseWorkbook(await file.arrayBuffer()).intel;
          }
        } else {
          const body = (await req.json()) as any;
          category = body.category ?? category;
          cohortSize = Number(body.cohortSize ?? cohortSize) || 80;
        }
      } catch (e) {
        return Response.json({ error: `bad request: ${(e as Error).message}` }, { status: 400 });
      }
      broadcaster.setRunning(category);
      runFoundryPipeline(category, (e) => broadcaster.emit(e), {}, cohortSize, userIntel)
        .then(() => broadcaster.setStatus("complete"))
        .catch((e) => {
          broadcaster.emit({ type: "run-error", message: (e as Error).message });
          broadcaster.setStatus("error");
        });
      return Response.json({ started: true, userData: userIntel?.summary ?? null }, { status: 202 });
    }

    if (req.method === "GET" && path === "/api/template") {
      const buf = buildTemplateWorkbook();
      return new Response(buf, { headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": 'attachment; filename="paper-brands-intel.xlsx"',
      } });
    }

    if (req.method === "POST" && path === "/api/parse") {
      try {
        const fd = await req.formData();
        const file = fd.get("file");
        if (!(file instanceof Blob)) return Response.json({ error: "no file" }, { status: 400 });
        const { intel, warnings } = parseWorkbook(await file.arrayBuffer());
        return Response.json({ summary: intel.summary, warnings });
      } catch (e) {
        return Response.json({ error: `not a readable workbook: ${(e as Error).message}` }, { status: 400 });
      }
    }

    if (req.method === "GET" && path === "/api/state") {
      return Response.json(broadcaster.snapshot());
    }

    if (req.method === "GET" && path === "/api/events") {
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const w: Writer = {
            write: (s) => controller.enqueue(enc.encode(s)),
            close: () => { try { controller.close(); } catch { /* */ } },
          };
          broadcaster.subscribe(w);
          // Keep-alive ping every 5s so the connection survives long LLM gaps.
          const ping = setInterval(() => {
            try { controller.enqueue(enc.encode(": ping\n\n")); } catch { clearInterval(ping); }
          }, 5000);
          req.signal.addEventListener("abort", () => { clearInterval(ping); broadcaster.unsubscribe(w); });
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    if (req.method === "GET" && path.startsWith("/out/")) {
      const suffix = path.slice("/out".length);
      const target = resolve(outRoot, "." + suffix);
      if (target !== outRoot && !target.startsWith(outRoot + sep)) {
        return new Response("forbidden", { status: 403 });
      }
      const file = Bun.file(target);
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      return new Response(file);
    }

    return new Response("not found", { status: 404 });
  };
}

export function startServer(port = 4317, deps: ServerDeps = {}): { port: number; stop: () => void } {
  const handler = makeHandler(deps);
  // idleTimeout: 0 disables Bun's 10s idle kill so SSE connections stay alive
  // during slow LLM calls between events.
  const server = Bun.serve({ port, fetch: handler, idleTimeout: 0 });
  console.error(`[server] playground on http://localhost:${server.port}`);
  return { port: server.port ?? port, stop: () => server.stop(true) };
}
