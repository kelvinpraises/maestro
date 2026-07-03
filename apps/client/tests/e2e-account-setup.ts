#!/usr/bin/env tsx
/**
 * MAESTRO — E2E ACCOUNT BOOTSTRAP (the reward-claim root-cause fix)
 *
 * Proves the exact mechanism behind the fix in src/lib/account.ts: a kid's
 * freshly generated wallet does NOT exist on-chain, so it can't submit a claim
 * or receive a stream — until the PARENT (family bank) creates + funds it.
 *
 * Drives the REAL helper the app calls (ensureAccountFunded), then claims a
 * reward from the now-funded kid account, then collects a stream to it. The kid
 * is funded ONLY through the parent-funds-kid path — never from the CLI.
 *
 *   ACT 0  Fund ONLY the parent (family bank) from maestro-deployer.
 *   ACT 1  Kid wallet is fresh → accountExists(kid) === false, balance 0.
 *   ACT 2  Parent runs ensureAccountFunded({from:parent, to:kid}) → createAccount
 *          tx hash; accountExists(kid) === true; balance == 1 XLM.
 *   ACT 3  Idempotency: a second ensureAccountFunded → { kind:"exists" }, no tx.
 *   ACT 4  Kid funds a reward to itself (has XLM now) and CLAIMS it privately.
 *   ACT 5  Parent streams an allowance to the kid; kid collects real XLM.
 *
 * Run: npx tsx apps/client/tests/e2e-account-setup.ts
 */

import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Keypair,
  Horizon,
  contract as StellarContract,
} from "@stellar/stellar-sdk";
import { Client as Zwerc20Client } from "zwerc20";
import { Client as DripsClient } from "drips";
import { STELLAR_NETWORK, CONTRACT_IDS } from "../src/config/stellar.js";
import {
  deriveNote,
  freshSecret,
  rebuildTree,
  buildWitness,
  generateProof,
  type CircuitArtifacts,
} from "../src/lib/claims.js";
import {
  accountExists,
  ensureAccountFunded,
  DEFAULT_STARTING_XLM,
} from "../src/lib/account.js";
import {
  AMT_PER_SEC_MULTIPLIER,
  buildAllowanceReceiver,
  cycleAlignedStart,
  maxCyclesForElapsed,
  XLM_STROOPS,
} from "../src/lib/allowance.js";

// ── log helpers ──────────────────────────────────────────────────────────────
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
  for (let i = 0; i < secs; i++) { await new Promise((r) => setTimeout(r, 1000)); process.stdout.write(`${i + 1}..`); }
  console.log(` done${col.reset}`);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = path.resolve(__dirname, "../public/circuits");
const ARTIFACTS: CircuitArtifacts = {
  wasm: path.join(CIRCUITS_DIR, "remint.wasm"),
  zkey: path.join(CIRCUITS_DIR, "remint_final.zkey"),
};

function makeSigner(kp: Keypair) {
  const { signTransaction } = StellarContract.basicNodeSigner(kp, STELLAR_NETWORK.networkPassphrase);
  return { publicKey: kp.publicKey(), signTransaction };
}
function zwFor(kp: Keypair) {
  return new Zwerc20Client({ rpcUrl: STELLAR_NETWORK.rpcUrl, networkPassphrase: STELLAR_NETWORK.networkPassphrase, contractId: CONTRACT_IDS.zwerc20, ...makeSigner(kp) });
}
function dripsFor(kp: Keypair) {
  return new DripsClient({ rpcUrl: STELLAR_NETWORK.rpcUrl, networkPassphrase: STELLAR_NETWORK.networkPassphrase, contractId: CONTRACT_IDS.drips, ...makeSigner(kp) });
}
const zwRead = new Zwerc20Client({ rpcUrl: STELLAR_NETWORK.rpcUrl, networkPassphrase: STELLAR_NETWORK.networkPassphrase, contractId: CONTRACT_IDS.zwerc20 });

function fundFromDeployer(dest: string, xlm: number) {
  const stroops = String(BigInt(Math.round(xlm)) * XLM_STROOPS);
  execFileSync("stellar", [
    "tx", "new", "create-account",
    "--destination", dest, "--starting-balance", stroops,
    "--source", "maestro-deployer", "--network", "testnet", "--fee", "1000000",
  ], { stdio: "pipe", env: process.env });
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5, baseMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) { lastErr = e; if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * (i + 1))); }
  }
  throw lastErr;
}
async function xlmBalanceStroops(pubkey: string): Promise<bigint> {
  const horizon = new Horizon.Server(STELLAR_NETWORK.horizonUrl);
  try {
    const acct = await withRetry(() => horizon.loadAccount(pubkey));
    const native = acct.balances.find((b) => b.asset_type === "native");
    return native ? BigInt(Math.round(Number(native.balance) * Number(XLM_STROOPS))) : 0n;
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return 0n;
    throw e;
  }
}

async function main() {
  console.log(`\n${col.bold}🏦 MAESTRO E2E — Account Bootstrap (parent creates + funds the kid)${col.reset}`);
  console.log(`${col.dim}   The kid is funded ONLY via the app's parent-funds-kid path (no CLI kid funding).${col.reset}`);

  scene("Participants");
  const parent = Keypair.random();
  const kid = Keypair.random();
  console.log(`  ${col.cyan}Parent (bank)${col.reset} ${parent.publicKey()}`);
  console.log(`  ${col.cyan}Kid (fresh)  ${col.reset} ${kid.publicKey()}`);

  // ── ACT 0 — fund ONLY the parent ────────────────────────────────────────────
  scene("ACT 0 — Fund ONLY the parent (family bank) from maestro-deployer");
  fundFromDeployer(parent.publicKey(), 60);
  info("parent funded with 60 XLM; kid gets NOTHING from the CLI");

  // ── ACT 1 — the kid wallet does not exist yet ───────────────────────────────
  scene("ACT 1 — Kid wallet is fresh (unfunded, nonexistent)");
  const kidExistsBefore = await accountExists(kid.publicKey());
  const kidBalBefore = await xlmBalanceStroops(kid.publicKey());
  info(`accountExists(kid) = ${kidExistsBefore}`);
  info(`kid balance before = ${kidBalBefore} stroops (${Number(kidBalBefore) / Number(XLM_STROOPS)} XLM)`);
  assert(kidExistsBefore === false, "kid account does NOT exist on-chain before setup");
  assert(kidBalBefore === 0n, "kid balance is 0 / nonexistent before setup");

  // ── ACT 2 — parent brings the kid account into existence ────────────────────
  scene("ACT 2 — Parent runs ensureAccountFunded (createAccount from the bank)");
  const res = await ensureAccountFunded({ from: parent, to: kid.publicKey() });
  info(`ensureAccountFunded → ${JSON.stringify(res)}`);
  assert(res.kind === "created", "helper reports it CREATED the kid account");
  const createHash = res.kind === "created" ? res.hash : "";
  console.log(`  ${col.yellow}createAccount tx hash = ${createHash}${col.reset}`);

  const kidExistsAfter = await accountExists(kid.publicKey());
  const kidBalAfter = await xlmBalanceStroops(kid.publicKey());
  info(`accountExists(kid) = ${kidExistsAfter}`);
  info(`kid balance after = ${kidBalAfter} stroops (${Number(kidBalAfter) / Number(XLM_STROOPS)} XLM)`);
  assert(kidExistsAfter === true, "kid account EXISTS on-chain after setup");
  assert(kidBalAfter === BigInt(DEFAULT_STARTING_XLM) * XLM_STROOPS, `kid funded with exactly ${DEFAULT_STARTING_XLM} XLM starting balance`);

  // ── ACT 3 — idempotency ─────────────────────────────────────────────────────
  scene("ACT 3 — Idempotency: a second ensureAccountFunded is a no-op");
  // Fresh module state would fast-path via the local cache; force the on-chain
  // path by targeting the same address from a caller that hasn't cached it —
  // here the same process HAS cached it, so we assert the cheap no-op instead.
  const res2 = await ensureAccountFunded({ from: parent, to: kid.publicKey() });
  info(`second ensureAccountFunded → ${JSON.stringify(res2)}`);
  assert(res2.kind === "exists", "second call returns { kind: 'exists' } (no duplicate createAccount)");

  // ── ACT 4 — the kid, now funded, claims a private reward ────────────────────
  scene("ACT 4 — Kid (now a real account) funds + claims a private reward");
  const REWARD_STROOPS = 3_000_000n; // 0.3 XLM
  const secret = freshSecret();
  const note = deriveNote(secret, REWARD_STROOPS);
  // The kid itself deposits the reward (proving its account can now transact) —
  // in the app the parent deposits, but the decisive check is the CLAIM below.
  const kidZw = zwFor(kid);
  const depositTx = await kidZw.deposit({ from: kid.publicKey(), addr20: note.addr20, amount: REWARD_STROOPS });
  const leafIndex = (await depositTx.signAndSend()).result;
  info(`reward deposited by the kid account at leaf ${leafIndex}`);

  const tree = await rebuildTree(zwRead);
  const root = tree.root;
  const { pathElements, pathIndices } = tree.proof(leafIndex);
  const witness = buildWitness({ note, recipient: kid.publicKey(), root, pathElements, pathIndices });
  info("generating Groth16 proof…");
  const { proofBytes } = await generateProof(witness, ARTIFACTS);

  const claimBalBefore = await xlmBalanceStroops(kid.publicKey());
  const remintTx = await kidZw.remint({ to: kid.publicKey(), amount: REWARD_STROOPS, root, nullifier: note.nullifier, relayer_fee: 0n, proof: Buffer.from(proofBytes) });
  const sent = await remintTx.signAndSend();
  const claimHash = (sent as unknown as { sendTransactionResponse?: { hash?: string } }).sendTransactionResponse?.hash;
  console.log(`  ${col.yellow}claim (remint) tx hash = ${claimHash ?? "(unknown)"}${col.reset}`);
  const nullifierUsed = (await withRetry(() => zwRead.is_nullifier_used({ nullifier: note.nullifier }))).result;
  assert(nullifierUsed === true, "claim succeeded — nullifier consumed on-chain (reward spent once)");
  const claimBalAfter = await xlmBalanceStroops(kid.publicKey());
  info(`kid balance ${claimBalBefore} → ${claimBalAfter} stroops across the claim`);

  // ── ACT 5 — a stream to the (now real) kid collects ─────────────────────────
  scene("ACT 5 — Parent streams an allowance to the kid; kid collects");
  const token = CONTRACT_IDS.underlying;
  const perDayXlm = 10;
  const stroopsPerSec = (BigInt(perDayXlm) * XLM_STROOPS) / 86_400n;
  const amtPerSec = stroopsPerSec * AMT_PER_SEC_MULTIPLIER;
  const CYCLE_SECS = 2;
  const nowSecs = Math.floor(Date.now() / 1000);
  const start = cycleAlignedStart(nowSecs, CYCLE_SECS, 12);
  const duration = 40n;
  const funding = stroopsPerSec * duration * 2n;
  const receiver = buildAllowanceReceiver({ account: kid.publicKey(), amtPerSec, start: BigInt(start), duration, streamId: 0n });
  const parentDrips = dripsFor(parent);
  const appliedDelta = (await (await parentDrips.set_streams({ account: parent.publicKey(), token, new_receivers: [receiver], balance_delta: funding, max_end_hint1: 0n, max_end_hint2: 0n })).signAndSend()).result;
  assert(appliedDelta === funding, `allowance funded (${funding} stroops moved into the vault)`);

  const waitSecs = start - Math.floor(Date.now() / 1000) + 16;
  await sleep(waitSecs);

  const kidDrips = dripsFor(kid);
  const elapsed = Math.floor(Date.now() / 1000) - start;
  const maxCycles = maxCyclesForElapsed(elapsed, CYCLE_SECS);
  const received = (await (await kidDrips.receive_streams({ account: kid.publicKey(), token, max_cycles: maxCycles })).signAndSend()).result;
  info(`receive_streams credited ${received} stroops`);
  await (await kidDrips.split({ account: kid.publicKey(), token })).signAndSend();
  const collected = (await (await kidDrips.collect({ account: kid.publicKey(), token, to: kid.publicKey() })).signAndSend()).result;
  info(`collected ${collected} stroops (${Number(collected) / Number(XLM_STROOPS)} XLM)`);
  assert(collected > 0n, `stream to the parent-created kid account collects real XLM (${collected} stroops)`);

  console.log(`\n  ${col.green}Passed: ${passed}${col.reset}`);
  if (failed > 0) { console.log(`  ${col.red}Failed: ${failed}${col.reset}`); process.exit(1); }
  console.log(`\n  ${col.bold}${col.green}ALL TESTS PASSED — parent created + funded the kid; kid claimed + collected.${col.reset}\n`);
  process.exit(0);
}

main().catch((err) => { console.error(`\n${col.red}FATAL:${col.reset}`, err); process.exit(1); });
