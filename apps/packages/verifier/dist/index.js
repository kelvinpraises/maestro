import { Buffer } from "buffer";
import { Client as ContractClient, Spec as ContractSpec, } from "@stellar/stellar-sdk/contract";
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
};
/**
 * Errors that can occur during Groth16 proof verification.
 */
export const Groth16Error = {
    /**
     * The pairing product did not equal identity.
     */
    0: { message: "InvalidProof" },
    /**
     * The public inputs length does not match the verification key.
     */
    1: { message: "MalformedPublicInputs" },
    /**
     * The proof bytes are malformed.
     */
    2: { message: "MalformedProof" }
};
export class Client extends ContractClient {
    options;
    static async deploy(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options) {
        return ContractClient.deploy(null, options);
    }
    constructor(options) {
        super(new ContractSpec(["AAAAAAAAAKBWZXJpZnkgYSBHcm90aDE2IHByb29mIHVzaW5nIHRoZSBjb21waWxlLXRpbWUgZW1iZWRkZWQgdmVyaWZpY2F0aW9uIGtleS4KCk5vIHBlcnNpc3RlbnQgc3RvcmFnZSBpcyByZWFkIG9yIHdyaXR0ZW47IHRoZSBrZXkgaXMgcGFydCBvZiB0aGUKY29udHJhY3QgV0FTTSBpdHNlbGYuAAAABnZlcmlmeQAAAAAAAgAAAAAAAAAFcHJvb2YAAAAAAAfQAAAADEdyb3RoMTZQcm9vZgAAAAAAAAANcHVibGljX2lucHV0cwAAAAAAA+oAAAAMAAAAAQAAA+kAAAABAAAH0AAAAAxHcm90aDE2RXJyb3I=",
            "AAAABAAAADhFcnJvcnMgdGhhdCBjYW4gb2NjdXIgZHVyaW5nIEdyb3RoMTYgcHJvb2YgdmVyaWZpY2F0aW9uLgAAAAAAAAAMR3JvdGgxNkVycm9yAAAAAwAAACtUaGUgcGFpcmluZyBwcm9kdWN0IGRpZCBub3QgZXF1YWwgaWRlbnRpdHkuAAAAAAxJbnZhbGlkUHJvb2YAAAAAAAAAPVRoZSBwdWJsaWMgaW5wdXRzIGxlbmd0aCBkb2VzIG5vdCBtYXRjaCB0aGUgdmVyaWZpY2F0aW9uIGtleS4AAAAAAAAVTWFsZm9ybWVkUHVibGljSW5wdXRzAAAAAAAAAQAAAB5UaGUgcHJvb2YgYnl0ZXMgYXJlIG1hbGZvcm1lZC4AAAAAAA5NYWxmb3JtZWRQcm9vZgAAAAAAAg==",
            "AAAAAQAAAGpHcm90aDE2IHByb29mIGNvbXBvc2VkIG9mIHBvaW50cyBBLCBCLCBhbmQgQy4KRzIgcG9pbnQgQiB1c2VzIFNvcm9iYW4ncyBjMXx8YzAgKGltYWdpbmFyeXx8cmVhbCkgb3JkZXJpbmcuAAAAAAAAAAAADEdyb3RoMTZQcm9vZgAAAAMAAAAHUG9pbnQgQQAAAAABYQAAAAAAA+4AAABAAAAAB1BvaW50IEIAAAAAAWIAAAAAAAPuAAAAgAAAAAdQb2ludCBDAAAAAAFjAAAAAAAD7gAAAEA=",
            "AAAAAQAAAHhHcm90aDE2IHZlcmlmaWNhdGlvbiBrZXkgZm9yIEJOMjU0IGN1cnZlIChieXRlLW9yaWVudGVkKS4KQWxsIEcyIHBvaW50cyB1c2UgU29yb2JhbidzIGMxfHxjMCAoaW1hZ2luYXJ5fHxyZWFsKSBvcmRlcmluZy4AAAAAAAAAFFZlcmlmaWNhdGlvbktleUJ5dGVzAAAABQAAAA5BbHBoYSBHMSBwb2ludAAAAAAABWFscGhhAAAAAAAD7gAAAEAAAAANQmV0YSBHMiBwb2ludAAAAAAAAARiZXRhAAAD7gAAAIAAAAAORGVsdGEgRzIgcG9pbnQAAAAAAAVkZWx0YQAAAAAAA+4AAACAAAAADkdhbW1hIEcyIHBvaW50AAAAAAAFZ2FtbWEAAAAAAAPuAAAAgAAAAB1JQyAocHVibGljIGlucHV0IGNvbW1pdG1lbnRzKQAAAAAAAAJpYwAAAAAD6gAAA+4AAABA"]), options);
        this.options = options;
    }
    fromJSON = {
        verify: (this.txFromJSON)
    };
}
