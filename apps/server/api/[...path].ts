// Vercel serverless entry for the board relay.
//
// Vercel serves this file for every /api/* request. Its req/res are Node's
// IncomingMessage/ServerResponse, which is exactly what the shared `handle`
// speaks, so we just normalise the path and hand off. Importing `index.ts` does
// NOT start a listener: the .listen() there is guarded to run only when the file
// is executed directly (local dev / a persistent host).
//
// Deploy note: set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN on this project so the
// board persists (serverless has no durable disk). Point the client's
// VITE_BOARD_URL at "<this-deployment-origin>/api".

import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "../src/index.ts";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // Strip the /api mount prefix so the router matches its clean /board/:id and
  // /health routes. Harmless if the prefix is already gone (the regex just no-ops).
  const raw = req.url ?? "/";
  req.url = raw.replace(/^\/api(?=\/|$|\?)/, "") || "/";
  await handle(req, res);
}
