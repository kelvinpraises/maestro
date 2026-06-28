//! Incremental Poseidon Merkle tree — port of
//! `xylkstream/apps/contracts/src/privacy/PoseidonMerkleTree.sol`.
//!
//! Depth-20, circomlib-compatible Poseidon-1 nodes (see [`crate::poseidon`]),
//! sparse incremental insert (zeros + filledSubtrees), and a persistent
//! known-root set so proofs against any historical root verify.

use soroban_sdk::{contracttype, Env, U256};

use crate::poseidon::hash2;

/// Tree depth (2^20 leaves), matching the Solidity `_TREE_DEPTH` and the
/// `remint.circom` `TREE_DEPTH`.
pub const TREE_DEPTH: u32 = 20;

#[contracttype]
#[derive(Clone)]
pub enum MerkleKey {
    NextIndex,
    Root,
    Zero(u32),
    Filled(u32),
    KnownRoot(U256),
}

/// Initialize an empty tree: zeros[0]=0, zeros[i]=H(zeros[i-1],zeros[i-1]),
/// filledSubtrees=zeros, root=zeros[depth-1] (faithful to the Solidity ctor).
pub fn init(env: &Env) {
    let store = env.storage().persistent();
    let mut zero = U256::from_u32(env, 0);
    store.set(&MerkleKey::Zero(0), &zero);
    store.set(&MerkleKey::Filled(0), &zero);

    let mut level = 1u32;
    while level < TREE_DEPTH {
        zero = hash2(env, &zero, &zero);
        store.set(&MerkleKey::Zero(level), &zero);
        store.set(&MerkleKey::Filled(level), &zero);
        level += 1;
    }

    store.set(&MerkleKey::Root, &zero);
    store.set(&MerkleKey::KnownRoot(zero), &true);
    store.set(&MerkleKey::NextIndex, &0u32);
}

/// Insert a leaf, returning its index. Recomputes the root incrementally and
/// records it as a known root.
pub fn insert(env: &Env, leaf: U256) -> u32 {
    let store = env.storage().persistent();
    let index: u32 = store.get(&MerkleKey::NextIndex).unwrap_or(0);
    if index >= (1u32 << TREE_DEPTH) {
        panic!("merkle tree full");
    }

    let mut current = leaf;
    let mut idx = index;
    let mut level = 0u32;
    while level < TREE_DEPTH {
        if idx % 2 == 0 {
            store.set(&MerkleKey::Filled(level), &current);
            let z: U256 = store.get(&MerkleKey::Zero(level)).unwrap();
            current = hash2(env, &current, &z);
        } else {
            let f: U256 = store.get(&MerkleKey::Filled(level)).unwrap();
            current = hash2(env, &f, &current);
        }
        idx /= 2;
        level += 1;
    }

    store.set(&MerkleKey::Root, &current);
    store.set(&MerkleKey::KnownRoot(current.clone()), &true);
    store.set(&MerkleKey::NextIndex, &(index + 1));
    index
}

pub fn current_root(env: &Env) -> U256 {
    env.storage()
        .persistent()
        .get(&MerkleKey::Root)
        .expect("tree not initialized")
}

pub fn is_known_root(env: &Env, root: &U256) -> bool {
    env.storage()
        .persistent()
        .has(&MerkleKey::KnownRoot(root.clone()))
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn init_then_insert_updates_and_tracks_roots() {
        let env = Env::default();
        // Run inside a contract context so persistent storage is available.
        let id = env.register(crate::Zwerc20, ());
        env.as_contract(&id, || {
            init(&env);
            let empty_root = current_root(&env);
            assert!(is_known_root(&env, &empty_root));

            let leaf = U256::from_u32(&env, 42);
            let idx = insert(&env, leaf);
            assert_eq!(idx, 0);

            let new_root = current_root(&env);
            assert_ne!(new_root, empty_root, "root must change after insert");
            assert!(is_known_root(&env, &new_root));
            assert!(is_known_root(&env, &empty_root), "old root still known");

            // A never-seen value is not a known root.
            assert!(!is_known_root(&env, &U256::from_u32(&env, 999)));
        });
    }
}
