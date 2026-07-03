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
    contractId: "CBKYQ357VMHM4RVM6QK2UO324RSM75DD66LGFAOCDGJZCOWSERSEKHVH",
  }
} as const

export type SplitsKey = {tag: "Config", values: readonly [string]} | {tag: "Splittable", values: readonly [string, string]} | {tag: "Collectable", values: readonly [string, string]};


export interface SplitsReceiver {
  account: string;
  weight: u32;
}


/**
 * Per-cycle delta pair. `this_cycle` applies to the cycle it is keyed under;
 * `next_cycle` is carried into the following cycle. A point-in-time rate change
 * is expressed as deltas in two cycles so whole-cycle summation stays exact.
 */
export interface AmtDelta {
  next_cycle: i128;
  this_cycle: i128;
}

export type StreamsKey = {tag: "CycleSecs", values: void} | {tag: "State", values: readonly [string, string]} | {tag: "Receivers", values: readonly [string, string]} | {tag: "Delta", values: readonly [string, string, u64]};


/**
 * One stream's settings. `start == 0` means "from the configuration time";
 * `duration == 0` means "until the balance runs out" (i.e. to `max_end`).
 */
export interface StreamConfig {
  amt_per_sec: i128;
  duration: u64;
  start: u64;
  stream_id: u64;
}


/**
 * Per (token, account) sender/receiver snapshot.
 */
export interface StreamsState {
  /**
 * Sender balance snapshot at `update_time`.
 */
balance: i128;
  /**
 * Timestamp at which this sender's balance is exhausted.
 */
max_end: u64;
  /**
 * Earliest cycle not yet received (0 = nothing receivable yet).
 */
next_receivable_cycle: u64;
  /**
 * Time of the last `set_streams` for this account (as a sender).
 */
update_time: u64;
}


export interface StreamReceiver {
  account: string;
  config: StreamConfig;
}


/**
 * Preprocessed stream window used by `calc_max_end`.
 */
export interface ProcessedConfig {
  amt_per_sec: i128;
  end: u64;
  start: u64;
}

export interface Client {
  /**
   * Construct and simulate a give transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `from` gives `amt` of `token` directly into `receiver`'s splittable
   * balance, transferring the underlying into the vault.
   */
  give: ({from, receiver, token, amt}: {from: string, receiver: string, token: string, amt: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * One-time setup of the global streams cycle length (seconds).
   */
  init: ({cycle_secs}: {cycle_secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a split transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  split: ({account, token}: {account: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [i128, i128]>>

  /**
   * Construct and simulate a collect transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Collect `account`'s collectable balance of `token` and pay it out to `to`.
   */
  collect: ({account, token, to}: {account: string, token: string, to: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a balance_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  balance_at: ({account, token, timestamp}: {account: string, token: string, timestamp: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_splits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_splits: ({account, receivers}: {account: string, receivers: Array<SplitsReceiver>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a splittable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  splittable: ({account, token}: {account: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a collectable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  collectable: ({account, token}: {account: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a set_streams transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Configure `account`'s streams of `token`. `balance_delta > 0` tops the
   * stream up; `< 0` withdraws. Returns the real delta applied.
   */
  set_streams: ({account, token, new_receivers, balance_delta, max_end_hint1, max_end_hint2}: {account: string, token: string, new_receivers: Array<StreamReceiver>, balance_delta: i128, max_end_hint1: u64, max_end_hint2: u64}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a streams_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * (next_receivable_cycle, update_time, max_end, balance).
   */
  streams_state: ({account, token}: {account: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, u64, u64, i128]>>

  /**
   * Construct and simulate a receive_streams transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Receive up to `max_cycles` whole elapsed cycles for `account`; the
   * received amount is credited to the account's splittable balance.
   */
  receive_streams: ({account, token, max_cycles}: {account: string, token: string, max_cycles: u32}, options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a receivable_streams_cycles transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  receivable_streams_cycles: ({account, token}: {account: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

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
      new ContractSpec([ "AAAAAAAAAHhgZnJvbWAgZ2l2ZXMgYGFtdGAgb2YgYHRva2VuYCBkaXJlY3RseSBpbnRvIGByZWNlaXZlcmAncyBzcGxpdHRhYmxlCmJhbGFuY2UsIHRyYW5zZmVycmluZyB0aGUgdW5kZXJseWluZyBpbnRvIHRoZSB2YXVsdC4AAAAEZ2l2ZQAAAAQAAAAAAAAABGZyb20AAAATAAAAAAAAAAhyZWNlaXZlcgAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAADYW10AAAAAAsAAAAA",
        "AAAAAAAAADxPbmUtdGltZSBzZXR1cCBvZiB0aGUgZ2xvYmFsIHN0cmVhbXMgY3ljbGUgbGVuZ3RoIChzZWNvbmRzKS4AAAAEaW5pdAAAAAEAAAAAAAAACmN5Y2xlX3NlY3MAAAAAAAYAAAAA",
        "AAAAAAAAAAAAAAAFc3BsaXQAAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPtAAAAAgAAAAsAAAAL",
        "AAAAAAAAAEpDb2xsZWN0IGBhY2NvdW50YCdzIGNvbGxlY3RhYmxlIGJhbGFuY2Ugb2YgYHRva2VuYCBhbmQgcGF5IGl0IG91dCB0byBgdG9gLgAAAAAAB2NvbGxlY3QAAAAAAwAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAKYmFsYW5jZV9hdAAAAAAAAwAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACXRpbWVzdGFtcAAAAAAAAAYAAAABAAAACw==",
        "AAAAAAAAAAAAAAAKc2V0X3NwbGl0cwAAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAlyZWNlaXZlcnMAAAAAAAPqAAAH0AAAAA5TcGxpdHNSZWNlaXZlcgAAAAAAAA==",
        "AAAAAAAAAAAAAAAKc3BsaXR0YWJsZQAAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAAAAAAALY29sbGVjdGFibGUAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAACw==",
        "AAAAAAAAAIJDb25maWd1cmUgYGFjY291bnRgJ3Mgc3RyZWFtcyBvZiBgdG9rZW5gLiBgYmFsYW5jZV9kZWx0YSA+IDBgIHRvcHMgdGhlCnN0cmVhbSB1cDsgYDwgMGAgd2l0aGRyYXdzLiBSZXR1cm5zIHRoZSByZWFsIGRlbHRhIGFwcGxpZWQuAAAAAAALc2V0X3N0cmVhbXMAAAAABgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADW5ld19yZWNlaXZlcnMAAAAAAAPqAAAH0AAAAA5TdHJlYW1SZWNlaXZlcgAAAAAAAAAAAA1iYWxhbmNlX2RlbHRhAAAAAAAACwAAAAAAAAANbWF4X2VuZF9oaW50MQAAAAAAAAYAAAAAAAAADW1heF9lbmRfaGludDIAAAAAAAAGAAAAAQAAAAs=",
        "AAAAAAAAADcobmV4dF9yZWNlaXZhYmxlX2N5Y2xlLCB1cGRhdGVfdGltZSwgbWF4X2VuZCwgYmFsYW5jZSkuAAAAAA1zdHJlYW1zX3N0YXRlAAAAAAAAAgAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD7QAAAAQAAAAGAAAABgAAAAYAAAAL",
        "AAAAAAAAAINSZWNlaXZlIHVwIHRvIGBtYXhfY3ljbGVzYCB3aG9sZSBlbGFwc2VkIGN5Y2xlcyBmb3IgYGFjY291bnRgOyB0aGUKcmVjZWl2ZWQgYW1vdW50IGlzIGNyZWRpdGVkIHRvIHRoZSBhY2NvdW50J3Mgc3BsaXR0YWJsZSBiYWxhbmNlLgAAAAAPcmVjZWl2ZV9zdHJlYW1zAAAAAAMAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAptYXhfY3ljbGVzAAAAAAAEAAAAAQAAAAs=",
        "AAAAAAAAAAAAAAAZcmVjZWl2YWJsZV9zdHJlYW1zX2N5Y2xlcwAAAAAAAAIAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAY=",
        "AAAAAgAAAAAAAAAAAAAACVNwbGl0c0tleQAAAAAAAAMAAAABAAAAKUNvbmZpZ3VyZWQgcmVjZWl2ZXJzIGxpc3QgZm9yIGFuIGFjY291bnQuAAAAAAAABkNvbmZpZwAAAAAAAQAAABMAAAABAAAANVJlY2VpdmVkLWJ1dC1ub3Qtc3BsaXQgYmFsYW5jZSwgcGVyIChhY2NvdW50LCB0b2tlbikuAAAAAAAAClNwbGl0dGFibGUAAAAAAAIAAAATAAAAEwAAAAEAAAA2U3BsaXQsIHJlYWR5LXRvLWNvbGxlY3QgYmFsYW5jZSwgcGVyIChhY2NvdW50LCB0b2tlbikuAAAAAAALQ29sbGVjdGFibGUAAAAAAgAAABMAAAAT",
        "AAAAAQAAAAAAAAAAAAAADlNwbGl0c1JlY2VpdmVyAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABndlaWdodAAAAAAABA==",
        "AAAAAQAAAONQZXItY3ljbGUgZGVsdGEgcGFpci4gYHRoaXNfY3ljbGVgIGFwcGxpZXMgdG8gdGhlIGN5Y2xlIGl0IGlzIGtleWVkIHVuZGVyOwpgbmV4dF9jeWNsZWAgaXMgY2FycmllZCBpbnRvIHRoZSBmb2xsb3dpbmcgY3ljbGUuIEEgcG9pbnQtaW4tdGltZSByYXRlIGNoYW5nZQppcyBleHByZXNzZWQgYXMgZGVsdGFzIGluIHR3byBjeWNsZXMgc28gd2hvbGUtY3ljbGUgc3VtbWF0aW9uIHN0YXlzIGV4YWN0LgAAAAAAAAAACEFtdERlbHRhAAAAAgAAAAAAAAAKbmV4dF9jeWNsZQAAAAAACwAAAAAAAAAKdGhpc19jeWNsZQAAAAAACw==",
        "AAAAAgAAAAAAAAAAAAAAClN0cmVhbXNLZXkAAAAAAAQAAAAAAAAAMkdsb2JhbCBjeWNsZSBsZW5ndGggaW4gc2Vjb25kcyAoc2V0IG9uY2UgYXQgaW5pdCkuAAAAAAAJQ3ljbGVTZWNzAAAAAAAAAQAAACEodG9rZW4sIGFjY291bnQpIC0+IFN0cmVhbXNTdGF0ZS4AAAAAAAAFU3RhdGUAAAAAAAACAAAAEwAAABMAAAABAAAAKyh0b2tlbiwgYWNjb3VudCkgLT4gY3VycmVudCByZWNlaXZlcnMgbGlzdC4AAAAACVJlY2VpdmVycwAAAAAAAAIAAAATAAAAEwAAAAEAAAAkKHRva2VuLCBhY2NvdW50LCBjeWNsZSkgLT4gQW10RGVsdGEuAAAABURlbHRhAAAAAAAAAwAAABMAAAATAAAABg==",
        "AAAAAQAAAJBPbmUgc3RyZWFtJ3Mgc2V0dGluZ3MuIGBzdGFydCA9PSAwYCBtZWFucyAiZnJvbSB0aGUgY29uZmlndXJhdGlvbiB0aW1lIjsKYGR1cmF0aW9uID09IDBgIG1lYW5zICJ1bnRpbCB0aGUgYmFsYW5jZSBydW5zIG91dCIgKGkuZS4gdG8gYG1heF9lbmRgKS4AAAAAAAAADFN0cmVhbUNvbmZpZwAAAAQAAAAAAAAAC2FtdF9wZXJfc2VjAAAAAAsAAAAAAAAACGR1cmF0aW9uAAAABgAAAAAAAAAFc3RhcnQAAAAAAAAGAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAG",
        "AAAAAQAAAC5QZXIgKHRva2VuLCBhY2NvdW50KSBzZW5kZXIvcmVjZWl2ZXIgc25hcHNob3QuAAAAAAAAAAAADFN0cmVhbXNTdGF0ZQAAAAQAAAApU2VuZGVyIGJhbGFuY2Ugc25hcHNob3QgYXQgYHVwZGF0ZV90aW1lYC4AAAAAAAAHYmFsYW5jZQAAAAALAAAANlRpbWVzdGFtcCBhdCB3aGljaCB0aGlzIHNlbmRlcidzIGJhbGFuY2UgaXMgZXhoYXVzdGVkLgAAAAAAB21heF9lbmQAAAAABgAAAD1FYXJsaWVzdCBjeWNsZSBub3QgeWV0IHJlY2VpdmVkICgwID0gbm90aGluZyByZWNlaXZhYmxlIHlldCkuAAAAAAAAFW5leHRfcmVjZWl2YWJsZV9jeWNsZQAAAAAAAAYAAAA+VGltZSBvZiB0aGUgbGFzdCBgc2V0X3N0cmVhbXNgIGZvciB0aGlzIGFjY291bnQgKGFzIGEgc2VuZGVyKS4AAAAAAAt1cGRhdGVfdGltZQAAAAAG",
        "AAAAAQAAAAAAAAAAAAAADlN0cmVhbVJlY2VpdmVyAAAAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABmNvbmZpZwAAAAAH0AAAAAxTdHJlYW1Db25maWc=",
        "AAAAAQAAADJQcmVwcm9jZXNzZWQgc3RyZWFtIHdpbmRvdyB1c2VkIGJ5IGBjYWxjX21heF9lbmRgLgAAAAAAAAAAAA9Qcm9jZXNzZWRDb25maWcAAAAAAwAAAAAAAAALYW10X3Blcl9zZWMAAAAACwAAAAAAAAADZW5kAAAAAAYAAAAAAAAABXN0YXJ0AAAAAAAABg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    give: this.txFromJSON<null>,
        init: this.txFromJSON<null>,
        split: this.txFromJSON<readonly [i128, i128]>,
        collect: this.txFromJSON<i128>,
        balance_at: this.txFromJSON<i128>,
        set_splits: this.txFromJSON<null>,
        splittable: this.txFromJSON<i128>,
        collectable: this.txFromJSON<i128>,
        set_streams: this.txFromJSON<i128>,
        streams_state: this.txFromJSON<readonly [u64, u64, u64, i128]>,
        receive_streams: this.txFromJSON<i128>,
        receivable_streams_cycles: this.txFromJSON<u64>
  }
}