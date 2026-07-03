#!/usr/bin/env tsx
/**
 * MAESTRO — E2E PRIVATE REWARD CLAIM (Stellar / Soroban testnet, zwerc20)
 *
 * Story: a parent funds a private reward into the family treasury, then a kid
 * claims it privately — a real Groth16 proof is generated in-process (the SAME
 * `src/lib/claims.ts` data layer the browser uses), verified on-chain by the
 * deployed verifier, and real XLM lands in the kid's private STASH. Per the
 * two-wallet privacy split (context/TWO-WALLET-PRIVACY.md) the claim is proved
 * for `to = stash` and SUBMITTED BY THE RELAYER, so nothing the kid signs names
 * the stash on-chain. A replay of the same note is rejected.
 *
 *   ACT 1  Parent funds a reward   → deposit(from, addr20, amount)
 *   ACT 2  Rebuild the claim tree   → leaves() range reads (incl. pre-existing
 *                                     fixture leaf 0), root must be a known root
 *   ACT 3  Kid claims privately     → relayer creates the stash reserve, prove
 *                                     `to = stash` in node, RELAYER submits
 *                                     remint(to = stash), assert stash XLM rose
 *                                     by exactly the reward
 *   ACT 4  Replay is rejected       → second remint of the same note panics
 *
 * Throwaway accounts are funded from the local `maestro-deployer` CLI identity
 * (friendbot DNS is broken on this machine):
 *   stellar tx new create-account --destination <G...> \
 *     --starting-balance <stroops> --source maestro-deployer --network testnet
 *
 * Proof generation is CPU-bound (~10s+) — that is normal.
 *
 * Run: npx tsx apps/client/tests/e2e-claim-stellar.ts
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
// via the SAME helper the app uses, not a kid key.
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

async function withRetry<T>(fn: () => Promise<T>, attempts = 5, baseMs = 800): Promise<T> {
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

async function main() {
  console.log(`\n${col.bold}🔒 MAESTRO E2E — Private Reward Claim (Stellar zwerc20)${col.reset}`);
  console.log(`${col.dim}   Parent funds a private reward; kid proves + claims it; replay rejected.${col.reset}`);

  scene("Participants");
  const parent = Keypair.random();
  const kid = Keypair.random();      // the kid's PUBLIC spending wallet
  const stash = Keypair.random();    // the kid's PRIVATE stash (reward recipient)
  console.log(`  ${col.cyan}Parent  ${col.reset} ${short(parent.publicKey())}`);
  console.log(`  ${col.cyan}Spending${col.reset} ${short(kid.publicKey())}  (public)`);
  console.log(`  ${col.cyan}Stash   ${col.reset} ${short(stash.publicKey())}  (private, reward recipient)`);

  scene("Fund throwaway accounts from maestro-deployer");
  fundFromDeployer(parent.publicKey(), 30);
  info("parent funded with 30 XLM");
  // The kid's spending wallet is funded only so it's a realistic account; the
  // RELAYER (not the kid) pays gas for the claim, so this is not strictly needed.
  fundFromDeployer(kid.publicKey(), 5);
  info("spending funded with 5 XLM (the relayer, not the kid, pays claim gas)");

  // ── ACT 1: parent funds a private reward ────────────────────────────────────
  scene("ACT 1 — Parent funds a private reward (deposit)");
  const REWARD_STROOPS = 3_000_000n; // 0.3 XLM reward
  info(`reward = ${REWARD_STROOPS} stroops (${Number(REWARD_STROOPS) / Number(XLM_STROOPS)} XLM)`);

  const secret = freshSecret();
  const note = deriveNote(secret, REWARD_STROOPS);
  info(`derived addr20 = ${note.addr20}`);
  info(`commitment (leaf) = 0x${note.commitment.toString(16).padStart(64, "0")}`);

  const parentZw = zwFor(parent);
  const depositTx = await parentZw.deposit({
    from: parent.publicKey(),
    addr20: note.addr20,
    amount: REWARD_STROOPS,
  });
  const leafIndex = (await depositTx.signAndSend()).result;
  info(`deposit inserted note at leaf index ${leafIndex}`);
  assert(typeof leafIndex === "number" && leafIndex >= 1, `note inserted after the pre-existing fixture leaf (index ${leafIndex} ≥ 1)`);

  // Confirm the on-chain leaf equals our locally computed commitment.
  const onChainLeaf = BigInt((await withRetry(() => zwRead.leaf({ index: leafIndex }))).result);
  assert(onChainLeaf === note.commitment, "on-chain leaf === locally computed Poseidon commitment");

  // ── ACT 2: rebuild the claim tree from on-chain leaves ──────────────────────
  scene("ACT 2 — Rebuild the claim tree from on-chain leaves");
  const tree = await rebuildTree(zwRead);
  info(`rebuilt tree from ${tree.leaves.length} leaves (incl. pre-existing fixture leaves)`);
  assert(tree.leaves.length >= 2, `tree includes the fixture leaf(s) + our new note (${tree.leaves.length} leaves)`);

  const localRoot = tree.root;
  const onChainRoot = BigInt((await withRetry(() => zwRead.current_root())).result);
  assert(localRoot === onChainRoot, "locally rebuilt Merkle root === on-chain current_root");

  const isKnown = (await withRetry(() => zwRead.is_known_root({ root: localRoot }))).result;
  assert(isKnown === true, "rebuilt root is a known root on-chain");

  // ── ACT 3: kid claims privately, into the STASH, via the RELAYER ────────────
  scene("ACT 3 — Kid claims privately (relayer creates stash → prove → relayer remint)");

  // The relayer brings the stash into existence (the SAC transfer needs a live
  // destination). NOT the kid's spending wallet or the parent — that would link
  // the stash. This is the exact helper the app's claim path calls.
  info("relayer creating + funding the stash base reserve (ensureStashFunded)…");
  const ensured = await withRetry(() => ensureStashFunded(stash.publicKey()));
  info(`ensureStashFunded → ${JSON.stringify(ensured)}`);
  assert(
    ensured.kind === "created" || ensured.kind === "exists",
    "relayer ensured the stash exists on-chain",
  );

  const stashBalanceBefore = await xlmBalance(stash.publicKey());
  const kidBalanceBefore = await xlmBalance(kid.publicKey());
  info(`stash    XLM balance before = ${stashBalanceBefore} stroops`);
  info(`spending XLM balance before = ${kidBalanceBefore} stroops`);

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

  // Cross-check snarkjs public signals vs. what the contract will feed the
  // verifier ([root, nullifier, to_field, amount, id=0, redeem=1, relayerFee=0]).
  const expectedTo = toField(stash.publicKey());
  assert(BigInt(publicSignals[0]) === localRoot, "public signal[0] root matches");
  assert(BigInt(publicSignals[1]) === note.nullifier, "public signal[1] nullifier matches");
  assert(BigInt(publicSignals[2]) === expectedTo, "public signal[2] to === to_field(STASH)");
  assert(BigInt(publicSignals[3]) === REWARD_STROOPS, "public signal[3] amount matches reward");
  assert(publicSignals[4] === "0", "public signal[4] id === 0");
  assert(publicSignals[5] === "1", "public signal[5] redeem === 1");
  assert(publicSignals[6] === "0", "public signal[6] relayerFee === 0");

  const relayerZw = zwRelayer(); // RELAYER submits + pays gas; payout goes to stash
  const remintTx = await relayerZw.remint({
    to: stash.publicKey(),
    amount: REWARD_STROOPS,
    root: localRoot,
    nullifier: note.nullifier,
    relayer_fee: 0n,
    proof: Buffer.from(proofBytes),
  });
  const sent = await remintTx.signAndSend();
  const txHash = (sent as unknown as { sendTransactionResponse?: { hash?: string } })
    .sendTransactionResponse?.hash;
  info(`remint tx hash = ${txHash ?? "(unknown)"}`);
  pass("relayer-submitted remint verified the proof on-chain and paid out");

  const stashBalanceAfter = await xlmBalance(stash.publicKey());
  const kidBalanceAfter = await xlmBalance(kid.publicKey());
  const stashDelta = stashBalanceAfter - stashBalanceBefore;
  const kidDelta = kidBalanceAfter - kidBalanceBefore;
  info(`stash    balance after = ${stashBalanceAfter} stroops (delta ${stashDelta})`);
  info(`spending balance after = ${kidBalanceAfter} stroops (delta ${kidDelta})`);

  const nullifierUsed = (await withRetry(() => zwRead.is_nullifier_used({ nullifier: note.nullifier }))).result;
  assert(nullifierUsed === true, "nullifier consumed on-chain (note spent exactly once)");

  // The RELAYER paid gas, so the stash receives the FULL reward with no fee cut.
  assert(
    stashDelta === REWARD_STROOPS,
    `stash balance rose by exactly the reward (delta ${stashDelta} == reward ${REWARD_STROOPS})`,
  );
  // The kid's public spending wallet paid no gas and received nothing here.
  assert(kidDelta === 0n, `spending balance unchanged by the claim (delta ${kidDelta} == 0)`);

  // ── ACT 4: replay is rejected ───────────────────────────────────────────────
  scene("ACT 4 — Replay of the same note is rejected");
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
  console.log(`\n  ${col.bold}${col.green}ALL TESTS PASSED — a real private reward was claimed on testnet.${col.reset}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${col.red}FATAL:${col.reset}`, err);
  process.exit(1);
});
