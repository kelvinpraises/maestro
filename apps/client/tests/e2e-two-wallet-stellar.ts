#!/usr/bin/env tsx
/**
 * MAESTRO — E2E TWO-WALLET PRIVACY SPLIT (Stellar / Soroban testnet, zwerc20)
 *
 * THIS IS THE PRIVACY CLAIM, proven on real testnet. It demonstrates that a
 * kid's reward claim is UNLINKABLE to the kid on-chain: the kid holds two
 * keypairs — a public `spending` wallet (allowance) and a private `stash`
 * (reward claims only) — and a neutral, shared RELAYER submits the
 * `remint(to = stash)`. Because `zwerc20::remint` has no `require_auth`, any
 * account may submit it and the payout is proof-bound to `stash`; so the on-chain
 * remint tx is SOURCED BY THE RELAYER, not by the kid. Nothing the kid signs ever
 * names the stash publicly. See context/TWO-WALLET-PRIVACY.md.
 *
 *   ACT 1  Mint spending + stash; relayer creates the stash base reserve.
 *   ACT 2  Parent funds a private reward → deposit(from=parent, addr20, amount).
 *   ACT 3  Rebuild the claim tree; prove `to = stash` in-process.
 *   ACT 4  RELAYER submits remint(to = stash). THE decisive assertion:
 *          the remint tx source_account == RELAYER, and != spending/stash/parent.
 *   ACT 5  Stash balance rose by ~the reward; spending balance unchanged by the
 *          claim (the kid's public wallet never moved for this reward).
 *   ACT 6  Replay of the same note is rejected (nullifier already used).
 *
 * Throwaway accounts (parent, spending) are funded from the local
 * `maestro-deployer` CLI identity (friendbot DNS is broken on this machine). The
 * STASH is deliberately created by the RELAYER (via the real client helper,
 * ensureStashFunded), NOT the deployer — that is the behaviour under test.
 *
 * Proof generation is CPU-bound (~10s+) — that is normal.
 *
 * Run: npx tsx apps/client/tests/e2e-two-wallet-stellar.ts
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
import {
  STELLAR_NETWORK,
  CONTRACT_IDS,
  RELAYER,
  relayerKeypair,
  relayerSign,
} from "../src/config/stellar.js";
import { ensureStashFunded } from "../src/lib/account.js";
import {
  deriveNote,
  freshSecret,
  rebuildTree,
  buildWitness,
  generateProof,
  toField,
  type CircuitArtifacts,
} from "../src/lib/claims.js";

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
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const XLM_STROOPS = 10_000_000n;

// ── circuit artifacts (served from public/, read from disk in node) ──────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CIRCUITS_DIR = path.resolve(__dirname, "../public/circuits");
const ARTIFACTS: CircuitArtifacts = {
  wasm: path.join(CIRCUITS_DIR, "remint.wasm"),
  zkey: path.join(CIRCUITS_DIR, "remint_final.zkey"),
};

// ── testnet clients ──────────────────────────────────────────────────────────
function makeSigner(kp: Keypair) {
  const { signTransaction } = StellarContract.basicNodeSigner(
    kp,
    STELLAR_NETWORK.networkPassphrase,
  );
  return { publicKey: kp.publicKey(), signTransaction };
}

function zwFor(kp: Keypair) {
  return new Zwerc20Client({
    rpcUrl: STELLAR_NETWORK.rpcUrl,
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
    contractId: CONTRACT_IDS.zwerc20,
    ...makeSigner(kp),
  });
}

// The RELAYER's write client — sources + signs the remint with the relayer key
// via the SAME helper the app uses (relayerSign), not a kid key.
function zwRelayer() {
  return new Zwerc20Client({
    rpcUrl: STELLAR_NETWORK.rpcUrl,
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
    contractId: CONTRACT_IDS.zwerc20,
    publicKey: RELAYER.publicKey,
    signTransaction: relayerSign(),
  });
}

const zwRead = new Zwerc20Client({
  rpcUrl: STELLAR_NETWORK.rpcUrl,
  networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  contractId: CONTRACT_IDS.zwerc20,
});

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

async function withRetry<T>(fn: () => Promise<T>, attempts = 6, baseMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseMs * (i + 1))); }
  }
  throw lastErr;
}

async function xlmBalance(pubkey: string): Promise<bigint> {
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

async function accountExistsOnChain(pubkey: string): Promise<boolean> {
  const horizon = new Horizon.Server(STELLAR_NETWORK.horizonUrl);
  try {
    await withRetry(() => horizon.loadAccount(pubkey));
    return true;
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404) return false;
    throw e;
  }
}

/** Fetch a transaction's source account from Horizon (indexed a moment after
 *  the RPC confirms it). Retries so a brief indexing lag doesn't fail the run. */
async function txSourceAccount(hash: string): Promise<string> {
  const horizon = new Horizon.Server(STELLAR_NETWORK.horizonUrl);
  const rec = await withRetry(() => horizon.transactions().transaction(hash).call(), 8, 1200);
  return rec.source_account;
}

async function main() {
  console.log(`\n${col.bold}🕵️  MAESTRO E2E — Two-Wallet Privacy Split (Stellar zwerc20)${col.reset}`);
  console.log(`${col.dim}   Relayer submits remint(to=stash); the claim is unlinkable to the kid.${col.reset}`);

  scene("Participants (a kid holds TWO keypairs)");
  const parent = Keypair.random();
  const spending = Keypair.random(); // public identity: allowance + gas
  const stash = Keypair.random();    // private: reward claims ONLY
  const relayer = relayerKeypair();
  console.log(`  ${col.cyan}Parent  ${col.reset} ${short(parent.publicKey())}`);
  console.log(`  ${col.cyan}Spending${col.reset} ${short(spending.publicKey())}  (public)`);
  console.log(`  ${col.cyan}Stash   ${col.reset} ${short(stash.publicKey())}  (private)`);
  console.log(`  ${col.cyan}Relayer ${col.reset} ${short(relayer.publicKey())}  (shared anonymity set)`);
  assert(relayer.publicKey() === RELAYER.publicKey, "relayerKeypair() derives the configured RELAYER public key");

  // ── ACT 1: mint spending + stash; relayer creates the stash reserve ─────────
  scene("ACT 1 — Fund spending from deployer; RELAYER creates the stash reserve");
  fundFromDeployer(parent.publicKey(), 30);
  info("parent funded with 30 XLM (family bank)");
  fundFromDeployer(spending.publicKey(), 3);
  info("spending funded with 3 XLM (allowance/gas identity)");

  // The stash must NOT exist yet — the relayer brings it into being.
  const stashExistsBefore = await accountExistsOnChain(stash.publicKey());
  assert(stashExistsBefore === false, "stash does not exist on-chain before the relayer creates it");

  info("relayer creating + funding the stash base reserve (ensureStashFunded)…");
  const ensured = await withRetry(() => ensureStashFunded(stash.publicKey()));
  info(`ensureStashFunded → ${JSON.stringify(ensured)}`);
  assert(ensured.kind === "created", "relayer created the stash (createAccount succeeded)");

  const stashCreateHash = ensured.kind === "created" ? ensured.hash : "";
  const stashCreateSource = await txSourceAccount(stashCreateHash);
  info(`stash createAccount tx ${short(stashCreateHash)} source = ${short(stashCreateSource)}`);
  assert(stashCreateSource === RELAYER.publicKey, "stash createAccount was SOURCED BY THE RELAYER (not spending/parent)");
  assert(await accountExistsOnChain(stash.publicKey()), "stash now exists on-chain");

  // ── ACT 2: parent funds a private reward ────────────────────────────────────
  scene("ACT 2 — Parent funds a private reward (deposit)");
  const REWARD_STROOPS = 3_000_000n; // 0.3 XLM reward
  info(`reward = ${REWARD_STROOPS} stroops (${Number(REWARD_STROOPS) / Number(XLM_STROOPS)} XLM)`);

  const secret = freshSecret();
  const note = deriveNote(secret, REWARD_STROOPS);
  info(`derived addr20 = ${note.addr20}`);

  const parentZw = zwFor(parent);
  const depositTx = await parentZw.deposit({
    from: parent.publicKey(),
    addr20: note.addr20,
    amount: REWARD_STROOPS,
  });
  const leafIndex = (await depositTx.signAndSend()).result;
  info(`deposit inserted note at leaf index ${leafIndex}`);
  assert(typeof leafIndex === "number" && leafIndex >= 1, `note inserted after the pre-existing fixture leaf (index ${leafIndex} ≥ 1)`);

  const onChainLeaf = BigInt((await withRetry(() => zwRead.leaf({ index: leafIndex }))).result);
  assert(onChainLeaf === note.commitment, "on-chain leaf === locally computed Poseidon commitment");

  // ── ACT 3: rebuild tree + prove `to = stash` ────────────────────────────────
  scene("ACT 3 — Rebuild the claim tree; prove `to = stash`");
  const tree = await rebuildTree(zwRead);
  info(`rebuilt tree from ${tree.leaves.length} leaves`);
  const localRoot = tree.root;
  const onChainRoot = BigInt((await withRetry(() => zwRead.current_root())).result);
  assert(localRoot === onChainRoot, "locally rebuilt Merkle root === on-chain current_root");

  const { pathElements, pathIndices } = tree.proof(leafIndex);
  const witness = buildWitness({
    note,
    recipient: stash.publicKey(), // proof binds the payout to the STASH
    root: localRoot,
    pathElements,
    pathIndices,
  });

  info("generating Groth16 proof (CPU-bound, ~10s+)…");
  const t0 = Date.now();
  const { proofBytes, publicSignals } = await generateProof(witness, ARTIFACTS);
  info(`proof generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const expectedTo = toField(stash.publicKey());
  assert(BigInt(publicSignals[2]) === expectedTo, "public signal[2] to === to_field(STASH)");
  assert(BigInt(publicSignals[3]) === REWARD_STROOPS, "public signal[3] amount matches reward");
  assert(publicSignals[6] === "0", "public signal[6] relayerFee === 0");

  // ── ACT 4: RELAYER submits remint(to = stash) — THE privacy assertion ───────
  scene("ACT 4 — RELAYER submits remint(to = stash); assert source == RELAYER");
  const spendingBefore = await xlmBalance(spending.publicKey());
  const stashBefore = await xlmBalance(stash.publicKey());
  info(`spending balance before claim = ${spendingBefore} stroops`);
  info(`stash    balance before claim = ${stashBefore} stroops`);

  const relayerZw = zwRelayer(); // relayer sources + signs (NOT the kid)
  const remintTx = await relayerZw.remint({
    to: stash.publicKey(),
    amount: REWARD_STROOPS,
    root: localRoot,
    nullifier: note.nullifier,
    relayer_fee: 0n,
    proof: Buffer.from(proofBytes),
  });
  const sent = await remintTx.signAndSend();
  const remintHash = (sent as unknown as { sendTransactionResponse?: { hash?: string } })
    .sendTransactionResponse?.hash;
  assert(!!remintHash, "remint returned a tx hash");
  console.log(`  ${col.bold}${col.yellow}remint tx hash = ${remintHash}${col.reset}`);

  const remintSource = await txSourceAccount(remintHash!);
  console.log(`  ${col.bold}${col.yellow}remint source_account = ${remintSource}${col.reset}`);
  info(`RELAYER   = ${RELAYER.publicKey}`);
  info(`spending  = ${spending.publicKey()}`);
  info(`stash     = ${stash.publicKey()}`);
  info(`parent    = ${parent.publicKey()}`);

  // THE decisive privacy assertion.
  assert(remintSource === RELAYER.publicKey, "remint tx source_account == RELAYER (the anonymity set)");
  assert(remintSource !== spending.publicKey(), "remint tx source_account != spending (kid's public wallet did NOT submit)");
  assert(remintSource !== stash.publicKey(), "remint tx source_account != stash (the private recipient did NOT submit)");
  assert(remintSource !== parent.publicKey(), "remint tx source_account != parent");

  // ── ACT 5: stash rose by ~reward; spending unchanged by the claim ───────────
  scene("ACT 5 — Stash rose by ~reward; spending unchanged by the claim");
  const spendingAfter = await xlmBalance(spending.publicKey());
  const stashAfter = await xlmBalance(stash.publicKey());
  const stashDelta = stashAfter - stashBefore;
  const spendingDelta = spendingAfter - spendingBefore;
  info(`stash    delta = ${stashDelta} stroops`);
  info(`spending delta = ${spendingDelta} stroops`);

  const nullifierUsed = (await withRetry(() => zwRead.is_nullifier_used({ nullifier: note.nullifier }))).result;
  assert(nullifierUsed === true, "nullifier consumed on-chain (note spent exactly once)");

  // The relayer paid gas, so the stash receives the FULL reward (no fee taken).
  assert(stashDelta === REWARD_STROOPS, `stash balance rose by exactly the reward (delta ${stashDelta} == reward ${REWARD_STROOPS})`);
  // The kid's public wallet paid no gas and received nothing for this claim.
  assert(spendingDelta === 0n, `spending balance unchanged by the claim (delta ${spendingDelta} == 0)`);

  // ── ACT 6: replay is rejected ───────────────────────────────────────────────
  scene("ACT 6 — Replay of the same note is rejected");
  let replayRejected = false;
  try {
    const replayTx = await zwRelayer().remint({
      to: stash.publicKey(),
      amount: REWARD_STROOPS,
      root: localRoot,
      nullifier: note.nullifier,
      relayer_fee: 0n,
      proof: Buffer.from(proofBytes),
    });
    await replayTx.signAndSend();
  } catch (e) {
    replayRejected = true;
    info(`replay rejected: ${(e as Error).message?.slice(0, 120)}`);
  }
  assert(replayRejected, "second claim of the same note was rejected (nullifier already used)");

  console.log(`\n  ${col.green}Passed: ${passed}${col.reset}`);
  if (failed > 0) { console.log(`  ${col.red}Failed: ${failed}${col.reset}`); process.exit(1); }
  console.log(`\n  ${col.bold}${col.green}ALL TESTS PASSED — the reward claim is unlinkable: relayer submitted, stash received.${col.reset}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${col.red}FATAL:${col.reset}`, err);
  process.exit(1);
});
