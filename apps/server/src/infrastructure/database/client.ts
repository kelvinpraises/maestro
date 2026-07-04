import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// One libSQL client, configured by environment so the SAME code runs two ways:
//
//   • Local dev, or any host that keeps a process alive: a plain on-disk SQLite
//     file. Zero setup, fast, and it survives restarts.
//       (the default, or set DATABASE_URL=file:./data/boards.db)
//
//   • Vercel / serverless: Turso over the network. A serverless function has no
//     durable filesystem, so the board lives in Turso (libSQL in the cloud) and
//     every cold start just reconnects to the same data.
//       TURSO_DATABASE_URL=libsql://<db>.turso.io   TURSO_AUTH_TOKEN=<token>
//
// Turso wins when its URL is set; otherwise we fall back to the local file. The
// query code above this layer never knows which one it is talking to.

function resolveConfig(): { url: string; authToken?: string } {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (tursoUrl) {
    return { url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN };
  }

  let fileUrl =
    process.env.DATABASE_URL ??
    `file:${new URL("../../../data/boards.db", import.meta.url).pathname}`;
  if (!fileUrl.startsWith("file:")) fileUrl = `file:${fileUrl}`;

  // libSQL opens the file but will not create its parent directory, so make sure
  // it exists. Best-effort: createClient surfaces a real error if the path is bad.
  try {
    mkdirSync(dirname(fileUrl.slice("file:".length)), { recursive: true });
  } catch {
    /* ignore */
  }
  return { url: fileUrl };
}

export const db: Client = createClient(resolveConfig());
