import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CB4NCPRKEW4PQVCE74SGS42OAEMV75ULJTYHHZDC5UOVXGOBEAJF6PJH",
  }
} as const

export type ConfigKey = {tag: "Admin", values: void} | {tag: "Underlying", values: void} | {tag: "Verifier", values: void};



export type MerkleKey = {tag: "NextIndex", values: void} | {tag: "Root", values: void} | {tag: "Zero", values: readonly [u32]} | {tag: "Filled", values: readonly [u32]} | {tag: "KnownRoot", values: readonly [u256]} | {tag: "Leaf", values: readonly [u32]};

export type NullKey = {tag: "Used", values: readonly [u256]};

/**
 * Errors that can occur during Groth16 proof verification.
 */
export const Groth16Error = {
  /**
   * The pairing product did not equal identity.
   */
  0: {message:"InvalidProof"},
  /**
   * The public inputs length does not match the verification key.
   */
  1: {message:"MalformedPublicInputs"},
  /**
   * The proof bytes are malformed.
   */
  2: {message:"MalformedProof"}
}


/**
 * Groth16 proof composed of points A, B, and C.
 * G2 point B uses Soroban's c1||c0 (imaginary||real) ordering.
 */
export interface Groth16Proof {
  /**
 * Point A
 */
a: Buffer;
  /**
 * Point B
 */
b: Buffer;
  /**
 * Point C
 */
c: Buffer;
}


/**
 * Groth16 verification key for BN254 curve (byte-oriented).
 * All G2 points use Soroban's c1||c0 (imaginary||real) ordering.
 */
export interface VerificationKeyBytes {
  /**
 * Alpha G1 point
 */
alpha: Buffer;
  /**
 * Beta G2 point
 */
beta: Buffer;
  /**
 * Delta G2 point
 */
delta: Buffer;
  /**
 * Gamma G2 point
 */
gamma: Buffer;
  /**
 * IC (public input commitments)
 */
ic: Array<Buffer>;
}

export interface Client {
  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time setup: admin, underlying token (SAC) address, and the deployed
   * Groth16 verifier contract. Initializes the empty Merkle tree.
   */
  init: ({admin, underlying, verifier}: {admin: string, underlying: string, verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a leaf transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The commitment at leaf `index`. Panics if the leaf does not exist yet.
   */
  leaf: ({index}: {index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<u256>>

  /**
   * Construct and simulate a leaves transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read up to `limit` leaves starting at `start`, for a client rebuilding
   * the Merkle tree. `limit` is capped at [`MAX_LEAVES_PER_READ`], and the
   * result is truncated where the tree ends (so it may be shorter than
   * requested, or empty when `start >= next_index`).
   */
  leaves: ({start, limit}: {start: u32, limit: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u256>>>

  /**
   * Construct and simulate a remint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pay out a claim from the treasury to a real Stellar `Address` by proving
   * family membership + claim token with the reused remint circuit (redeem
   * path).
   * 
   * Public signals match `ISnarkVerifier`:
   * `[root, nullifier, to, amount, id, redeem, relayerFee]` with `id = 0`
   * and `redeem = 1`.
   * 
   * The circuit's `to` public input is the field-encoding of the recipient.
   * We derive it on-chain from the real `to` (see [`to_field`]) rather than
   * accept it as a caller parameter, so a relayer cannot reuse a valid proof
   * with a different recipient and redirect the payout — the encoding is the
   * convention the client prover MUST replicate.
   */
  remint: ({to, amount, root, nullifier, relayer_fee, proof}: {to: string, amount: i128, root: u256, nullifier: u256, relayer_fee: u256, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deposit `amount` of the underlying asset into the treasury and insert the
   * claim commitment (`Poseidon(addr20, amount)`) into the tree. Returns the
   * leaf index.
   * 
   * The contract computes the commitment itself from `addr20` and `amount`
   * rather than trusting a caller-supplied leaf: the circuit builds the same
   * leaf as `Poseidon(addr20, commitAmount)` (see `remint.circom`), so binding
   * the leaf to the deposited `amount` here is what stops a funder from
   * committing to a claim worth more than they paid in.
   */
  deposit: ({from, addr20, amount}: {from: string, addr20: u256, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  verifier: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a next_index transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Number of leaves (commitments) inserted so far.
   */
  next_index: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a underlying transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  underlying: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a current_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  current_root: (options?: MethodOptions) => Promise<AssembledTransaction<u256>>

  /**
   * Construct and simulate a is_known_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_known_root: ({root}: {root: u256}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a is_nullifier_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_nullifier_used: ({nullifier}: {nullifier: u256}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAIVPbmUtdGltZSBzZXR1cDogYWRtaW4sIHVuZGVybHlpbmcgdG9rZW4gKFNBQykgYWRkcmVzcywgYW5kIHRoZSBkZXBsb3llZApHcm90aDE2IHZlcmlmaWVyIGNvbnRyYWN0LiBJbml0aWFsaXplcyB0aGUgZW1wdHkgTWVya2xlIHRyZWUuAAAAAAAABGluaXQAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACnVuZGVybHlpbmcAAAAAABMAAAAAAAAACHZlcmlmaWVyAAAAEwAAAAA=",
        "AAAAAAAAAEZUaGUgY29tbWl0bWVudCBhdCBsZWFmIGBpbmRleGAuIFBhbmljcyBpZiB0aGUgbGVhZiBkb2VzIG5vdCBleGlzdCB5ZXQuAAAAAAAEbGVhZgAAAAEAAAAAAAAABWluZGV4AAAAAAAABAAAAAEAAAAM",
        "AAAAAAAAAQFSZWFkIHVwIHRvIGBsaW1pdGAgbGVhdmVzIHN0YXJ0aW5nIGF0IGBzdGFydGAsIGZvciBhIGNsaWVudCByZWJ1aWxkaW5nCnRoZSBNZXJrbGUgdHJlZS4gYGxpbWl0YCBpcyBjYXBwZWQgYXQgW2BNQVhfTEVBVkVTX1BFUl9SRUFEYF0sIGFuZCB0aGUKcmVzdWx0IGlzIHRydW5jYXRlZCB3aGVyZSB0aGUgdHJlZSBlbmRzIChzbyBpdCBtYXkgYmUgc2hvcnRlciB0aGFuCnJlcXVlc3RlZCwgb3IgZW1wdHkgd2hlbiBgc3RhcnQgPj0gbmV4dF9pbmRleGApLgAAAAAAAAZsZWF2ZXMAAAAAAAIAAAAAAAAABXN0YXJ0AAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAAM",
        "AAAAAAAAAmhQYXkgb3V0IGEgY2xhaW0gZnJvbSB0aGUgdHJlYXN1cnkgdG8gYSByZWFsIFN0ZWxsYXIgYEFkZHJlc3NgIGJ5IHByb3ZpbmcKZmFtaWx5IG1lbWJlcnNoaXAgKyBjbGFpbSB0b2tlbiB3aXRoIHRoZSByZXVzZWQgcmVtaW50IGNpcmN1aXQgKHJlZGVlbQpwYXRoKS4KClB1YmxpYyBzaWduYWxzIG1hdGNoIGBJU25hcmtWZXJpZmllcmA6CmBbcm9vdCwgbnVsbGlmaWVyLCB0bywgYW1vdW50LCBpZCwgcmVkZWVtLCByZWxheWVyRmVlXWAgd2l0aCBgaWQgPSAwYAphbmQgYHJlZGVlbSA9IDFgLgoKVGhlIGNpcmN1aXQncyBgdG9gIHB1YmxpYyBpbnB1dCBpcyB0aGUgZmllbGQtZW5jb2Rpbmcgb2YgdGhlIHJlY2lwaWVudC4KV2UgZGVyaXZlIGl0IG9uLWNoYWluIGZyb20gdGhlIHJlYWwgYHRvYCAoc2VlIFtgdG9fZmllbGRgXSkgcmF0aGVyIHRoYW4KYWNjZXB0IGl0IGFzIGEgY2FsbGVyIHBhcmFtZXRlciwgc28gYSByZWxheWVyIGNhbm5vdCByZXVzZSBhIHZhbGlkIHByb29mCndpdGggYSBkaWZmZXJlbnQgcmVjaXBpZW50IGFuZCByZWRpcmVjdCB0aGUgcGF5b3V0IOKAlCB0aGUgZW5jb2RpbmcgaXMgdGhlCmNvbnZlbnRpb24gdGhlIGNsaWVudCBwcm92ZXIgTVVTVCByZXBsaWNhdGUuAAAABnJlbWludAAAAAAABgAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAEcm9vdAAAAAwAAAAAAAAACW51bGxpZmllcgAAAAAAAAwAAAAAAAAAC3JlbGF5ZXJfZmVlAAAAAAwAAAAAAAAABXByb29mAAAAAAAADgAAAAA=",
        "AAAAAAAAAfJEZXBvc2l0IGBhbW91bnRgIG9mIHRoZSB1bmRlcmx5aW5nIGFzc2V0IGludG8gdGhlIHRyZWFzdXJ5IGFuZCBpbnNlcnQgdGhlCmNsYWltIGNvbW1pdG1lbnQgKGBQb3NlaWRvbihhZGRyMjAsIGFtb3VudClgKSBpbnRvIHRoZSB0cmVlLiBSZXR1cm5zIHRoZQpsZWFmIGluZGV4LgoKVGhlIGNvbnRyYWN0IGNvbXB1dGVzIHRoZSBjb21taXRtZW50IGl0c2VsZiBmcm9tIGBhZGRyMjBgIGFuZCBgYW1vdW50YApyYXRoZXIgdGhhbiB0cnVzdGluZyBhIGNhbGxlci1zdXBwbGllZCBsZWFmOiB0aGUgY2lyY3VpdCBidWlsZHMgdGhlIHNhbWUKbGVhZiBhcyBgUG9zZWlkb24oYWRkcjIwLCBjb21taXRBbW91bnQpYCAoc2VlIGByZW1pbnQuY2lyY29tYCksIHNvIGJpbmRpbmcKdGhlIGxlYWYgdG8gdGhlIGRlcG9zaXRlZCBgYW1vdW50YCBoZXJlIGlzIHdoYXQgc3RvcHMgYSBmdW5kZXIgZnJvbQpjb21taXR0aW5nIHRvIGEgY2xhaW0gd29ydGggbW9yZSB0aGFuIHRoZXkgcGFpZCBpbi4AAAAAAAdkZXBvc2l0AAAAAAMAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhZGRyMjAAAAAAAAwAAAAAAAAABmFtb3VudAAAAAAACwAAAAEAAAAE",
        "AAAAAgAAAAAAAAAAAAAACUNvbmZpZ0tleQAAAAAAAAMAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAAAAAAAAAAAClVuZGVybHlpbmcAAAAAAAAAAAAAAAAACFZlcmlmaWVy",
        "AAAAAAAAAAAAAAAIdmVyaWZpZXIAAAAAAAAAAQAAABM=",
        "AAAABQAAAFxFbWl0dGVkIG9uIGByZW1pbnRgLCBmb3IgYW4gb2ZmLWNoYWluIGluZGV4ZXIgZm9sbG93aW5nIHBheW91dCBoaXN0b3J5LgpUb3BpYzogYCgiY2xhaW0iLClgLgAAAAAAAAAKQ2xhaW1FdmVudAAAAAAAAQAAAAVjbGFpbQAAAAAAAAMAAAAAAAAACW51bGxpZmllcgAAAAAAAAwAAAAAAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAAAAAAAC9OdW1iZXIgb2YgbGVhdmVzIChjb21taXRtZW50cykgaW5zZXJ0ZWQgc28gZmFyLgAAAAAKbmV4dF9pbmRleAAAAAAAAAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAKdW5kZXJseWluZwAAAAAAAAAAAAEAAAAT",
        "AAAABQAAAO9FbWl0dGVkIG9uIGBkZXBvc2l0YCwgZm9yIGFuIG9mZi1jaGFpbiBpbmRleGVyIHJlYnVpbGRpbmcgZGVwb3NpdCBoaXN0b3J5CmFuZCB0aGUgTWVya2xlIHRyZWUuIFRvcGljOiBgKCJkZXBvc2l0IiwpYC4gVGhlIGNvbW1pdG1lbnQgaGlkZXMgYGFkZHIyMGAsCnNvIHB1Ymxpc2hpbmcgaXQgbGVha3Mgbm90aGluZyBiZXlvbmQgd2hhdCB0aGUgcHVibGljIHVuZGVybHlpbmcgdHJhbnNmZXIKYWxyZWFkeSByZXZlYWxzLgAAAAAAAAAADERlcG9zaXRFdmVudAAAAAEAAAAHZGVwb3NpdAAAAAAEAAAAAAAAAAVpbmRleAAAAAAAAAQAAAAAAAAAAAAAAApjb21taXRtZW50AAAAAAAMAAAAAAAAAAAAAAAIbmV3X3Jvb3QAAAAMAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAAAAAAAAAAAAAMY3VycmVudF9yb290AAAAAAAAAAEAAAAM",
        "AAAAAAAAAAAAAAANaXNfa25vd25fcm9vdAAAAAAAAAEAAAAAAAAABHJvb3QAAAAMAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAARaXNfbnVsbGlmaWVyX3VzZWQAAAAAAAABAAAAAAAAAAludWxsaWZpZXIAAAAAAAAMAAAAAQAAAAE=",
        "AAAAAgAAAAAAAAAAAAAACU1lcmtsZUtleQAAAAAAAAYAAAAAAAAAAAAAAAlOZXh0SW5kZXgAAAAAAAAAAAAAAAAAAARSb290AAAAAQAAAAAAAAAEWmVybwAAAAEAAAAEAAAAAQAAAAAAAAAGRmlsbGVkAAAAAAABAAAABAAAAAEAAAAAAAAACUtub3duUm9vdAAAAAAAAAEAAAAMAAAAAQAAAMZUaGUgY29tbWl0bWVudCBzdG9yZWQgYXQgbGVhZiBgaW5kZXhgLiBVbmxpa2UgdGhlIGluY3JlbWVudGFsIFNvbGlkaXR5CnRyZWUsIHdlIGtlZXAgZXZlcnkgbGVhZiBzbyBhbiBvZmYtY2hhaW4gY2xpZW50IGNhbiByZWNvbnN0cnVjdCB0aGUgZnVsbAp0cmVlIChhbmQgaXRzIE1lcmtsZSBwYXRocykgZnJvbSBvbi1jaGFpbiBzdGF0ZSBhbG9uZS4AAAAAAARMZWFmAAAAAQAAAAQ=",
        "AAAAAgAAAAAAAAAAAAAAB051bGxLZXkAAAAAAQAAAAEAAAAAAAAABFVzZWQAAAABAAAADA==",
        "AAAABAAAADhFcnJvcnMgdGhhdCBjYW4gb2NjdXIgZHVyaW5nIEdyb3RoMTYgcHJvb2YgdmVyaWZpY2F0aW9uLgAAAAAAAAAMR3JvdGgxNkVycm9yAAAAAwAAACtUaGUgcGFpcmluZyBwcm9kdWN0IGRpZCBub3QgZXF1YWwgaWRlbnRpdHkuAAAAAAxJbnZhbGlkUHJvb2YAAAAAAAAAPVRoZSBwdWJsaWMgaW5wdXRzIGxlbmd0aCBkb2VzIG5vdCBtYXRjaCB0aGUgdmVyaWZpY2F0aW9uIGtleS4AAAAAAAAVTWFsZm9ybWVkUHVibGljSW5wdXRzAAAAAAAAAQAAAB5UaGUgcHJvb2YgYnl0ZXMgYXJlIG1hbGZvcm1lZC4AAAAAAA5NYWxmb3JtZWRQcm9vZgAAAAAAAg==",
        "AAAAAQAAAGpHcm90aDE2IHByb29mIGNvbXBvc2VkIG9mIHBvaW50cyBBLCBCLCBhbmQgQy4KRzIgcG9pbnQgQiB1c2VzIFNvcm9iYW4ncyBjMXx8YzAgKGltYWdpbmFyeXx8cmVhbCkgb3JkZXJpbmcuAAAAAAAAAAAADEdyb3RoMTZQcm9vZgAAAAMAAAAHUG9pbnQgQQAAAAABYQAAAAAAA+4AAABAAAAAB1BvaW50IEIAAAAAAWIAAAAAAAPuAAAAgAAAAAdQb2ludCBDAAAAAAFjAAAAAAAD7gAAAEA=",
        "AAAAAQAAAHhHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXkgZm9yIEJOMjU0IGN1cnZlIChieXRlLW9yaWVudGVkKS4KQWxsIEcyIHBvaW50cyB1c2UgU29yb2JhbidzIGMxfHxjMCAoaW1hZ2luYXJ5fHxyZWFsKSBvcmRlcmluZy4AAAAAAAAAFFZlcmlmaWNhdGlvbktleUJ5dGVzAAAABQAAAA5BbHBoYSBHMSBwb2ludAAAAAAABWFscGhhAAAAAAAD7gAAAEAAAAANQmV0YSBHMiBwb2ludAAAAAAAAARiZXRhAAAD7gAAAIAAAAAORGVsdGEgRzIgcG9pbnQAAAAAAAVkZWx0YQAAAAAAA+4AAACAAAAADkdhbW1hIEcyIHBvaW50AAAAAAAFZ2FtbWEAAAAAAAPuAAAAgAAAAB1JQyAocHVibGljIGlucHV0IGNvbW1pdG1lbnRzKQAAAAAAAAJpYwAAAAAD6gAAA+4AAABA" ]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<null>,
        leaf: this.txFromJSON<u256>,
        leaves: this.txFromJSON<Array<u256>>,
        remint: this.txFromJSON<null>,
        deposit: this.txFromJSON<u32>,
        verifier: this.txFromJSON<string>,
        next_index: this.txFromJSON<u32>,
        underlying: this.txFromJSON<string>,
        current_root: this.txFromJSON<u256>,
        is_known_root: this.txFromJSON<boolean>,
        is_nullifier_used: this.txFromJSON<boolean>
  }
}