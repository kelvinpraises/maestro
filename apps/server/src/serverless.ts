import type { IncomingMessage, ServerResponse } from "node:http";

// Adapt a Vercel serverless invocation to the shared router. The route files under
// api/ (api/health.ts, api/board/[id].ts) all delegate here so there is exactly one
// place that bridges the platform to our node:http `handle`.
//
// Why explicit route files instead of one api/[...path].ts catch-all: Vercel's
// zero-config catch-all matched the single-segment /api/health but 404'd the
// two-segment /api/board/:id before our function ever ran. Named route files route
// reliably.
//
// The router + DB client are imported lazily INSIDE serve() so a load-time failure
// (bad dep, missing env) is caught and returned as JSON rather than an opaque
// FUNCTION_INVOCATION_FAILED. Importing ./index.js does NOT start a listener — its
// .listen() is guarded to run only when the file is executed directly.
export async function serve(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const { handle } = await import("./index.js");
    // Strip the /api mount prefix so the router matches its clean /board/:id and
    // /health paths. Idempotent: if the prefix is already absent, nothing changes.
    req.url = (req.url ?? "/").replace(/^\/api(?=\/|$|\?)/, "") || "/";
    await handle(req, res);
  } catch (err) {
    const e = err as Error;
    console.error("[board] function error", e);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "function_failed",
          message: String(e?.message ?? e),
          stack: String(e?.stack ?? "").split("\n").slice(0, 6),
          hasTurso: !!process.env.TURSO_DATABASE_URL,
          hasToken: !!process.env.TURSO_AUTH_TOKEN,
        }),
      );
    }
  }
}
