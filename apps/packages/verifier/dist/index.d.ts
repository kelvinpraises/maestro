import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, Result } from "@stellar/stellar-sdk/contract";
import type { u256 } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export declare const networks: {
    readonly testnet: {
        readonly networkPassphrase: "Test SDF Network ; September 2015";
        readonly contractId: "CAYENB4W7ALZPIPLAUPR64OSF47H52I5YL2QNKS5UUGRB65MNZBR7ZZE";
    };
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
     * Construct and simulate a verify transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Verify a Groth16 proof using the compile-time embedded verification key.
     *
     * No persistent storage is read or written; the key is part of the
     * contract WASM itself.
     */
    verify: ({ proof, public_inputs }: {
        proof: Groth16Proof;
        public_inputs: Array<u256>;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<boolean>>>;
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
        verify: (json: string) => AssembledTransaction<Result<boolean, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
    };
}
