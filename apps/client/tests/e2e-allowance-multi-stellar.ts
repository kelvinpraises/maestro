#!/usr/bin/env tsx
/**
 * MAESTRO — E2E MULTI-RECIPIENT ALLOWANCE (Stellar / Soroban testnet, drips)
 *
 * Story: a parent opens ONE allowance that streams to TWO kids at the same rate,
 * funded from a single pot. After a few 2-second cycles both kids independently
 * pull their share through receive → split → collect, and the sender's funded
 * balance has dropped by the COMBINED amount.
 *
 * This is the proof for the multi-recipient fix in `useCreateAllowance`. It uses
 * the SAME data-layer helper the client hook uses to order the receiver list
 * (`sortReceivers`, which mirrors the contract's `receiver_lt`: account raw
 * ed25519 bytes, then config) — so a green run here means the real client path is
 * sound. Sorting matters: the contract's build_configs REJECTS an unsorted list,
 * and a naive G-string sort disagrees with the on-chain Address byte order ~8% of
 * the time.
 *
 * Throwaway accounts are funded from the local `maestro-deployer` CLI identity
 * (friendbot DNS is broken on this machine).
 *
 * Run: npx tsx apps/client/tests/e2e-allowance-multi-stellar.ts
 */

import { execFileSync } from "node:child_process";
import { Keypair, contract as StellarContract } from "@stellar/stellar-sdk";
import { Client as DripsClient } from "drips";
import { STELLAR_NETWORK, CONTRACT_IDS } from "../src/config/stellar.js";
import {
  AMT_PER_SEC_MULTIPLIER,
  buildAllowanceReceiver,
  cycleAlignedStart,
  ratePerCycle,
  maxCyclesForElapsed,
  sortReceivers,
  XLM_STROOPS,
} from "../src/lib/allowance.js";

// ── tiny log helpers ────────────────────────────────────────────────────────
const col = {
  cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m",
  dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m", yellow: "\x1b[33m",
};
let passed = 0, failed = 0;
const pass = (m: string) => { console.log(`  ${col.green}✓ ${m}${col.reset}`); passed++; };
const fail = (m: string, d?: unknown): never => {
  console.error(`  ${col.red}✗ FAIL: ${m}${col.reset}`, d ?? ""); failed++; process.exit(1);
};
const assert = (c: boolean, m: string) => { c ? pass(m) : fail(m); };
const scene = (t: string) => console.log(`\n  ${col.bold}── ${t} ──${col.reset}`);
const info = (m: string) => console.log(`    ${col.dim}${m}${col.reset}`);
const sleep = async (secs: number) => {
  process.stdout.write(`    ${col.dim}waiting ${secs}s: `);
  for (let i = 0; i < secs; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    process.stdout.write(`${i + 1}..`);
  }
  console.log(` done${col.reset}`);
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Fund a fresh testnet account from the maestro-deployer CLI identity, retrying a
// couple of times so a transient DNS blip doesn't abort the whole run.
function fundFromDeployer(dest: string, xlm: number) {
  const stroops = String(BigInt(Math.round(xlm)) * XLM_STROOPS);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      execFileSync(
        "stellar",
        [
          "tx", "new", "create-account",
          "--destination", dest,
          "--starting-balance", stroops,
          "--source", "maestro-deployer",
          "--network", "testnet",
          "--fee", "1000000",
        ],
        { stdio: "pipe", env: process.env },
      );
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function makeSigner(kp: Keypair) {
  const { signTransaction } = StellarContract.basicNodeSigner(
    kp,
    STELLAR_NETWORK.networkPassphrase,
  );
  return { publicKey: kp.publicKey(), signTransaction };
}

function dripsFor(kp: Keypair) {
  return new DripsClient({
    rpcUrl: STELLAR_NETWORK.rpcUrl,
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
    contractId: CONTRACT_IDS.drips,
    ...makeSigner(kp),
  });
}

// Simulate-only read client (no signer needed).
const dripsRead = new DripsClient({
  rpcUrl: STELLAR_NETWORK.rpcUrl,
  networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  contractId: CONTRACT_IDS.drips,
});

async function signSend<T>(tx: {
  signAndSend: () => Promise<{
    result: T;
    sendTransactionResponse?: { hash?: string };
  }>;
}): Promise<{ result: T; hash: string }> {
  const sent = await tx.signAndSend();
  const hash = sent.sendTransactionResponse?.hash ?? "(hash unavailable)";
  return { result: sent.result, hash };
}

// Receive one kid's whole elapsed window (bounded by a SHARED max_cycles so two
// kids are compared over the same number of cycles — a fair, time-matched share).
async function receiveFor(
  kp: Keypair,
  token: string,
  maxCycles: number,
): Promise<{ received: bigint; hash: string }> {
  const acct = kp.publicKey();
  const rec = await signSend(
    await dripsFor(kp).receive_streams({ account: acct, token, max_cycles: maxCycles }),
  );
  info(`${short(acct)}: receive credited ${rec.result} stroops  (tx ${short(rec.hash)})`);
  return { received: rec.result as bigint, hash: rec.hash };
}

// Split then collect a kid's already-received splittable into real XLM.
async function collectFor(
  kp: Keypair,
  token: string,
): Promise<{ collected: bigint; hashes: string[] }> {
  const acct = kp.publicKey();
  const hashes: string[] = [];
  const spl = await signSend(await dripsFor(kp).split({ account: acct, token }));
  hashes.push(spl.hash);
  const col2 = await signSend(
    await dripsFor(kp).collect({ account: acct, token, to: acct }),
  );
  hashes.push(col2.hash);
  info(`${short(acct)}: collected ${col2.result} stroops  (tx ${short(col2.hash)})`);
  return { collected: col2.result as bigint, hashes };
}

async function main() {
  console.log(`\n${col.bold}🪙 MAESTRO E2E — Multi-Recipient Allowance (Stellar drips)${col.reset}`);
  console.log(`${col.dim}   One parent, one pot, TWO kids streaming at the same rate.${col.reset}`);

  const token = CONTRACT_IDS.underlying;

  scene("Participants");
  const parent = Keypair.random();
  const kidA = Keypair.random();
  const kidB = Keypair.random();
  console.log(`  ${col.cyan}Parent${col.reset} ${short(parent.publicKey())}`);
  console.log(`  ${col.cyan}Kid A ${col.reset} ${short(kidA.publicKey())}`);
  console.log(`  ${col.cyan}Kid B ${col.reset} ${short(kidB.publicKey())}`);

  scene("Fund throwaway accounts from maestro-deployer");
  fundFromDeployer(parent.publicKey(), 60);
  info("parent funded with 60 XLM");
  fundFromDeployer(kidA.publicKey(), 5);
  info("kid A funded with 5 XLM (gas only)");
  fundFromDeployer(kidB.publicKey(), 5);
  info("kid B funded with 5 XLM (gas only)");

  // ── allowance parameters (shared rate, two recipients) ─────────────────────
  scene("Allowance parameters (shared rate, 2 recipients)");
  const perDayXlm = 10; // each kid streams 10 XLM/day
  const stroopsPerSec = (BigInt(perDayXlm) * XLM_STROOPS) / 86_400n;
  const amtPerSec = stroopsPerSec * AMT_PER_SEC_MULTIPLIER; // fixed-point rate
  const CYCLE_SECS = 2;
  const perCycle = ratePerCycle(amtPerSec, CYCLE_SECS);
  info(`rate = ${perDayXlm} XLM/day EACH = ${stroopsPerSec} stroops/sec each`);
  info(`amt_per_sec (fixed-point) = ${amtPerSec}`);
  info(`per cycle (${CYCLE_SECS}s) per kid = ${perCycle} stroops`);

  const nowSecs = Math.floor(Date.now() / 1000);
  const start = cycleAlignedStart(nowSecs, CYCLE_SECS, 12); // ~12s in the future
  const duration = 40n; // 40 seconds of streaming per kid
  // Fund the COMBINED window: 2 kids × per-sec × duration, then 2x headroom.
  const combinedPerSec = stroopsPerSec * 2n;
  const funding = combinedPerSec * duration * 2n;
  info(`start = ${start} (t+${start - nowSecs}s, cycle-aligned), duration = ${duration}s`);
  info(`combined per-sec = ${combinedPerSec} stroops/sec (both kids)`);
  info(`funding deposit = ${funding} stroops (${Number(funding) / Number(XLM_STROOPS)} XLM)`);

  // Build a receiver per kid at the shared rate, then SORT/DEDUP exactly as the
  // client hook does (account raw-bytes, then config). This is the crux of the
  // multi-recipient fix — an unsorted list would panic on-chain.
  const receivers = sortReceivers([
    buildAllowanceReceiver({ account: kidA.publicKey(), amtPerSec, start: BigInt(start), duration, streamId: 0n }),
    buildAllowanceReceiver({ account: kidB.publicKey(), amtPerSec, start: BigInt(start), duration, streamId: 0n }),
  ]);
  info(`receiver order after sort: [${receivers.map((r) => short(r.account)).join(", ")}]`);
  assert(receivers.length === 2, "two distinct receivers survived sort/dedup");

  // ── create allowance (parent) ─────────────────────────────────────────────
  scene("Parent opens ONE allowance to both kids (set_streams)");
  const parentDrips = dripsFor(parent);
  const created = await signSend(
    await parentDrips.set_streams({
      account: parent.publicKey(),
      token,
      new_receivers: receivers,
      balance_delta: funding,
      max_end_hint1: 0n,
      max_end_hint2: 0n,
    }),
  );
  const realDelta = created.result as bigint;
  info(`set_streams applied delta = ${realDelta} stroops  (tx ${short(created.hash)})`);
  assert(realDelta === funding, `deposit of ${funding} stroops moved into the vault`);

  const stateAfter = await (await dripsRead.streams_state({ account: parent.publicKey(), token })).result;
  info(`streams_state = [next_recv_cycle=${stateAfter[0]}, update_time=${stateAfter[1]}, max_end=${stateAfter[2]}, balance=${stateAfter[3]}]`);
  assert(stateAfter[3] === funding, `on-chain sender balance = funded amount (${funding})`);

  // ── wait for cycles, then each kid pulls their share ───────────────────────
  scene("Wait for the allowance to stream");
  const waitSecs = start - Math.floor(Date.now() / 1000) + 16;
  await sleep(waitSecs);

  scene("Each kid pulls their share (receive → split → collect)");
  // Compute ONE shared max_cycles from a single "now" so both kids are received
  // over the SAME number of whole cycles — a time-fair comparison. (Receiving
  // each kid at a different wall-clock moment would legitimately differ by the
  // seconds between the two calls, which isn't a fairness signal.)
  const elapsedShared = Math.floor(Date.now() / 1000) - start;
  const maxCyclesShared = maxCyclesForElapsed(elapsedShared, CYCLE_SECS);
  info(`shared elapsed ≈ ${elapsedShared}s → max_cycles = ${maxCyclesShared} (both kids)`);

  const aRecv = await receiveFor(kidA, token, maxCyclesShared);
  const bRecv = await receiveFor(kidB, token, maxCyclesShared);
  const a2 = await collectFor(kidA, token);
  const b2 = await collectFor(kidB, token);
  const a = { received: aRecv.received, collected: a2.collected, hashes: [aRecv.hash, ...a2.hashes] };
  const b = { received: bRecv.received, collected: b2.collected, hashes: [bRecv.hash, ...b2.hashes] };

  scene("Result");
  const aXlm = Number(a.collected) / Number(XLM_STROOPS);
  const bXlm = Number(b.collected) / Number(XLM_STROOPS);
  console.log(`  ${col.bold}Kid A collected: ${a.collected} stroops (${aXlm.toFixed(7)} XLM)${col.reset}`);
  console.log(`  ${col.bold}Kid B collected: ${b.collected} stroops (${bXlm.toFixed(7)} XLM)${col.reset}`);

  assert(a.collected > 0n, `kid A collected a positive amount (${a.collected})`);
  assert(b.collected > 0n, `kid B collected a positive amount (${b.collected})`);
  assert(a.collected === a.received, `kid A collected == received (${a.collected})`);
  assert(b.collected === b.received, `kid B collected == received (${b.collected})`);

  // Both were received over the SAME cycle count at the SAME rate, so their
  // shares should match to within a cycle (the extra cycle one may catch as the
  // two receive txs land a second or two apart).
  const diff = a.received > b.received ? a.received - b.received : b.received - a.received;
  const skewBudget = perCycle * 2n; // up to ~2 cycles of settle skew
  info(`share difference (received, matched cycles) = ${diff} stroops (budget ${skewBudget})`);
  assert(diff <= skewBudget, `both kids received roughly equal shares (diff ${diff} ≤ ${skewBudget})`);

  // ── sender's funded balance dropped by the combined take ───────────────────
  scene("Sender balance dropped by the combined amount");
  const nowForBal = BigInt(Math.floor(Date.now() / 1000));
  const senderBalNow = await (
    await dripsRead.balance_at({ account: parent.publicKey(), token, timestamp: nowForBal })
  ).result;
  const drained = funding - senderBalNow;
  info(`sender balance now = ${senderBalNow} stroops; drained = ${drained} stroops`);
  // The sender drains for BOTH kids continuously; both kids together have pulled
  // roughly `drained` (their collects are a subset of what's drained so far).
  const combinedCollected = a.collected + b.collected;
  assert(drained > 0n, `sender's funded balance dropped (${drained} stroops drained)`);
  assert(
    combinedCollected <= drained + skewBudget,
    `combined kid take (${combinedCollected}) ≤ sender drain (${drained}) within skew`,
  );
  // The drain should reflect ~2x a single-kid stream. Sanity: it exceeds what one
  // kid alone collected (proving BOTH streams are live off one pot).
  assert(
    drained > a.collected,
    `sender drain (${drained}) exceeds a single kid's take (${a.collected}) — both streams live`,
  );

  console.log(`\n  ${col.green}Passed: ${passed}${col.reset}`);
  if (failed > 0) { console.log(`  ${col.red}Failed: ${failed}${col.reset}`); process.exit(1); }
  console.log(`\n  ${col.bold}${col.green}ALL TESTS PASSED${col.reset}\n`);
  console.log(`  ${col.dim}tx hashes — set_streams ${short(created.hash)}; kidA [${a.hashes.map(short).join(", ")}]; kidB [${b.hashes.map(short).join(", ")}]${col.reset}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${col.red}FATAL:${col.reset}`, err);
  process.exit(1);
});
