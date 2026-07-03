//! circomlib-compatible Poseidon-1 (t=3) over BN254, via the Soroban P25
//! `poseidon_permutation` host function.
//!
//! Matches `circomlib/circuits/poseidon.circom` `Poseidon(2)` (the hash used by
//! `remint.circom` and `poseidon-solidity`'s `PoseidonT3`): initial state is
//! `[0, a, b]`, 8 full + 57 partial rounds, full MDS matrix, output `state[0]`.
//! Constants are the original (unoptimized) circomlib values in `poseidon_t3`.

use soroban_sdk::{Bytes, Env, Symbol, U256, Vec, vec};

use crate::poseidon_t3::{MDS_FLAT, RC_FLAT};

const T: u32 = 3;
const D: u32 = 5;
const ROUNDS_F: u32 = 8;
const ROUNDS_P: u32 = 57;

fn u256_be(env: &Env, b: &[u8; 32]) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, b))
}

/// `(rounds_f + rounds_p)`-by-`t` round-constant matrix from the flat array.
fn round_constants(env: &Env) -> Vec<Vec<U256>> {
    let mut rc = Vec::new(env);
    let rounds = (ROUNDS_F + ROUNDS_P) as usize;
    let mut i = 0usize;
    for _ in 0..rounds {
        let mut row = Vec::new(env);
        for _ in 0..(T as usize) {
            row.push_back(u256_be(env, &RC_FLAT[i]));
            i += 1;
        }
        rc.push_back(row);
    }
    rc
}

/// `t`-by-`t` MDS matrix from the flat array (row-major).
fn mds(env: &Env) -> Vec<Vec<U256>> {
    let mut m = Vec::new(env);
    let mut i = 0usize;
    for _ in 0..(T as usize) {
        let mut row = Vec::new(env);
        for _ in 0..(T as usize) {
            row.push_back(u256_be(env, &MDS_FLAT[i]));
            i += 1;
        }
        m.push_back(row);
    }
    m
}

/// Poseidon hash of two field elements, circomlib-compatible.
pub fn hash2(env: &Env, a: &U256, b: &U256) -> U256 {
    let input = vec![env, U256::from_u32(env, 0), a.clone(), b.clone()];
    let out = env.crypto_hazmat().poseidon_permutation(
        &input,
        Symbol::new(env, "BN254"),
        T,
        D,
        ROUNDS_F,
        ROUNDS_P,
        &mds(env),
        &round_constants(env),
    );
    out.get(0).expect("poseidon returns t elements")
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::poseidon_t3::{REF_HASH_0_0, REF_HASH_1_2};

    #[test]
    fn matches_circomlib_reference_vectors() {
        let env = Env::default();
        let one = U256::from_u32(&env, 1);
        let two = U256::from_u32(&env, 2);
        let zero = U256::from_u32(&env, 0);

        assert_eq!(hash2(&env, &one, &two), u256_be(&env, &REF_HASH_1_2));
        assert_eq!(hash2(&env, &zero, &zero), u256_be(&env, &REF_HASH_0_0));
    }
}
