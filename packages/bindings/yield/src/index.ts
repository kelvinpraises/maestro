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
    contractId: "CB2FUT7BJZUUSTAF2TGNU2JICY2WTPQBZUVU6TQ4AHYAGUKNHZZ4NYNM",
  }
} as const

export type DataKey = {tag: "Owner", values: void} | {tag: "Token", values: void} | {tag: "Principal", values: void} | {tag: "Liquid", values: void} | {tag: "Invested", values: void} | {tag: "Position", values: readonly [string]};

export interface Client {
  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  init: ({owner, token}: {owner: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Bring `amount` of the token into the vault as returnable principal.
   * `from` is whoever funds it (the Drips contract, or the owner directly).
   */
  deposit: ({from, amount}: {from: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a balances transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * (principal, liquid, invested).
   */
  balances: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [i128, i128, i128]>>

  /**
   * Construct and simulate a claim_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Skim accrued yield (`total − principal`) to `to`. Requires enough liquid.
   */
  claim_yield: ({to}: {to: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a open_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Move `amount` of liquid funds into `strategy`.
   */
  open_position: ({strategy, amount}: {strategy: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a close_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Pull everything back from `strategy`. Whatever exceeds the recorded
   * position is yield: it lands in `liquid` but does not reduce `invested`.
   */
  close_position: ({strategy}: {strategy: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a position_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  position_amount: ({strategy}: {strategy: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a return_principal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return up to `amount` of owed principal back to Drips (`to`).
   */
  return_principal: ({to, amount}: {to: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
      new ContractSpec([ "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAAFVG9rZW4AAAAAAAAAAAAAAAAAAAlQcmluY2lwYWwAAAAAAAAAAAAAAAAAAAZMaXF1aWQAAAAAAAAAAAAAAAAACEludmVzdGVkAAAAAQAAADZSZWNvcmRlZCBwcmluY2lwYWwgY3VycmVudGx5IGhlbGQgaW4gYSBnaXZlbiBzdHJhdGVneS4AAAAAAAhQb3NpdGlvbgAAAAEAAAAT",
        "AAAAAAAAAAAAAAAEaW5pdAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAA==",
        "AAAAAAAAAItCcmluZyBgYW1vdW50YCBvZiB0aGUgdG9rZW4gaW50byB0aGUgdmF1bHQgYXMgcmV0dXJuYWJsZSBwcmluY2lwYWwuCmBmcm9tYCBpcyB3aG9ldmVyIGZ1bmRzIGl0ICh0aGUgRHJpcHMgY29udHJhY3QsIG9yIHRoZSBvd25lciBkaXJlY3RseSkuAAAAAAdkZXBvc2l0AAAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
        "AAAAAAAAAB4ocHJpbmNpcGFsLCBsaXF1aWQsIGludmVzdGVkKS4AAAAAAAhiYWxhbmNlcwAAAAAAAAABAAAD7QAAAAMAAAALAAAACwAAAAs=",
        "AAAAAAAAAEtTa2ltIGFjY3J1ZWQgeWllbGQgKGB0b3RhbCDiiJIgcHJpbmNpcGFsYCkgdG8gYHRvYC4gUmVxdWlyZXMgZW5vdWdoIGxpcXVpZC4AAAAAC2NsYWltX3lpZWxkAAAAAAEAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAC5Nb3ZlIGBhbW91bnRgIG9mIGxpcXVpZCBmdW5kcyBpbnRvIGBzdHJhdGVneWAuAAAAAAANb3Blbl9wb3NpdGlvbgAAAAAAAAIAAAAAAAAACHN0cmF0ZWd5AAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAItQdWxsIGV2ZXJ5dGhpbmcgYmFjayBmcm9tIGBzdHJhdGVneWAuIFdoYXRldmVyIGV4Y2VlZHMgdGhlIHJlY29yZGVkCnBvc2l0aW9uIGlzIHlpZWxkOiBpdCBsYW5kcyBpbiBgbGlxdWlkYCBidXQgZG9lcyBub3QgcmVkdWNlIGBpbnZlc3RlZGAuAAAAAA5jbG9zZV9wb3NpdGlvbgAAAAAAAQAAAAAAAAAIc3RyYXRlZ3kAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAPcG9zaXRpb25fYW1vdW50AAAAAAEAAAAAAAAACHN0cmF0ZWd5AAAAEwAAAAEAAAAL",
        "AAAAAAAAAD1SZXR1cm4gdXAgdG8gYGFtb3VudGAgb2Ygb3dlZCBwcmluY2lwYWwgYmFjayB0byBEcmlwcyAoYHRvYCkuAAAAAAAAEHJldHVybl9wcmluY2lwYWwAAAACAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<null>,
        deposit: this.txFromJSON<null>,
        balances: this.txFromJSON<readonly [i128, i128, i128]>,
        claim_yield: this.txFromJSON<i128>,
        open_position: this.txFromJSON<null>,
        close_position: this.txFromJSON<i128>,
        position_amount: this.txFromJSON<i128>,
        return_principal: this.txFromJSON<null>
  }
}