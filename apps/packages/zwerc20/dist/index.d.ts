import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions } from "@stellar/stellar-sdk/contract";
import type { u32, i128, u256 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const networks: {
    readonly testnet: {
        readonly networkPassphrase: "Test SDF Network ; September 2015";
        readonly contractId: "CB4NCPRKEW4PQVCE74SGS42OAEMV75ULJTYHHZDC5UOVXGOBEAJF6PJH";
    };
};
export type ConfigKey = {
    tag: "Admin";
    values: void;
} | {
    tag: "Underlying";
    values: void;
} | {
    tag: "Verifier";
    values: void;
};
export type MerkleKey = {
    tag: "NextIndex";
    values: void;
} | {
    tag: "Root";
    values: void;
} | {
    tag: "Zero";
    values: readonly [u32];
} | {
    tag: "Filled";
    values: readonly [u32];
} | {
    tag: "KnownRoot";
    values: readonly [u256];
} | {
    tag: "Leaf";
    values: readonly [u32];
};
export type NullKey = {
    tag: "Used";
    values: readonly [u256];
};
/**
 * Errors that can occur during Groth16 proof verification.
 */
export declare const Groth16Error: {
    /**
     * The pairing product did not equal identity.
     */
    0: {
        message: string;
    };
    /**
     * The public inputs length does not match the verification key.
     */
    1: {
        message: string;
    };
    /**
     * The proof bytes are malformed.
     */
    2: {
        message: string;
    };
};
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
    init: ({ admin, underlying, verifier }: {
        admin: string;
        underlying: string;
        verifier: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
    /**
     * Construct and simulate a leaf transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * The commitment at leaf `index`. Panics if the leaf does not exist yet.
     */
    leaf: ({ index }: {
        index: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u256>>;
    /**
     * Construct and simulate a leaves transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Read up to `limit` leaves starting at `start`, for a client rebuilding
     * the Merkle tree. `limit` is capped at [`MAX_LEAVES_PER_READ`], and the
     * result is truncated where the tree ends (so it may be shorter than
     * requested, or empty when `start >= next_index`).
     */
    leaves: ({ start, limit }: {
        start: u32;
        limit: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Array<u256>>>;
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
    remint: ({ to, amount, root, nullifier, relayer_fee, proof }: {
        to: string;
        amount: i128;
        root: u256;
        nullifier: u256;
        relayer_fee: u256;
        proof: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<null>>;
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
    deposit: ({ from, addr20, amount }: {
        from: string;
        addr20: u256;
        amount: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<u32>>;
    /**
     * Construct and simulate a verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    verifier: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a next_index transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Number of leaves (commitments) inserted so far.
     */
    next_index: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>;
    /**
     * Construct and simulate a underlying transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    underlying: (options?: MethodOptions) => Promise<AssembledTransaction<string>>;
    /**
     * Construct and simulate a current_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    current_root: (options?: MethodOptions) => Promise<AssembledTransaction<u256>>;
    /**
     * Construct and simulate a is_known_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    is_known_root: ({ root }: {
        root: u256;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
    /**
     * Construct and simulate a is_nullifier_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    is_nullifier_used: ({ nullifier }: {
        nullifier: u256;
    }, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>;
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
        leaf: (json: string) => AssembledTransaction<bigint>;
        leaves: (json: string) => AssembledTransaction<bigint[]>;
        remint: (json: string) => AssembledTransaction<null>;
        deposit: (json: string) => AssembledTransaction<number>;
        verifier: (json: string) => AssembledTransaction<string>;
        next_index: (json: string) => AssembledTransaction<number>;
        underlying: (json: string) => AssembledTransaction<string>;
        current_root: (json: string) => AssembledTransaction<bigint>;
        is_known_root: (json: string) => AssembledTransaction<boolean>;
        is_nullifier_used: (json: string) => AssembledTransaction<boolean>;
    };
}
