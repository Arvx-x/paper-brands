import { resolve, sep } from "node:path";
import { RunBroadcaster, type Writer } from "./events.ts";
import { runFoundryPipeline as realRunFoundryPipeline } from "./pipeline.ts";

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
      try { const body = (await req.json()) as any; category = body.category ?? category; cohortSize = Number(body.cohortSize ?? cohortSize) || 80; } catch { /* defaults */ }
      broadcaster.setRunning(category);
      runFoundryPipeline(category, (e) => broadcaster.emit(e), {}, cohortSize)
        .then(() => broadcaster.setStatus("complete"))
        .catch((e) => {
          broadcaster.emit({ type: "run-error", message: (e as Error).message });
          broadcaster.setStatus("error");
        });
      return Response.json({ started: true }, { status: 202 });
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
          req.signal.addEventListener("abort", () => broadcaster.unsubscribe(w));
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
  const server = Bun.serve({ port, fetch: handler });
  console.error(`[server] playground on http://localhost:${server.port}`);
  return { port: server.port ?? port, stop: () => server.stop(true) };
}
