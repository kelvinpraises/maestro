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
    contractId: "CDS3QC62A73QYVNNZYHTLZ2NZJG5BCFENDDZGT3CM2WVT6YRU3COHQUK",
  }
} as const

export type ConfigKey = {tag: "Admin", values: void} | {tag: "Underlying", values: void} | {tag: "Verifier", values: void};

export type MerkleKey = {tag: "NextIndex", values: void} | {tag: "Root", values: void} | {tag: "Zero", values: readonly [u32]} | {tag: "Filled", values: readonly [u32]} | {tag: "KnownRoot", values: readonly [u256]};

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
   * Construct and simulate a remint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Withdraw a note from the pool to a real Stellar `Address` by proving
   * membership + nullifier with the reused remint circuit (redeem path).
   * 
   * Public signals match `ISnarkVerifier`:
   * `[root, nullifier, to, amount, id, redeem, relayerFee]` with `id = 0`
   * and `redeem = 1`.
   * 
   * `to_field` is the field-encoding of `to` used when the proof was
   * generated. TODO(hardening): derive `to_field` on-chain from `to`
   * (`sha256` of its XDR) to bind the recipient against relayer
   * front-running, as Nethermind's pool binds via `ext_data_hash`.
   */
  remint: ({to, to_field, amount, root, nullifier, relayer_fee, proof}: {to: string, to_field: u256, amount: i128, root: u256, nullifier: u256, relayer_fee: u256, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deposit `amount` of the underlying asset into the pool and insert the
   * caller-computed commitment (`Poseidon(addr20, amount)`) into the tree.
   * Returns the leaf index.
   */
  deposit: ({from, commitment, amount}: {from: string, commitment: u256, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  verifier: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

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
        "AAAAAAAAAgdXaXRoZHJhdyBhIG5vdGUgZnJvbSB0aGUgcG9vbCB0byBhIHJlYWwgU3RlbGxhciBgQWRkcmVzc2AgYnkgcHJvdmluZwptZW1iZXJzaGlwICsgbnVsbGlmaWVyIHdpdGggdGhlIHJldXNlZCByZW1pbnQgY2lyY3VpdCAocmVkZWVtIHBhdGgpLgoKUHVibGljIHNpZ25hbHMgbWF0Y2ggYElTbmFya1ZlcmlmaWVyYDoKYFtyb290LCBudWxsaWZpZXIsIHRvLCBhbW91bnQsIGlkLCByZWRlZW0sIHJlbGF5ZXJGZWVdYCB3aXRoIGBpZCA9IDBgCmFuZCBgcmVkZWVtID0gMWAuCgpgdG9fZmllbGRgIGlzIHRoZSBmaWVsZC1lbmNvZGluZyBvZiBgdG9gIHVzZWQgd2hlbiB0aGUgcHJvb2Ygd2FzCmdlbmVyYXRlZC4gVE9ETyhoYXJkZW5pbmcpOiBkZXJpdmUgYHRvX2ZpZWxkYCBvbi1jaGFpbiBmcm9tIGB0b2AKKGBzaGEyNTZgIG9mIGl0cyBYRFIpIHRvIGJpbmQgdGhlIHJlY2lwaWVudCBhZ2FpbnN0IHJlbGF5ZXIKZnJvbnQtcnVubmluZywgYXMgTmV0aGVybWluZCdzIHBvb2wgYmluZHMgdmlhIGBleHRfZGF0YV9oYXNoYC4AAAAABnJlbWludAAAAAAABwAAAAAAAAACdG8AAAAAABMAAAAAAAAACHRvX2ZpZWxkAAAADAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAARyb290AAAADAAAAAAAAAAJbnVsbGlmaWVyAAAAAAAADAAAAAAAAAALcmVsYXllcl9mZWUAAAAADAAAAAAAAAAFcHJvb2YAAAAAAAAOAAAAAA==",
        "AAAAAAAAAKREZXBvc2l0IGBhbW91bnRgIG9mIHRoZSB1bmRlcmx5aW5nIGFzc2V0IGludG8gdGhlIHBvb2wgYW5kIGluc2VydCB0aGUKY2FsbGVyLWNvbXB1dGVkIGNvbW1pdG1lbnQgKGBQb3NlaWRvbihhZGRyMjAsIGFtb3VudClgKSBpbnRvIHRoZSB0cmVlLgpSZXR1cm5zIHRoZSBsZWFmIGluZGV4LgAAAAdkZXBvc2l0AAAAAAMAAAAAAAAABGZyb20AAAATAAAAAAAAAApjb21taXRtZW50AAAAAAAMAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAABA==",
        "AAAAAgAAAAAAAAAAAAAACUNvbmZpZ0tleQAAAAAAAAMAAAAAAAAAAAAAAAVBZG1pbgAAAAAAAAAAAAAAAAAAClVuZGVybHlpbmcAAAAAAAAAAAAAAAAACFZlcmlmaWVy",
        "AAAAAAAAAAAAAAAIdmVyaWZpZXIAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAKdW5kZXJseWluZwAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAMY3VycmVudF9yb290AAAAAAAAAAEAAAAM",
        "AAAAAAAAAAAAAAANaXNfa25vd25fcm9vdAAAAAAAAAEAAAAAAAAABHJvb3QAAAAMAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAARaXNfbnVsbGlmaWVyX3VzZWQAAAAAAAABAAAAAAAAAAludWxsaWZpZXIAAAAAAAAMAAAAAQAAAAE=",
        "AAAAAgAAAAAAAAAAAAAACU1lcmtsZUtleQAAAAAAAAUAAAAAAAAAAAAAAAlOZXh0SW5kZXgAAAAAAAAAAAAAAAAAAARSb290AAAAAQAAAAAAAAAEWmVybwAAAAEAAAAEAAAAAQAAAAAAAAAGRmlsbGVkAAAAAAABAAAABAAAAAEAAAAAAAAACUtub3duUm9vdAAAAAAAAAEAAAAM",
        "AAAAAgAAAAAAAAAAAAAAB051bGxLZXkAAAAAAQAAAAEAAAAAAAAABFVzZWQAAAABAAAADA==",
        "AAAABAAAADhFcnJvcnMgdGhhdCBjYW4gb2NjdXIgZHVyaW5nIEdyb3RoMTYgcHJvb2YgdmVyaWZpY2F0aW9uLgAAAAAAAAAMR3JvdGgxNkVycm9yAAAAAwAAACtUaGUgcGFpcmluZyBwcm9kdWN0IGRpZCBub3QgZXF1YWwgaWRlbnRpdHkuAAAAAAxJbnZhbGlkUHJvb2YAAAAAAAAAPVRoZSBwdWJsaWMgaW5wdXRzIGxlbmd0aCBkb2VzIG5vdCBtYXRjaCB0aGUgdmVyaWZpY2F0aW9uIGtleS4AAAAAAAAVTWFsZm9ybWVkUHVibGljSW5wdXRzAAAAAAAAAQAAAB5UaGUgcHJvb2YgYnl0ZXMgYXJlIG1hbGZvcm1lZC4AAAAAAA5NYWxmb3JtZWRQcm9vZgAAAAAAAg==",
        "AAAAAQAAAGpHcm90aDE2IHByb29mIGNvbXBvc2VkIG9mIHBvaW50cyBBLCBCLCBhbmQgQy4KRzIgcG9pbnQgQiB1c2VzIFNvcm9iYW4ncyBjMXx8YzAgKGltYWdpbmFyeXx8cmVhbCkgb3JkZXJpbmcuAAAAAAAAAAAADEdyb3RoMTZQcm9vZgAAAAMAAAAHUG9pbnQgQQAAAAABYQAAAAAAA+4AAABAAAAAB1BvaW50IEIAAAAAAWIAAAAAAAPuAAAAgAAAAAdQb2ludCBDAAAAAAFjAAAAAAAD7gAAAEA=",
        "AAAAAQAAAHhHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXkgZm9yIEJOMjU0IGN1cnZlIChieXRlLW9yaWVudGVkKS4KQWxsIEcyIHBvaW50cyB1c2UgU29yb2JhbidzIGMxfHxjMCAoaW1hZ2luYXJ5fHxyZWFsKSBvcmRlcmluZy4AAAAAAAAAFFZlcmlmaWNhdGlvbktleUJ5dGVzAAAABQAAAA5BbHBoYSBHMSBwb2ludAAAAAAABWFscGhhAAAAAAAD7gAAAEAAAAANQmV0YSBHMiBwb2ludAAAAAAAAARiZXRhAAAD7gAAAIAAAAAORGVsdGEgRzIgcG9pbnQAAAAAAAVkZWx0YQAAAAAAA+4AAACAAAAADkdhbW1hIEcyIHBvaW50AAAAAAAFZ2FtbWEAAAAAAAPuAAAAgAAAAB1JQyAocHVibGljIGlucHV0IGNvbW1pdG1lbnRzKQAAAAAAAAJpYwAAAAAD6gAAA+4AAABA" ]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<null>,
        remint: this.txFromJSON<null>,
        deposit: this.txFromJSON<u32>,
        verifier: this.txFromJSON<string>,
        underlying: this.txFromJSON<string>,
        current_root: this.txFromJSON<u256>,
        is_known_root: this.txFromJSON<boolean>,
        is_nullifier_used: this.txFromJSON<boolean>
  }
}