import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, u64, i128 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const networks: {
    readonly testnet: {
        readonly networkPassphrase: "Test SDF Network ; September 2015";
        readonly contractId: "CBKYQ357VMHM4RVM6QK2UO324RSM75DD66LGFAOCDGJZCOWSERSEKHVH";
    };
};
export type SplitsKey = {
    tag: "Config";
    values: readonly [string];
} | {
    tag: "Splittable";
    values: readonly [string, string];
} | {
    tag: "Collectable";
    values: readonly [string, string];
};
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
export type StreamsKey = {
    tag: "CycleSecs";
    values: void;
} | {
    tag: "State";
    values: readonly [string, string];
} | {
    tag: "Receivers";
    values: readonly [string, string];
} | {
    tag: "Delta";
    values: readonly [string, string, u64];
};
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
    give: ({ from, receiver, token, amt }: {
        from: string;
        receiver: string;
        token: string;
        amt: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * One-time setup of the global streams cycle length (seconds).
     */
    init: ({ cycle_secs }: {
        cycle_secs: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a split transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    split: ({ account, token }: {
        account: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<readonly [i128, i128]>>;
    /**
     * Construct and simulate a collect transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Collect `account`'s collectable balance of `token` and pay it out to `to`.
     */
    collect: ({ account, token, to }: {
        account: string;
        token: string;
        to: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a balance_at transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    balance_at: ({ account, token, timestamp }: {
        account: string;
        token: string;
        timestamp: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a set_splits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_splits: ({ account, receivers }: {
        account: string;
        receivers: Array<SplitsReceiver>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a splittable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    splittable: ({ account, token }: {
        account: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a collectable transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    collectable: ({ account, token }: {
        account: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a set_streams transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Configure `account`'s streams of `token`. `balance_delta > 0` tops the
     * stream up; `< 0` withdraws. Returns the real delta applied.
     */
    set_streams: ({ account, token, new_receivers, balance_delta, max_end_hint1, max_end_hint2 }: {
        account: string;
        token: string;
        new_receivers: Array<StreamReceiver>;
        balance_delta: i128;
        max_end_hint1: u64;
        max_end_hint2: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a streams_state transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * (next_receivable_cycle, update_time, max_end, balance).
     */
    streams_state: ({ account, token }: {
        account: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<readonly [u64, u64, u64, i128]>>;
    /**
     * Construct and simulate a receive_streams transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Receive up to `max_cycles` whole elapsed cycles for `account`; the
     * received amount is credited to the account's splittable balance.
     */
    receive_streams: ({ account, token, max_cycles }: {
        account: string;
        token: string;
        max_cycles: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a receivable_streams_cycles transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    receivable_streams_cycles: ({ account, token }: {
        account: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u64>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions & Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
    }): Promise<AssembledTransaction<T>>;
    constructor(options: ContractClientOptions);
    readonly fromJSON: {
        give: (json: string) => AssembledTransaction<null>;
        init: (json: string) => AssembledTransaction<null>;
        split: (json: string) => AssembledTransaction<readonly [bigint, bigint]>;
        collect: (json: string) => AssembledTransaction<bigint>;
        balance_at: (json: string) => AssembledTransaction<bigint>;
        set_splits: (json: string) => AssembledTransaction<null>;
        splittable: (json: string) => AssembledTransaction<bigint>;
        collectable: (json: string) => AssembledTransaction<bigint>;
        set_streams: (json: string) => AssembledTransaction<bigint>;
        streams_state: (json: string) => AssembledTransaction<readonly [bigint, bigint, bigint, bigint]>;
        receive_streams: (json: string) => AssembledTransaction<bigint>;
        receivable_streams_cycles: (json: string) => AssembledTransaction<bigint>;
    };
}
