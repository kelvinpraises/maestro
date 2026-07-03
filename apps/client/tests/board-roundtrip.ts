// Gate 3 — board lib round-trip proof (run with tsx).
//
//   npx tsx tests/board-roundtrip.ts
//
// Proves: encrypt→decrypt round-trips; a tampered ciphertext fails closed; a
// signed section verifies; a forged section (wrong key) is rejected by the merge;
// and the parent-authoritative / per-kid / notice-author rules all hold.

import { Keypair } from "@stellar/stellar-sdk";
import {
  type Board,
  signSection,
  verifySection,
  encryptBoard,
  decryptBoard,
  verifyBoard,
  generateFamilyKey,
  stateKey,
} from "../src/lib/board.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

async function main() {
  const parent = Keypair.random();
  const zuri = Keypair.random();
  const kofi = Keypair.random();
  const stranger = Keypair.random(); // has the family key but is NOT the parent/kid

  // ── Build a board the honest way ────────────────────────────────────────────
  const board: Board = {
    v: 1,
    family: signSection({ name: "Team Okafor", parentAddress: parent.publicKey() }, parent),
    chores: signSection(
      [{ id: "c1", name: "Make the bed", emoji: "🛏️", rewardXlm: 0.5 }],
      parent,
    ),
    kids: {
      Zuri: signSection({ address: zuri.publicKey(), joinedAt: 1000 }, zuri),
    },
    states: {
      [stateKey("c1", "Zuri")]: signSection(
        { choreId: "c1", kidName: "Zuri", entry: { state: "pending" as const, at: 2000 } },
        zuri,
      ),
    },
    notices: [
      signSection(
        { id: "n1", at: 1000, kind: "kid-joined" as const, kidName: "Zuri", author: zuri.publicKey() },
        zuri,
      ),
    ],
  };

  // ── 1) signature verify (happy path) ────────────────────────────────────────
  console.log("\n[1] signed write verifies");
  check(
    "parent family section verifies against parentAddress",
    verifySection(board.family, parent.publicKey()) !== null,
  );
  check(
    "kid state section verifies against kid address",
    verifySection(board.states[stateKey("c1", "Zuri")], zuri.publicKey()) !== null,
  );

  // ── 2) forged write (wrong key) rejected ────────────────────────────────────
  console.log("\n[2] forged write (wrong key) rejected by merge");
  // A stranger (with the family key) forges Zuri's "done" AND a chore edit.
  const forged: Board = {
    ...board,
    // Stranger tries to rewrite the parent-owned chore list.
    chores: signSection(
      [{ id: "cX", name: "Give me all the XLM", emoji: "💸", rewardXlm: 99 }],
      stranger,
    ),
    states: {
      ...board.states,
      // Stranger forges a state entry claiming to be Zuri, signed with the wrong key.
      [stateKey("c1", "Zuri")]: {
        ...signSection(
          { choreId: "c1", kidName: "Zuri", entry: { state: "done" as const, at: 5000 } },
          stranger,
        ),
        // Lie about the signer to try to slip past — signature won't match this addr.
        signer: zuri.publicKey(),
      },
    },
  };
  check(
    "forged chores section fails verifySection(parent)",
    verifySection(forged.chores, parent.publicKey()) === null,
  );
  const forgedView = verifyBoard(forged, parent.publicKey());
  check(
    "merge drops forged chores (keeps none of the stranger's chore)",
    forgedView.chores.length === 0,
  );
  check(
    "merge drops forged Zuri state (signer lie fails signature)",
    forgedView.states["c1"] === undefined,
  );

  // ── 3) parent-authoritative + per-kid + notices honest merge ────────────────
  console.log("\n[3] honest board merges correctly");
  const view = verifyBoard(board, parent.publicKey());
  check("family name survives", view.family?.name === "Team Okafor");
  check("chore survives", view.chores[0]?.name === "Make the bed");
  check("kid Zuri present with address", view.kids.Zuri?.address === zuri.publicKey());
  check("Zuri state pending merged", view.states["c1"]?.["Zuri"]?.state === "pending");
  check("kid-joined notice survives", view.notices[0]?.kind === "kid-joined");

  // A kid whose address we don't know can't push a state (no key to verify).
  const orphanState: Board = {
    ...board,
    states: {
      ...board.states,
      [stateKey("c1", "Kofi")]: signSection(
        { choreId: "c1", kidName: "Kofi", entry: { state: "done" as const, at: 3000 } },
        kofi,
      ),
    },
  };
  const orphanView = verifyBoard(orphanState, parent.publicKey());
  check(
    "unknown-kid state dropped (no published address = untrusted)",
    orphanView.states["c1"]?.["Kofi"] === undefined,
  );
  // Once Kofi publishes his address, his state verifies.
  const kofiJoined: Board = {
    ...orphanState,
    kids: {
      ...orphanState.kids,
      Kofi: signSection({ address: kofi.publicKey(), joinedAt: 2500 }, kofi),
    },
  };
  const kofiView = verifyBoard(kofiJoined, parent.publicKey());
  check(
    "kid state trusted after the kid publishes their address (TOFU)",
    kofiView.states["c1"]?.["Kofi"]?.state === "done",
  );

  // ── 4) AES-GCM encrypt → decrypt round-trip ─────────────────────────────────
  console.log("\n[4] encrypt → decrypt round-trip");
  const key = await generateFamilyKey();
  const blob = await encryptBoard(board, key);
  const decrypted = await decryptBoard(blob, key);
  check("decrypted board equals original", JSON.stringify(decrypted) === JSON.stringify(board));

  // ── 5) tampered ciphertext fails closed ─────────────────────────────────────
  console.log("\n[5] tampered ciphertext fails closed");
  // Flip a character in the middle of the blob.
  const mid = Math.floor(blob.length / 2);
  const flipped =
    blob.slice(0, mid) + (blob[mid] === "A" ? "B" : "A") + blob.slice(mid + 1);
  let tamperThrew = false;
  try {
    await decryptBoard(flipped, key);
  } catch {
    tamperThrew = true;
  }
  check("tampered blob throws on decrypt (GCM auth-tag)", tamperThrew);

  // Wrong key also fails closed.
  const otherKey = await generateFamilyKey();
  let wrongKeyThrew = false;
  try {
    await decryptBoard(blob, otherKey);
  } catch {
    wrongKeyThrew = true;
  }
  check("wrong family key throws on decrypt", wrongKeyThrew);

  // ── summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
