//! Per-leaf storage, range reads, and the deposit/claim events an off-chain
//! indexer relies on to rebuild the tree and follow history.

use soroban_sdk::{
    testutils::{Address as _, Events},
    token::StellarAssetClient,
    Address, Bytes, Env, Event, String, U256, Vec,
};

use crate::remint_fixture as fx;
use crate::{ClaimEvent, DepositEvent, Zwerc20, Zwerc20Client};

fn u256(env: &Env, b: &[u8; 32]) -> U256 {
    U256::from_be_bytes(env, &Bytes::from_array(env, b))
}

/// The commitment `deposit` inserts: `Poseidon(addr20, amount)`.
fn commitment(env: &Env, addr20: &U256, amount: i128) -> U256 {
    crate::poseidon::hash2(env, addr20, &U256::from_u128(env, amount as u128))
}

/// Stand up the pool over a fresh test SAC, returning the client, a funded
/// depositor, and the SAC admin (for minting).
fn setup(env: &Env) -> (Zwerc20Client<'_>, Address, StellarAssetClient<'_>) {
    let vid = env.register(groth16_verifier::CircomGroth16Verifier, ());

    let sac_admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let token = sac.address();
    let token_admin = StellarAssetClient::new(env, &token);

    let admin = Address::generate(env);
    let zid = env.register(Zwerc20, ());
    let z = Zwerc20Client::new(env, &zid);
    z.init(&admin, &token, &vid);

    let depositor = Address::generate(env);
    (z, depositor, token_admin)
}

#[test]
fn leaf_storage_and_range_reads() {
    let env = Env::default();
    env.mock_all_auths();
    let (z, depositor, token_admin) = setup(&env);

    // Two deposits with distinct commitments.
    let addr_a = U256::from_u32(&env, 100);
    let addr_b = U256::from_u32(&env, 200);
    token_admin.mint(&depositor, &(2 * fx::AMOUNT));
    z.deposit(&depositor, &addr_a, &fx::AMOUNT);
    z.deposit(&depositor, &addr_b, &fx::AMOUNT);

    // next_index reflects both inserts.
    assert_eq!(z.next_index(), 2);

    // Each leaf is the exact commitment the contract computed.
    let c0 = commitment(&env, &addr_a, fx::AMOUNT);
    let c1 = commitment(&env, &addr_b, fx::AMOUNT);
    assert_eq!(z.leaf(&0), c0);
    assert_eq!(z.leaf(&1), c1);

    // A full-range read returns both leaves in order.
    let all: Vec<U256> = z.leaves(&0, &100);
    assert_eq!(all.len(), 2);
    assert_eq!(all.get(0).unwrap(), c0);
    assert_eq!(all.get(1).unwrap(), c1);

    // Reading past the end is empty, not an error.
    assert_eq!(z.leaves(&2, &10).len(), 0);
}

#[test]
#[should_panic(expected = "leaf index out of range")]
fn leaf_out_of_range_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (z, depositor, token_admin) = setup(&env);

    let addr = U256::from_u32(&env, 100);
    token_admin.mint(&depositor, &fx::AMOUNT);
    z.deposit(&depositor, &addr, &fx::AMOUNT);

    // Only index 0 exists.
    z.leaf(&2);
}

#[test]
fn deposit_publishes_deposit_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (z, depositor, token_admin) = setup(&env);

    let addr = U256::from_u32(&env, 100);
    token_admin.mint(&depositor, &fx::AMOUNT);
    let index = z.deposit(&depositor, &addr, &fx::AMOUNT);

    // Snapshot the deposit's events before any further invocation prunes them.
    // The deposit also emits the underlying SAC's `transfer` event, so narrow to
    // the pool's own events.
    let events = env.events().all().filter_by_contract(&z.address);

    // The pool publishes exactly one event, matching what an indexer expects.
    let expected = DepositEvent {
        index,
        commitment: commitment(&env, &addr, fx::AMOUNT),
        new_root: z.current_root(),
        amount: fx::AMOUNT,
    };
    let expected_list = soroban_sdk::vec![
        &env,
        (z.address.clone(), expected.topics(&env), expected.data(&env)),
    ];
    assert_eq!(events, expected_list);
}

#[test]
fn remint_publishes_claim_event() {
    // Reuse the real end-to-end fixture so a genuine proof drives the payout.
    let env = Env::default();
    env.mock_all_auths();

    let vid = env.register(groth16_verifier::CircomGroth16Verifier, ());

    let sac_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let token = sac.address();
    let token_admin = StellarAssetClient::new(&env, &token);

    let admin = Address::generate(&env);
    let zid = env.register(Zwerc20, ());
    let z = Zwerc20Client::new(&env, &zid);
    z.init(&admin, &token, &vid);

    let depositor = Address::generate(&env);
    token_admin.mint(&depositor, &fx::AMOUNT);
    let addr20 = u256(&env, &fx::ADDR20);
    z.deposit(&depositor, &addr20, &fx::AMOUNT);

    let to = Address::from_string(&String::from_str(&env, fx::TO_STRKEY));
    let root = u256(&env, &fx::PUBLIC_SIGNALS[0]);
    let nullifier = u256(&env, &fx::PUBLIC_SIGNALS[1]);
    let relayer_fee = u256(&env, &fx::PUBLIC_SIGNALS[6]);
    let proof = Bytes::from_array(&env, &fx::PROOF);

    z.remint(&to, &fx::AMOUNT, &root, &nullifier, &relayer_fee, &proof);

    // The remint invocation also emits the underlying SAC's `transfer` event, so
    // narrow to the pool's own events: the pool publishes exactly the claim.
    let pool_events = env.events().all().filter_by_contract(&z.address);
    let expected = ClaimEvent {
        nullifier: nullifier.clone(),
        to: to.clone(),
        amount: fx::AMOUNT,
    };
    let expected_list = soroban_sdk::vec![
        &env,
        (z.address.clone(), expected.topics(&env), expected.data(&env)),
    ];
    assert_eq!(pool_events, expected_list);
}
