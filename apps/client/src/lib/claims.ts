// claims.ts — pure (no-React) data layer for Maestro's private reward claims,
// backed by the `zwerc20` "family treasury" contract on Stellar testnet.
//
// Product story:
//   • A PARENT "funds a reward": we derive a fresh claim note (a secret), turn
//     it into a privacy address `addr20`, and `deposit(from, addr20, amount)`.
//     The treasury pulls the XLM and inserts `Poseidon(addr20, amount)` as a
//     Merkle leaf. Only someone who knows the secret can later claim it — the
//     public ledger never ties the deposit to the eventual recipient.
//   • A KID "claims privately": we rebuild the Merkle tree from the treasury's
//     on-chain leaves, build a Groth16 witness for the reused `remint.circom`
//     circuit, prove it in the browser (snarkjs), and call
//     `remint(to, amount, root, nullifier, relayer_fee, proof)`. Real XLM lands
//     in the kid's wallet and the note's nullifier is burned (no double-claim).
//
// This module is the crypto/data core shared by the React hooks AND the node
// e2e test, so it must stay React-free and run in both the browser and node.
//
// CONVENTIONS THAT MUST MATCH THE CONTRACT (verified against the Rust fixture
// in contracts/zwerc20/src/remint_fixture.rs and live testnet leaf(0)):
//   1. Poseidon is circomlib Poseidon(2) (circomlibjs) — commitment = leaf.
//   2. Public signals order: [root, nullifier, to, amount, id, redeem,
//      relayerFee] with id = 0, redeem = 1, relayerFee = 0 (redeem path).
//   3. `to` public input = sha256(Address.toScVal().toXDR()) mod r  (to_field()
//      in the contract), NOT the raw address. The contract re-derives it, so
//      the prover MUST feed the same field element.
//   4. Proof bytes for `Groth16Proof::try_from(Bytes)`:
//        A (G1, 64B) || B (G2, 128B) || C (G1, 64B), each field element 32B
//        big-endian, G2 in Soroban's c1||c0 (imaginary||real) limb order.

// @ts-expect-error circomlibjs ships no types
import circomlibjs from "circomlibjs";
import { Address } from "@stellar/stellar-sdk";
// @ts-expect-error snarkjs ships no types
import * as snarkjs from "snarkjs";

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Merkle tree depth — must match `TREE_DEPTH` in remint.circom + merkle.rs. */
export const TREE_DEPTH = 20;

/** ERC-20 slot: the circuit's `id` is always 0 for fungible rewards. */
export const TOKEN_ID = 0n;

/** Max leaves per `leaves(start, limit)` call (contract caps at 100). */
export const MAX_LEAVES_PER_READ = 100;

/** BN254 scalar field modulus `r`. */
export const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const TWO160 = 1n << 160n;

// circomlibjs 0.0.8 exposes a synchronous poseidon over bigints. This is the
// SAME implementation the contract's on-chain Poseidon reproduces (verified:
// Poseidon(ADDR20, AMOUNT) === on-chain leaf(0)).
const poseidon = circomlibjs.poseidon as (inputs: bigint[]) => bigint;

// ─────────────────────────────────────────────────────────────────────────────
//  Claim note
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A claim note is the private secret behind one funded reward. The parent
 * creates it, hands it to the kid (in this demo, both live in the same wallet's
 * localStorage), and the kid spends it exactly once.
 */
export interface ClaimNote {
  /** Stable id for storage / dedupe (hex of the nullifier). */
  id: string;
  /** The secret — the whole security of the note. Decimal string (bigint). */
  secret: string;
  /** Reward size in stroops (i128 base unit). Decimal string (bigint). */
  amountStroops: string;
  /** Leaf index this note's commitment was inserted at (from `deposit`). */
  leafIndex: number;
  /** Unix ms the note was funded (for display / ordering). */
  createdAt: number;
  /** Optional human label ("Cleaned room", …). */
  label?: string;
}

/** Derived, non-secret view of a note (addr20, commitment, nullifier). */
export interface DerivedNote {
  secret: bigint;
  addr20: bigint;
  q: bigint;
  commitment: bigint;
  nullifier: bigint;
  amountStroops: bigint;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Secret + address derivation (mirrors utils/erc8065/privacy.ts, contract-side)
// ─────────────────────────────────────────────────────────────────────────────

/** A fresh secret in the BN254 scalar field (well under r; ~248 bits). */
export function freshSecret(): bigint {
  const bytes = new Uint8Array(31); // 248 bits < r
  cryptoRandom(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v % BN254_R;
}

function cryptoRandom(out: Uint8Array): void {
  const g = globalThis as unknown as { crypto?: Crypto };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(out);
    return;
  }
  // node fallback (tests): require lazily so the browser bundle never pulls it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = eval("require")("crypto") as typeof import("crypto");
  const buf = nodeCrypto.randomBytes(out.length);
  out.set(buf);
}

/**
 * Privacy-address derivation, identical to the circuit:
 *   addrScalar = Poseidon(8065, id, secret)
 *   addr20     = addrScalar mod 2^160   (lower 160 bits)
 *   q          = addrScalar >> 160      (quotient the circuit checks)
 */
export function derivePrivacyAddress(secret: bigint, id: bigint = TOKEN_ID) {
  const addrScalar = poseidon([8065n, id, secret]);
  const addr20 = addrScalar & (TWO160 - 1n);
  const q = (addrScalar - addr20) / TWO160;
  return { addrScalar, addr20, q };
}

/** commitment (Merkle leaf) = Poseidon(addr20, amount). */
export function commitmentOf(addr20: bigint, amountStroops: bigint): bigint {
  return poseidon([addr20, amountStroops]);
}

/** nullifier = Poseidon(addr20, secret) — burned on claim, prevents replay. */
export function nullifierOf(addr20: bigint, secret: bigint): bigint {
  return poseidon([addr20, secret]);
}

/** Fully derive a note's public quantities from its secret + amount. */
export function deriveNote(secret: bigint, amountStroops: bigint): DerivedNote {
  const { addr20, q } = derivePrivacyAddress(secret);
  return {
    secret,
    addr20,
    q,
    commitment: commitmentOf(addr20, amountStroops),
    nullifier: nullifierOf(addr20, secret),
    amountStroops,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  to_field — canonical recipient encoding the circuit's `to` input requires
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `to_field = sha256(to.to_xdr()) mod r`, matching `to_field()` in
 * contracts/zwerc20/src/lib.rs. The contract XDR-encodes the ScVal Address and
 * hashes it; `Address.toScVal().toXDR()` in @stellar/stellar-sdk produces the
 * identical bytes (verified against the fixture's TO_STRKEY + PUBLIC_SIGNALS[2]).
 *
 * `sha256` here is synchronous SubtleCrypto-free: we use a tiny pure JS sha256
 * so the same code runs in node and the browser without async.
 */
export function toField(recipient: string): bigint {
  const addr = Address.fromString(recipient);
  const xdrBytes = new Uint8Array(addr.toScVal().toXDR()); // Buffer → bytes
  const digest = sha256Sync(xdrBytes); // 32-byte big-endian digest
  let v = 0n;
  for (const b of digest) v = (v << 8n) | BigInt(b);
  return v % BN254_R;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Merkle tree — sparse incremental, circomlib-Poseidon nodes (depth 20)
//  Faithful to contracts/zwerc20/src/merkle.rs: zeros[0]=0, zeros[i]=H(z,z).
// ─────────────────────────────────────────────────────────────────────────────

export class ClaimTree {
  readonly depth: number;
  readonly zeros: bigint[] = [];
  private readonly filledSubtrees: bigint[];
  readonly leaves: bigint[] = [];
  private nextIndex = 0;
  root: bigint;

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
    this.filledSubtrees = new Array(depth).fill(0n);
    let z = 0n;
    this.zeros[0] = z;
    for (let i = 1; i < depth; i++) {
      z = poseidon([z, z]);
      this.zeros[i] = z;
    }
    // Empty-tree root matches merkle::init (root = zeros[depth-1]).
    this.root = this.zeros[depth - 1];
  }

  insert(leaf: bigint): number {
    const index = this.nextIndex;
    this.leaves.push(leaf);
    let cur = leaf;
    let idx = index;
    for (let i = 0; i < this.depth; i++) {
      if (idx % 2 === 0) {
        this.filledSubtrees[i] = cur;
        cur = poseidon([cur, this.zeros[i]]);
      } else {
        cur = poseidon([this.filledSubtrees[i], cur]);
      }
      idx = Math.floor(idx / 2);
    }
    this.root = cur;
    this.nextIndex++;
    return index;
  }

  /** Merkle inclusion proof for a leaf: sibling elements + left/right bits. */
  proof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    if (index >= this.nextIndex) throw new Error("leaf index out of range");
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;
    for (let i = 0; i < this.depth; i++) {
      const isRight = currentIndex % 2 === 1;
      pathIndices.push(isRight ? 1 : 0);
      const levelSize = 2 ** i;
      if (isRight) {
        pathElements.push(this.subtree((currentIndex - 1) * levelSize, i));
      } else {
        const sibStart = (currentIndex + 1) * levelSize;
        pathElements.push(
          sibStart < this.nextIndex ? this.subtree(sibStart, i) : this.zeros[i],
        );
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    return { pathElements, pathIndices };
  }

  private subtree(leafIndex: number, level: number): bigint {
    if (level === 0)
      return leafIndex < this.leaves.length ? this.leaves[leafIndex] : this.zeros[0];
    const half = 2 ** (level - 1);
    const left = this.subtree(leafIndex, level - 1);
    const right = this.subtree(leafIndex + half, level - 1);
    return poseidon([left, right]);
  }
}

/** Minimal shape of the read-only zwerc20 client this module needs. */
export interface LeavesReader {
  next_index: () => Promise<{ result: number }>;
  leaves: (args: {
    start: number;
    limit: number;
  }) => Promise<{ result: Array<bigint> }>;
}

/**
 * Rebuild the full claim tree from on-chain state, paginating `leaves()`.
 * MUST include every pre-existing leaf (e.g. the fixture deposit at index 0) or
 * the reconstructed root won't be a known root and remint will reject the proof.
 */
export async function rebuildTree(client: LeavesReader): Promise<ClaimTree> {
  const tree = new ClaimTree(TREE_DEPTH);
  const count = (await withRetry(() => client.next_index())).result;
  let start = 0;
  while (start < count) {
    const limit = Math.min(MAX_LEAVES_PER_READ, count - start);
    const page = (await withRetry(() => client.leaves({ start, limit }))).result;
    if (page.length === 0) break; // defensive: avoid an infinite loop
    for (const leaf of page) tree.insert(BigInt(leaf));
    start += page.length;
  }
  return tree;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Witness + Groth16 proof
// ─────────────────────────────────────────────────────────────────────────────

export interface CircuitInput {
  root: string;
  nullifier: string;
  to: string;
  remintAmount: string;
  id: string;
  redeem: string;
  relayerFee: string;
  secret: string;
  addr20: string;
  commitAmount: string;
  q: string;
  pathElements: string[];
  pathIndices: string[];
}

/**
 * Build the snarkjs witness for a redeem-path claim. `to` is the recipient's
 * `to_field` (already reduced). `redeem = 1`, `id = 0`, `relayerFee = 0` — the
 * exact public-signal convention the contract's remint() feeds the verifier.
 */
export function buildWitness(params: {
  note: DerivedNote;
  recipient: string;
  root: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}): CircuitInput {
  const { note, recipient, root, pathElements, pathIndices } = params;
  return {
    root: root.toString(),
    nullifier: note.nullifier.toString(),
    to: toField(recipient).toString(),
    remintAmount: note.amountStroops.toString(),
    id: TOKEN_ID.toString(),
    redeem: "1",
    relayerFee: "0",
    secret: note.secret.toString(),
    addr20: note.addr20.toString(),
    commitAmount: note.amountStroops.toString(),
    q: note.q.toString(),
    pathElements: pathElements.map((e) => e.toString()),
    pathIndices: pathIndices.map((i) => i.toString()),
  };
}

/** Locations of the compiled circuit artifacts (served from /public). */
export interface CircuitArtifacts {
  wasm: string | Uint8Array;
  zkey: string | Uint8Array;
}

/** Browser defaults: artifacts served under /circuits. */
export const BROWSER_ARTIFACTS: CircuitArtifacts = {
  wasm: "/circuits/remint.wasm",
  zkey: "/circuits/remint_final.zkey",
};

export interface GeneratedProof {
  /** Raw 256-byte proof for `Groth16Proof::try_from(Bytes)`. */
  proofBytes: Uint8Array;
  /** snarkjs public signals (decimal strings), in circuit order. */
  publicSignals: string[];
  /** snarkjs proof object (for debugging / cross-checks). */
  rawProof: unknown;
}

/**
 * Generate a Groth16 proof in the browser (or node) and serialize it into the
 * exact bytes the Soroban verifier expects. CPU-bound: expect ~10s+.
 */
export async function generateProof(
  input: CircuitInput,
  artifacts: CircuitArtifacts = BROWSER_ARTIFACTS,
): Promise<GeneratedProof> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    artifacts.wasm,
    artifacts.zkey,
  );
  return {
    proofBytes: serializeProof(proof),
    publicSignals,
    rawProof: proof,
  };
}

/**
 * Serialize a snarkjs Groth16 proof into the Soroban `Groth16Proof` byte layout:
 *
 *   A (G1) = x || y                          (64 bytes)
 *   B (G2) = x.c1 || x.c0 || y.c1 || y.c0    (128 bytes, Soroban c1||c0 order)
 *   C (G1) = x || y                          (64 bytes)
 *
 * Every field element is 32 bytes, big-endian. snarkjs gives affine coordinates
 * as decimal strings with a trailing "1" (the projective z), which we drop.
 *
 * The contract negates A itself (`neg_a = -proof.a`), so A is serialized as-is.
 */
export function serializeProof(proof: {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}): Uint8Array {
  const out = new Uint8Array(256);
  // A: G1 (x, y)
  out.set(fe(proof.pi_a[0]), 0);
  out.set(fe(proof.pi_a[1]), 32);
  // B: G2 (x = [c0, c1], y = [c0, c1]) → serialized c1 || c0 per coordinate.
  out.set(fe(proof.pi_b[0][1]), 64); // x.c1
  out.set(fe(proof.pi_b[0][0]), 96); // x.c0
  out.set(fe(proof.pi_b[1][1]), 128); // y.c1
  out.set(fe(proof.pi_b[1][0]), 160); // y.c0
  // C: G1 (x, y)
  out.set(fe(proof.pi_c[0]), 192);
  out.set(fe(proof.pi_c[1]), 224);
  return out;
}

/** Decimal-string field element → 32-byte big-endian. */
function fe(dec: string): Uint8Array {
  let v = BigInt(dec);
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Small utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retry a flaky network read a few times with linear backoff. This machine has
 * intermittent connectivity drops; a single failure shouldn't sink a claim.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 4,
  baseMs = 700,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(baseMs * (i + 1));
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pure JS sha256 (sync, dependency-free) — for to_field in browser + node.
//  Standard FIPS-180-4 implementation over Uint8Array, big-endian digest.
// ─────────────────────────────────────────────────────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Sync(msg: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const ml = msg.length;
  const bitLen = ml * 8;
  const withOne = ml + 1;
  const total = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[ml] = 0x80;
  // 64-bit big-endian bit length in the last 8 bytes.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  buf[total - 8] = (hi >>> 24) & 0xff;
  buf[total - 7] = (hi >>> 16) & 0xff;
  buf[total - 6] = (hi >>> 8) & 0xff;
  buf[total - 5] = hi & 0xff;
  buf[total - 4] = (lo >>> 24) & 0xff;
  buf[total - 3] = (lo >>> 16) & 0xff;
  buf[total - 2] = (lo >>> 8) & 0xff;
  buf[total - 1] = lo & 0xff;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (buf[off + i * 4] << 24) |
        (buf[off + i * 4 + 1] << 16) |
        (buf[off + i * 4 + 2] << 8) |
        buf[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}
