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
        contractId: "CAQKJBXQRRF4EUQWUZWHO2YBNUED6H5L5HTHAUZKBDZ2MCQTAF4DV2FB",
    }
};
export class Client extends ContractClient {
    options;
    static async deploy(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options) {
        return ContractClient.deploy(null, options);
    }
    constructor(options) {
        super(new ContractSpec(["AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAAFVG9rZW4AAAAAAAAAAAAAAAAAAAlQcmluY2lwYWwAAAAAAAAAAAAAAAAAAAZMaXF1aWQAAAAAAAAAAAAAAAAACEludmVzdGVkAAAAAQAAADZSZWNvcmRlZCBwcmluY2lwYWwgY3VycmVudGx5IGhlbGQgaW4gYSBnaXZlbiBzdHJhdGVneS4AAAAAAAhQb3NpdGlvbgAAAAEAAAAT",
            "AAAAAAAAAAAAAAAEaW5pdAAAAAIAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAA==",
            "AAAAAAAAAItCcmluZyBgYW1vdW50YCBvZiB0aGUgdG9rZW4gaW50byB0aGUgdmF1bHQgYXMgcmV0dXJuYWJsZSBwcmluY2lwYWwuCmBmcm9tYCBpcyB3aG9ldmVyIGZ1bmRzIGl0ICh0aGUgRHJpcHMgY29udHJhY3QsIG9yIHRoZSBvd25lciBkaXJlY3RseSkuAAAAAAdkZXBvc2l0AAAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAA",
            "AAAAAAAAAB4ocHJpbmNpcGFsLCBsaXF1aWQsIGludmVzdGVkKS4AAAAAAAhiYWxhbmNlcwAAAAAAAAABAAAD7QAAAAMAAAALAAAACwAAAAs=",
            "AAAAAAAAAEtTa2ltIGFjY3J1ZWQgeWllbGQgKGB0b3RhbCDiiJIgcHJpbmNpcGFsYCkgdG8gYHRvYC4gUmVxdWlyZXMgZW5vdWdoIGxpcXVpZC4AAAAAC2NsYWltX3lpZWxkAAAAAAEAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAs=",
            "AAAAAAAAAC5Nb3ZlIGBhbW91bnRgIG9mIGxpcXVpZCBmdW5kcyBpbnRvIGBzdHJhdGVneWAuAAAAAAANb3Blbl9wb3NpdGlvbgAAAAAAAAIAAAAAAAAACHN0cmF0ZWd5AAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
            "AAAAAAAAAItQdWxsIGV2ZXJ5dGhpbmcgYmFjayBmcm9tIGBzdHJhdGVneWAuIFdoYXRldmVyIGV4Y2VlZHMgdGhlIHJlY29yZGVkCnBvc2l0aW9uIGlzIHlpZWxkOiBpdCBsYW5kcyBpbiBgbGlxdWlkYCBidXQgZG9lcyBub3QgcmVkdWNlIGBpbnZlc3RlZGAuAAAAAA5jbG9zZV9wb3NpdGlvbgAAAAAAAQAAAAAAAAAIc3RyYXRlZ3kAAAATAAAAAQAAAAs=",
            "AAAAAAAAAAAAAAAPcG9zaXRpb25fYW1vdW50AAAAAAEAAAAAAAAACHN0cmF0ZWd5AAAAEwAAAAEAAAAL",
            "AAAAAAAAAD1SZXR1cm4gdXAgdG8gYGFtb3VudGAgb2Ygb3dlZCBwcmluY2lwYWwgYmFjayB0byBEcmlwcyAoYHRvYCkuAAAAAAAAEHJldHVybl9wcmluY2lwYWwAAAACAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA=="]), options);
        this.options = options;
    }
    fromJSON = {
        init: (this.txFromJSON),
        deposit: (this.txFromJSON),
        balances: (this.txFromJSON),
        claim_yield: (this.txFromJSON),
        open_position: (this.txFromJSON),
        close_position: (this.txFromJSON),
        position_amount: (this.txFromJSON),
        return_principal: (this.txFromJSON)
    };
}
