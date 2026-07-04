import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { i128 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const networks: {
    readonly testnet: {
        readonly networkPassphrase: "Test SDF Network ; September 2015";
        readonly contractId: "CAQKJBXQRRF4EUQWUZWHO2YBNUED6H5L5HTHAUZKBDZ2MCQTAF4DV2FB";
    };
};
export type DataKey = {
    tag: "Owner";
    values: void;
} | {
    tag: "Token";
    values: void;
} | {
    tag: "Principal";
    values: void;
} | {
    tag: "Liquid";
    values: void;
} | {
    tag: "Invested";
    values: void;
} | {
    tag: "Position";
    values: readonly [string];
};
export interface Client {
    /**
     * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    init: ({ owner, token }: {
        owner: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a deposit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Bring `amount` of the token into the vault as returnable principal.
     * `from` is whoever funds it (the Drips contract, or the owner directly).
     */
    deposit: ({ from, amount }: {
        from: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a balances transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * (principal, liquid, invested).
     */
    balances: (options?: MethodOptions) => Promise<AssembledTransaction<readonly [i128, i128, i128]>>;
    /**
     * Construct and simulate a claim_yield transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Skim accrued yield (`total − principal`) to `to`. Requires enough liquid.
     */
    claim_yield: ({ to }: {
        to: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a open_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Move `amount` of liquid funds into `strategy`.
     */
    open_position: ({ strategy, amount }: {
        strategy: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a close_position transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Pull everything back from `strategy`. Whatever exceeds the recorded
     * position is yield: it lands in `liquid` but does not reduce `invested`.
     */
    close_position: ({ strategy }: {
        strategy: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a position_amount transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    position_amount: ({ strategy }: {
        strategy: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<i128>>;
    /**
     * Construct and simulate a return_principal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Return up to `amount` of owed principal back to Drips (`to`).
     */
    return_principal: ({ to, amount }: {
        to: string;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
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
        init: (json: string) => AssembledTransaction<null>;
        deposit: (json: string) => AssembledTransaction<null>;
        balances: (json: string) => AssembledTransaction<readonly [bigint, bigint, bigint]>;
        claim_yield: (json: string) => AssembledTransaction<bigint>;
        open_position: (json: string) => AssembledTransaction<null>;
        close_position: (json: string) => AssembledTransaction<bigint>;
        position_amount: (json: string) => AssembledTransaction<bigint>;
        return_principal: (json: string) => AssembledTransaction<null>;
    };
}
