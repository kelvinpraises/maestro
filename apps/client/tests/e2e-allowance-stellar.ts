#!/usr/bin/env tsx
/**
 * MAESTRO — E2E ALLOWANCE FLOW TEST (Stellar / Soroban testnet, drips contract)
 *
 * Story: a parent opens an allowance (native XLM) that streams to a kid. After a
 * few 2-second cycles elapse the kid pulls it through the receive → split →
 * collect pipeline and the collected XLM lands in their wallet.
 *
 * This exercises the SAME data-layer helpers the client hooks use
 * (`src/lib/allowance.ts`), so a green run here means the UI path is sound.
 *
 * Throwaway accounts are funded from the local `maestro-deployer` CLI identity
 * (friendbot DNS is broken on this machine):
 *   stellar tx new create-account --destination <G...> \
 *     --starting-balance <stroops> --source maestro-deployer --network testnet
 *
 * Run: npx tsx apps/client/tests/e2e-allowance-stellar.ts
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

// Fund a fresh testnet account from the maestro-deployer CLI identity.
function fundFromDeployer(dest: string, xlm: number) {
  const stroops = String(BigInt(Math.round(xlm)) * XLM_STROOPS);
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

async function signSend<T>(tx: { signAndSend: () => Promise<{ result: T }> }): Promise<T> {
  const sent = await tx.signAndSend();
  return sent.result;
}

async function main() {
  console.log(`\n${col.bold}🪙 MAESTRO E2E — Allowance Flow (Stellar drips)${col.reset}`);
  console.log(`${col.dim}   Parent opens an XLM allowance to a kid; kid receives → splits → collects.${col.reset}`);

  const token = CONTRACT_IDS.underlying;

  scene("Participants");
  const parent = Keypair.random();
  const kid = Keypair.random();
  console.log(`  ${col.cyan}Parent${col.reset} ${short(parent.publicKey())}`);
  console.log(`  ${col.cyan}Kid   ${col.reset} ${short(kid.publicKey())}`);

  scene("Fund throwaway accounts from maestro-deployer");
  fundFromDeployer(parent.publicKey(), 60);
  info("parent funded with 60 XLM");
  fundFromDeployer(kid.publicKey(), 5);
  info("kid funded with 5 XLM (gas only)");

  // ── allowance parameters ──────────────────────────────────────────────────
  // 10 XLM/day. Convert to stroops/sec, then to the contract's fixed-point
  // amt_per_sec, then fund with enough for the whole run.
  scene("Allowance parameters");
  const perDayXlm = 10;
  const stroopsPerSec = (BigInt(perDayXlm) * XLM_STROOPS) / 86_400n;
  const amtPerSec = stroopsPerSec * AMT_PER_SEC_MULTIPLIER; // fixed-point rate
  const CYCLE_SECS = 2;
  const perCycle = ratePerCycle(amtPerSec, CYCLE_SECS);
  info(`rate = ${perDayXlm} XLM/day = ${stroopsPerSec} stroops/sec`);
  info(`amt_per_sec (fixed-point) = ${amtPerSec}`);
  info(`per cycle (${CYCLE_SECS}s) = ${perCycle} stroops`);

  // Explicit future start on a cycle boundary + explicit duration (gotcha:
  // never rely on start==0 / duration==0 with 2s cycles + simulate/submit gap).
  const nowSecs = Math.floor(Date.now() / 1000);
  const start = cycleAlignedStart(nowSecs, CYCLE_SECS, 12); // ~12s in the future
  const duration = 40n; // 40 seconds of streaming
  const funding = stroopsPerSec * duration * 2n; // fund 2x the streamed window
  info(`start = ${start} (t+${start - nowSecs}s, cycle-aligned), duration = ${duration}s`);
  info(`funding deposit = ${funding} stroops (${Number(funding) / Number(XLM_STROOPS)} XLM)`);

  const receiver = buildAllowanceReceiver({
    account: kid.publicKey(),
    amtPerSec,
    start: BigInt(start),
    duration,
    streamId: 0n,
  });

  // ── create allowance (parent) ─────────────────────────────────────────────
  scene("Parent opens the allowance (set_streams)");
  const parentDrips = dripsFor(parent);
  const realDelta = await signSend(
    await parentDrips.set_streams({
      account: parent.publicKey(),
      token,
      new_receivers: [receiver],
      balance_delta: funding,
      max_end_hint1: 0n,
      max_end_hint2: 0n,
    }),
  );
  info(`set_streams applied delta = ${realDelta} stroops`);
  assert(realDelta === funding, `deposit of ${funding} stroops moved into the vault`);

  // Read back state via a simulate-only read.
  const state = await (await dripsRead.streams_state({ account: parent.publicKey(), token })).result;
  info(`streams_state = [next_recv_cycle=${state[0]}, update_time=${state[1]}, max_end=${state[2]}, balance=${state[3]}]`);
  assert(state[3] === funding, `on-chain sender balance = funded amount (${funding})`);

  // ── wait for cycles, then receive → split → collect (kid) ─────────────────
  scene("Wait for the allowance to stream");
  // Stream starts ~12s out and runs 40s. Wait past start + a few cycles so
  // there is a positive receivable amount, but stop well before duration ends.
  const waitSecs = start - Math.floor(Date.now() / 1000) + 16;
  await sleep(waitSecs);

  scene("Kid pulls the allowance through (receive → split → collect)");
  const kidDrips = dripsFor(kid);

  const elapsed = Math.floor(Date.now() / 1000) - start;
  const maxCycles = maxCyclesForElapsed(elapsed, CYCLE_SECS);
  info(`elapsed since start ≈ ${elapsed}s → max_cycles = ${maxCycles}`);

  const received = await signSend(
    await kidDrips.receive_streams({ account: kid.publicKey(), token, max_cycles: maxCycles }),
  );
  info(`receive_streams credited ${received} stroops to splittable`);
  assert(received > 0n, `received a positive amount (${received} stroops)`);

  const [collectableAfterSplit] = await signSend(
    await kidDrips.split({ account: kid.publicKey(), token }),
  );
  info(`split moved ${collectableAfterSplit} stroops to collectable (no sub-receivers)`);

  const collected = await signSend(
    await kidDrips.collect({ account: kid.publicKey(), token, to: kid.publicKey() }),
  );

  scene("Result");
  const collectedXlm = Number(collected) / Number(XLM_STROOPS);
  console.log(`  ${col.bold}Collected: ${collected} stroops (${collectedXlm.toFixed(7)} XLM)${col.reset}`);
  assert(collected > 0n, `kid collected a positive amount of real XLM (${collected} stroops)`);
  assert(collected === received, `collected (${collected}) == received (${received})`);

  console.log(`\n  ${col.green}Passed: ${passed}${col.reset}`);
  if (failed > 0) { console.log(`  ${col.red}Failed: ${failed}${col.reset}`); process.exit(1); }
  console.log(`\n  ${col.bold}${col.green}ALL TESTS PASSED${col.reset}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${col.red}FATAL:${col.reset}`, err);
  process.exit(1);
});
