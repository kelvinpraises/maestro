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
    contractId: "CAYENB4W7ALZPIPLAUPR64OSF47H52I5YL2QNKS5UUGRB65MNZBR7ZZE",
  }
} as const

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
   * Construct and simulate a verify transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Verify a Groth16 proof using the compile-time embedded verification key.
   * 
   * No persistent storage is read or written; the key is part of the
   * contract WASM itself.
   */
  verify: ({proof, public_inputs}: {proof: Groth16Proof, public_inputs: Array<u256>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>

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
      new ContractSpec([ "AAAAAAAAAKBWZXJpZnkgYSBHcm90aDE2IHByb29mIHVzaW5nIHRoZSBjb21waWxlLXRpbWUgZW1iZWRkZWQgdmVyaWZpY2F0aW9uIGtleS4KCk5vIHBlcnNpc3RlbnQgc3RvcmFnZSBpcyByZWFkIG9yIHdyaXR0ZW47IHRoZSBrZXkgaXMgcGFydCBvZiB0aGUKY29udHJhY3QgV0FTTSBpdHNlbGYuAAAABnZlcmlmeQAAAAAAAgAAAAAAAAAFcHJvb2YAAAAAAAfQAAAADEdyb3RoMTZQcm9vZgAAAAAAAAANcHVibGljX2lucHV0cwAAAAAAA+oAAAAMAAAAAQAAA+kAAAABAAAH0AAAAAxHcm90aDE2RXJyb3I=",
        "AAAABAAAADhFcnJvcnMgdGhhdCBjYW4gb2NjdXIgZHVyaW5nIEdyb3RoMTYgcHJvb2YgdmVyaWZpY2F0aW9uLgAAAAAAAAAMR3JvdGgxNkVycm9yAAAAAwAAACtUaGUgcGFpcmluZyBwcm9kdWN0IGRpZCBub3QgZXF1YWwgaWRlbnRpdHkuAAAAAAxJbnZhbGlkUHJvb2YAAAAAAAAAPVRoZSBwdWJsaWMgaW5wdXRzIGxlbmd0aCBkb2VzIG5vdCBtYXRjaCB0aGUgdmVyaWZpY2F0aW9uIGtleS4AAAAAAAAVTWFsZm9ybWVkUHVibGljSW5wdXRzAAAAAAAAAQAAAB5UaGUgcHJvb2YgYnl0ZXMgYXJlIG1hbGZvcm1lZC4AAAAAAA5NYWxmb3JtZWRQcm9vZgAAAAAAAg==",
        "AAAAAQAAAGpHcm90aDE2IHByb29mIGNvbXBvc2VkIG9mIHBvaW50cyBBLCBCLCBhbmQgQy4KRzIgcG9pbnQgQiB1c2VzIFNvcm9iYW4ncyBjMXx8YzAgKGltYWdpbmFyeXx8cmVhbCkgb3JkZXJpbmcuAAAAAAAAAAAADEdyb3RoMTZQcm9vZgAAAAMAAAAHUG9pbnQgQQAAAAABYQAAAAAAA+4AAABAAAAAB1BvaW50IEIAAAAAAWIAAAAAAAPuAAAAgAAAAAdQb2ludCBDAAAAAAFjAAAAAAAD7gAAAEA=",
        "AAAAAQAAAHhHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXkgZm9yIEJOMjU0IGN1cnZlIChieXRlLW9yaWVudGVkKS4KQWxsIEcyIHBvaW50cyB1c2UgU29yb2JhbidzIGMxfHxjMCAoaW1hZ2luYXJ5fHxyZWFsKSBvcmRlcmluZy4AAAAAAAAAFFZlcmlmaWNhdGlvbktleUJ5dGVzAAAABQAAAA5BbHBoYSBHMSBwb2ludAAAAAAABWFscGhhAAAAAAAD7gAAAEAAAAANQmV0YSBHMiBwb2ludAAAAAAAAARiZXRhAAAD7gAAAIAAAAAORGVsdGEgRzIgcG9pbnQAAAAAAAVkZWx0YQAAAAAAA+4AAACAAAAADkdhbW1hIEcyIHBvaW50AAAAAAAFZ2FtbWEAAAAAAAPuAAAAgAAAAB1JQyAocHVibGljIGlucHV0IGNvbW1pdG1lbnRzKQAAAAAAAAJpYwAAAAAD6gAAA+4AAABA" ]),
      options
    )
  }
  public readonly fromJSON = {
    verify: this.txFromJSON<Result<boolean>>
  }
}