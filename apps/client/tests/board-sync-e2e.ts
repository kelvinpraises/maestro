// Two-device sync proof against the LIVE relay (gate 4's mechanism).
//
// Simulates the parent device and the kid device as two independent Stellar
// keypairs talking to the running board server, exercising the exact
// encrypt→PUT→GET→decrypt→verify→merge path the client hook uses:
//
//   1. Parent seeds the board (v1): family header + chores, signed.
//   2. Kid pulls, adopts the chores, publishes its address + a kid-joined notice.
//   3. Parent pulls: sees the kid's address (allowance picker) + the join notice.
//   4. Kid marks a chore pending, pushes.
//   5. Parent pulls: the pending state is attributed to the kid (nod queue).
//
//   BOARD_URL=http://localhost:8787 npx tsx tests/board-sync-e2e.ts

import { Keypair } from "@stellar/stellar-sdk";
import {
  type Board,
  signSection,
  encryptBoard,
  decryptBoard,
  verifyBoard,
  generateFamilyKey,
  stateKey,
} from "../src/lib/board.ts";
import { randomCapability } from "../src/lib/family.ts";

const BASE = process.env.BOARD_URL ?? "http://localhost:8787";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

async function get(boardId: string): Promise<{ version: number; blob: string } | null> {
  const res = await fetch(`${BASE}/board/${boardId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${res.status}`);
  return res.json();
}
async function put(boardId: string, version: number, blob: string) {
  const res = await fetch(`${BASE}/board/${boardId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, blob }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function main() {
  const parent = Keypair.random();
  const kid = Keypair.random();
  const KID = "Zuri";
  const boardId = randomCapability();
  const familyKey = await generateFamilyKey();

  console.log(`\nboard ${boardId} @ ${BASE}`);

  // ── 1) parent seeds v1 ──────────────────────────────────────────────────────
  console.log("\n[1] parent seeds the board (v1)");
  const seed: Board = {
    v: 1,
    family: signSection({ name: "Team Okafor", parentAddress: parent.publicKey() }, parent),
    chores: signSection(
      [{ id: "c1", name: "Make the bed", emoji: "🛏️", rewardXlm: 0.5 }],
      parent,
    ),
    kids: {},
    states: {},
    notices: [],
  };
  const p1 = await put(boardId, 1, await encryptBoard(seed, familyKey));
  check("PUT v1 accepted (200)", p1.status === 200);

  // ── 2) kid pulls, adopts chores, publishes address + join notice (v2) ───────
  console.log("\n[2] kid joins: adopt chores, publish address + kid-joined notice");
  const k_rec = await get(boardId);
  const k_board = await decryptBoard(k_rec!.blob, familyKey);
  const k_view = verifyBoard(k_board, parent.publicKey());
  check("kid sees the parent's chore", k_view.chores[0]?.name === "Make the bed");

  k_board.kids[KID] = signSection({ address: kid.publicKey(), joinedAt: Date.now() }, kid);
  k_board.notices.push(
    signSection(
      { id: `join-${KID}`, at: Date.now(), kind: "kid-joined" as const, kidName: KID, author: kid.publicKey() },
      kid,
    ),
  );
  const p2 = await put(boardId, 2, await encryptBoard(k_board, familyKey));
  check("PUT v2 accepted (kid published)", p2.status === 200);

  // ── 3) parent pulls: kid address + join notice visible ──────────────────────
  console.log("\n[3] parent pulls: kid address + join notice appear");
  const pr = await get(boardId);
  const p_board = await decryptBoard(pr!.blob, familyKey);
  const p_view = verifyBoard(p_board, parent.publicKey());
  check("parent sees kid's published address (feeds allowance picker)",
    p_view.kids[KID]?.address === kid.publicKey());
  check("parent sees kid-joined notice (family feed)",
    p_view.notices.some((n) => n.kind === "kid-joined" && n.kidName === KID));

  // ── 4) kid marks a chore pending (v3) ───────────────────────────────────────
  console.log("\n[4] kid marks a chore pending");
  const k_rec2 = await get(boardId);
  const k_board2 = await decryptBoard(k_rec2!.blob, familyKey);
  k_board2.states[stateKey("c1", KID)] = signSection(
    { choreId: "c1", kidName: KID, entry: { state: "pending" as const, at: Date.now() } },
    kid,
  );
  const p3 = await put(boardId, 3, await encryptBoard(k_board2, familyKey));
  check("PUT v3 accepted (kid marked pending)", p3.status === 200);

  // ── 5) parent pulls: pending attributed to the kid (nod queue) ──────────────
  console.log("\n[5] parent pulls: pending is attributed to the kid (nod queue)");
  const pr2 = await get(boardId);
  const p_board2 = await decryptBoard(pr2!.blob, familyKey);
  const p_view2 = verifyBoard(p_board2, parent.publicKey());
  check("parent's nod queue sees Zuri's pending — NO manual transfer",
    p_view2.states["c1"]?.[KID]?.state === "pending");

  // ── 6) stale write conflicts (409), server tells the truth ──────────────────
  console.log("\n[6] optimistic concurrency: a stale PUT 409s with the current record");
  const stale = await put(boardId, 3, await encryptBoard(p_board2, familyKey));
  check("stale PUT v3 rejected (409)", stale.status === 409);
  check("409 carries the current version (3) for re-merge",
    (stale.body as { current?: { version?: number } }).current?.version === 3);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
