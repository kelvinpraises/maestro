//! Nullifier set — port of `BaseZWToken.nullifierUsed` + the
//! `_validateAndConsumeNullifier` anti-double-spend check.

use soroban_sdk::{contracttype, Env, U256};

#[contracttype]
#[derive(Clone)]
pub enum NullKey {
    Used(U256),
}

pub fn is_used(env: &Env, nullifier: &U256) -> bool {
    env.storage().persistent().has(&NullKey::Used(nullifier.clone()))
}

/// Marks a nullifier consumed; panics if it was already used.
pub fn consume(env: &Env, nullifier: &U256) {
    if is_used(env, nullifier) {
        panic!("nullifier already used");
    }
    env.storage()
        .persistent()
        .set(&NullKey::Used(nullifier.clone()), &true);
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn consume_then_used() {
        let env = Env::default();
        let id = env.register(crate::Zwerc20, ());
        env.as_contract(&id, || {
            let n = U256::from_u32(&env, 7);
            assert!(!is_used(&env, &n));
            consume(&env, &n);
            assert!(is_used(&env, &n));
        });
    }

    #[test]
    #[should_panic(expected = "already used")]
    fn double_consume_panics() {
        let env = Env::default();
        let id = env.register(crate::Zwerc20, ());
        env.as_contract(&id, || {
            let n = U256::from_u32(&env, 7);
            consume(&env, &n);
            consume(&env, &n);
        });
    }
}
