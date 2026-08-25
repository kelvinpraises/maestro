import { db } from "./client.js";

export interface BoardRecord {
  version: number;
  blob: string; // base64url AES-GCM ciphertext, opaque to us
}

// The single table this relay needs. Idempotent, so it is safe to run on boot.
export async function migrate(): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS boards (
       family_id TEXT PRIMARY KEY,
       version   INTEGER NOT NULL,
       blob      TEXT    NOT NULL
     )`,
  );
}

export async function getBoard(familyId: string): Promise<BoardRecord | null> {
  const rs = await db.execute({
    sql: "SELECT version, blob FROM boards WHERE family_id = ?",
    args: [familyId],
  });
  const row = rs.rows[0];
  if (!row) return null;
  return { version: Number(row.version), blob: String(row.blob) };
}

export async function countBoards(): Promise<number> {
  const rs = await db.execute("SELECT COUNT(*) AS n FROM boards");
  return Number(rs.rows[0]?.n ?? 0);
}

export type PutResult =
  | { ok: true; record: BoardRecord }
  | { ok: false; current: BoardRecord | null };

// Optimistic-concurrency write in a SINGLE statement, so two racing PUTs for the
// same family can never both win. The write lands only when `version` is exactly
// the next one: 1 for a brand-new family, current+1 for an existing one.
//
// The SELECT lets the candidate row through when the family is new AND version is
// 1, OR when the family already exists (in which case the ON CONFLICT DO UPDATE
// takes over and its own WHERE enforces current+1). A new family with the wrong
// version produces no row, so nothing is inserted. rowsAffected tells us whether
// it landed; on a miss we hand back the CURRENT record so the caller can re-pull,
// re-merge, and retry (a 409).
export async function putBoard(
  familyId: string,
  version: number,
  blob: string,
): Promise<PutResult> {
  const rs = await db.execute({
    sql: `INSERT INTO boards (family_id, version, blob)
          SELECT :id, :version, :blob
          WHERE :version = 1
             OR EXISTS (SELECT 1 FROM boards WHERE family_id = :id)
          ON CONFLICT(family_id) DO UPDATE
            SET version = excluded.version, blob = excluded.blob
            WHERE boards.version = excluded.version - 1`,
    args: { id: familyId, version, blob },
  });
  if (rs.rowsAffected === 1) return { ok: true, record: { version, blob } };
  return { ok: false, current: await getBoard(familyId) };
}
