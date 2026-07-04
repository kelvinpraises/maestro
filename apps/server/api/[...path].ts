// Vercel serverless entry for the board relay.
//
// Vercel serves this file for every /api/* request. Its req/res are Node's
// IncomingMessage/ServerResponse, which is exactly what the shared `handle`
// speaks, so we normalise the path and hand off. The router + DB client are
// imported lazily INSIDE the handler so that a load-time failure (a bad dep, a
// missing env, etc.) is caught and returned as JSON rather than an opaque
// FUNCTION_INVOCATION_FAILED.
//
// Deploy note: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN on this project so the
// board persists (serverless has no durable disk). Point the client's
// VITE_BOARD_URL at "<this-deployment-origin>/api".

import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const { handle } = await import("../src/index.js");
    // Strip the /api mount prefix so the router matches /board/:id and /health.
    const raw = req.url ?? "/";
    req.url = raw.replace(/^\/api(?=\/|$|\?)/, "") || "/";
    await handle(req, res);
  } catch (err) {
    const e = err as Error;
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "boot_failed",
          message: String(e?.message ?? e),
          stack: String(e?.stack ?? "").split("\n").slice(0, 6),
          hasTurso: !!process.env.TURSO_DATABASE_URL,
          hasToken: !!process.env.TURSO_AUTH_TOKEN,
        }),
      );
    }
  }
}
