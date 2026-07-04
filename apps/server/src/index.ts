// The Family Board relay — reborn tiny (see context/FAMILY-BOARD.md).
//
// One job: hold a single opaque, versioned blob per family and hand it back.
// No accounts, no auth — the `familyId` IS the capability (a random 128-bit value
// the parent minted), and the `blob` is AES-GCM ciphertext the client encrypted
// with the family key. The server can't read a byte of it, which is the whole
// point: the infrastructure never learns your family's business, exactly like the
// zk-rewards story on the money side.
//
//   GET  /board/:familyId  -> { version, blob }  (404 if we've never seen it)
//   PUT  /board/:familyId   { version, blob }     accepted only if version is
//                            exactly current+1, else 409 with the current record
//                            so the caller can re-pull, re-merge, and retry.
//
// Storage is SQLite via libSQL, so the SAME code runs on a plain file locally and
// on Turso when deployed serverless (Vercel). The HTTP layer stays dependency-free
// (Node's built-in http); the one dependency is the libSQL client in
// `infrastructure/database`.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  migrate,
  getBoard,
  putBoard,
  countBoards,
} from "./infrastructure/database/boards.ts";

// ── config ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 8787);
// A blob is a small encrypted JSON board — cap it so nobody parks a payload here.
const MAX_BLOB_BYTES = 256 * 1024; // ~256KB
// Whole-body cap (blob + a little JSON envelope). Reject early, before parsing.
const MAX_BODY_BYTES = MAX_BLOB_BYTES + 4 * 1024;
// The client dev server. CORS is scoped to it (plus a couple of localhost ports).
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173", // vite preview
]);

// ── helpers ──────────────────────────────────────────────────────────────────

/** A familyId is the URL-safe base64 capability the client minted. Validate its
 *  shape so a garbage path can't wedge the Map with junk keys. 16–64 chars. */
function isValidFamilyId(id: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(id);
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

/** Read the request body with a hard byte cap. On overflow we reject with a
 *  PAYLOAD_TOO_LARGE marker, but keep draining the socket (rather than destroying
 *  it) so the caller still receives our clean 413 response instead of a reset. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    let overflowed = false;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        overflowed = true;
        chunks.length = 0; // stop buffering; we're going to reject
        return;
      }
      if (!overflowed) chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflowed) reject(new Error("PAYLOAD_TOO_LARGE"));
      else resolvePromise(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

// ── request handling ──────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(req, res);

  // CORS preflight.
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const match = url.pathname.match(/^\/board\/([^/]+)$/);

  // A tiny liveness probe, handy for the demo dry-run.
  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, families: await countBoards() });
    return;
  }

  if (!match) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const familyId = decodeURIComponent(match[1]);
  if (!isValidFamilyId(familyId)) {
    sendJson(res, 400, { error: "bad_family_id" });
    return;
  }

  // ── GET: hand back the current record, or 404 if we've never seen it ─────────
  if (req.method === "GET") {
    const rec = await getBoard(familyId);
    if (!rec) {
      sendJson(res, 404, { error: "no_board" });
      return;
    }
    sendJson(res, 200, rec);
    return;
  }

  // ── PUT: accept only the exact next version; else 409 with the current one ───
  if (req.method === "PUT") {
    let bodyText: string;
    try {
      bodyText = await readBody(req);
    } catch (err) {
      if ((err as Error).message === "PAYLOAD_TOO_LARGE") {
        sendJson(res, 413, { error: "too_large" });
        return;
      }
      sendJson(res, 400, { error: "read_failed" });
      return;
    }

    let body: { version?: unknown; blob?: unknown };
    try {
      body = JSON.parse(bodyText);
    } catch {
      sendJson(res, 400, { error: "bad_json" });
      return;
    }

    const { version, blob } = body;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      sendJson(res, 400, { error: "bad_version" });
      return;
    }
    if (typeof blob !== "string" || blob.length === 0) {
      sendJson(res, 400, { error: "bad_blob" });
      return;
    }
    // Byte-cap the blob itself (base64url is ~1 byte/char) — reject an oversized
    // ciphertext even if the envelope squeaked under the body cap.
    if (Buffer.byteLength(blob, "utf-8") > MAX_BLOB_BYTES) {
      sendJson(res, 413, { error: "blob_too_large" });
      return;
    }

    const result = await putBoard(familyId, version, blob);
    if (!result.ok) {
      // Optimistic-concurrency clash: tell the caller the truth so it can
      // re-pull, re-merge, and retry with the right next version.
      sendJson(res, 409, {
        error: "version_conflict",
        current: result.current,
      });
      return;
    }
    sendJson(res, 200, result.record);
    return;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
}

// ── boot ──────────────────────────────────────────────────────────────────────

await migrate();
createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("[board] unhandled error", err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal" });
  });
}).listen(PORT, () => {
  console.log(`[board] family board relay listening on http://localhost:${PORT}`);
});
