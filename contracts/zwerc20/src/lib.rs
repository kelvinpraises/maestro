#![no_std]

//! ZWERC20 — ERC-8065 remint privacy pool, ported to Soroban.
//!
//! Port of `xylkstream/apps/contracts/src/privacy/{ZWERC20,BaseZWToken,
//! PoseidonMerkleTree}.sol`, structured as a shielded pool (the obvious Stellar
//! model — see the design table) that reuses the existing `remint.circom`
//! circuit + zkey, verified on-chain by the `groth16-verifier` contract.
//!
//! - `deposit`: pull the underlying SAC into the pool and insert the caller's
//!   `Poseidon(addr20, amount)` commitment into the Merkle tree.
//! - `remint`: prove membership + nullifier (the reused 7-signal circuit),
//!   verify on-chain, consume the nullifier, and pay the underlying to a real
//!   Stellar `Address` (redeem path).

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype,
    crypto::bn254::Bn254Fr,
    token, vec, xdr::ToXdr, Address, Bytes, BytesN, Env, U256, Vec,
};

use contract_types::{Groth16Error, Groth16Proof};

pub mod merkle;
pub mod nullifier;
pub mod poseidon;
mod poseidon_t3;

#[cfg(test)]
mod remint_fixture;
#[cfg(test)]
mod test_remint;

#[contracttype]
#[derive(Clone)]
pub enum ConfigKey {
    Admin,
    Underlying,
    Verifier,
}

/// Cross-contract interface to the deployed Groth16 verifier (by address).
#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn verify(
        env: Env,
        proof: Groth16Proof,
        public_inputs: Vec<Bn254Fr>,
    ) -> Result<bool, Groth16Error>;
}

#[contract]
pub struct Zwerc20;

#[contractimpl]
impl Zwerc20 {
    /// One-time setup: admin, underlying token (SAC) address, and the deployed
    /// Groth16 verifier contract. Initializes the empty Merkle tree.
    pub fn init(env: Env, admin: Address, underlying: Address, verifier: Address) {
        let store = env.storage().instance();
        if store.has(&ConfigKey::Admin) {
            panic!("already initialized");
        }
        store.set(&ConfigKey::Admin, &admin);
        store.set(&ConfigKey::Underlying, &underlying);
        store.set(&ConfigKey::Verifier, &verifier);
        merkle::init(&env);
    }

    /// Deposit `amount` of the underlying asset into the treasury and insert the
    /// claim commitment (`Poseidon(addr20, amount)`) into the tree. Returns the
    /// leaf index.
    ///
    /// The contract computes the commitment itself from `addr20` and `amount`
    /// rather than trusting a caller-supplied leaf: the circuit builds the same
    /// leaf as `Poseidon(addr20, commitAmount)` (see `remint.circom`), so binding
    /// the leaf to the deposited `amount` here is what stops a funder from
    /// committing to a claim worth more than they paid in.
    pub fn deposit(env: Env, from: Address, addr20: U256, amount: i128) -> u32 {
        from.require_auth();
        let token = Self::underlying(env.clone());
        token::TokenClient::new(&env, &token).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        let commitment = poseidon::hash2(&env, &addr20, &U256::from_u128(&env, amount as u128));
        merkle::insert(&env, commitment)
    }

    /// Pay out a claim from the treasury to a real Stellar `Address` by proving
    /// family membership + claim token with the reused remint circuit (redeem
    /// path).
    ///
    /// Public signals match `ISnarkVerifier`:
    /// `[root, nullifier, to, amount, id, redeem, relayerFee]` with `id = 0`
    /// and `redeem = 1`.
    ///
    /// The circuit's `to` public input is the field-encoding of the recipient.
    /// We derive it on-chain from the real `to` (see [`to_field`]) rather than
    /// accept it as a caller parameter, so a relayer cannot reuse a valid proof
    /// with a different recipient and redirect the payout — the encoding is the
    /// convention the client prover MUST replicate.
    pub fn remint(
        env: Env,
        to: Address,
        amount: i128,
        root: U256,
        nullifier: U256,
        relayer_fee: U256,
        proof: Bytes,
    ) {
        if !merkle::is_known_root(&env, &root) {
            panic!("unknown merkle root");
        }
        if nullifier::is_used(&env, &nullifier) {
            panic!("nullifier already used");
        }

        let to_field = to_field(&env, &to);

        let inputs: Vec<Bn254Fr> = vec![
            &env,
            fr(&env, &root),
            fr(&env, &nullifier),
            fr(&env, &to_field),
            fr(&env, &U256::from_u128(&env, amount as u128)),
            fr(&env, &U256::from_u32(&env, 0)), // id = 0 (ERC-20)
            fr(&env, &U256::from_u32(&env, 1)), // redeem = 1 (withdraw underlying)
            fr(&env, &relayer_fee),
        ];

        let proof = Groth16Proof::try_from(proof).expect("malformed proof");
        let verifier = Self::verifier(env.clone());
        let ok = VerifierClient::new(&env, &verifier).verify(&proof, &inputs);
        if !ok {
            panic!("invalid proof");
        }

        nullifier::consume(&env, &nullifier);

        // MVP: no protocol fee; recipient receives the full note amount.
        let token = Self::underlying(env.clone());
        token::TokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
    }

    pub fn verifier(env: Env) -> Address {
        env.storage().instance().get(&ConfigKey::Verifier).expect("not initialized")
    }

    pub fn underlying(env: Env) -> Address {
        env.storage().instance().get(&ConfigKey::Underlying).expect("not initialized")
    }

    pub fn current_root(env: Env) -> U256 {
        merkle::current_root(&env)
    }

    pub fn is_known_root(env: Env, root: U256) -> bool {
        merkle::is_known_root(&env, &root)
    }

    pub fn is_nullifier_used(env: Env, nullifier: U256) -> bool {
        nullifier::is_used(&env, &nullifier)
    }
}

/// `U256` -> `Bn254Fr` (32-byte big-endian field element).
fn fr(env: &Env, v: &U256) -> Bn254Fr {
    let mut buf = [0u8; 32];
    v.to_be_bytes().copy_into_slice(&mut buf);
    Bn254Fr::from_bytes(BytesN::from_array(env, &buf))
}

/// Canonical field-encoding of a recipient `Address` for the remint circuit's
/// `to` public input:
///
/// `to_field = sha256(to.to_xdr()) mod r`
///
/// where `r` is the BN254 scalar field order and the 32-byte digest is read
/// big-endian. Because the digest is 256 bits and `r` is ~254 bits, it can
/// exceed `r`, so we reduce. The client prover MUST derive the circuit's `to`
/// input the same way for the proof to verify.
fn to_field(env: &Env, to: &Address) -> U256 {
    // BN254 scalar field modulus r (big-endian).
    const R_BE: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
        0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00,
        0x00, 0x01,
    ];
    let digest = env.crypto().sha256(&to.clone().to_xdr(env));
    let value = U256::from_be_bytes(env, &Bytes::from(digest));
    let r = U256::from_be_bytes(env, &Bytes::from_array(env, &R_BE));
    value.rem_euclid(&r)
}
