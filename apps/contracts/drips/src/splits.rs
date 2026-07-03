//! Splits — weight-based fund distribution. Port of
//! `xylkstream/apps/contracts/src/protocol/Splits.sol` (and the Sui
//! `splits.move` re-architecture), adapted to Stellar: accounts are `Address`,
//! amounts are `i128`, and the receivers list is stored directly rather than
//! hash-verified against a caller-supplied copy.
//!
//! Model: an account accrues a `splittable` balance (via `give` or streams).
//! `split` distributes it to the configured receivers by weight; whatever isn't
//! split becomes the account's `collectable` balance, which `collect` zeroes
//! and returns for payout.

use soroban_sdk::{contracttype, Address, Env, Vec};

/// Total weight; a receiver gets `weight / TOTAL_SPLITS_WEIGHT` of the split.
pub const TOTAL_SPLITS_WEIGHT: u32 = 1_000_000;
/// Maximum receivers per account (bounds split cost).
pub const MAX_SPLITS_RECEIVERS: u32 = 200;

#[contracttype]
#[derive(Clone)]
pub struct SplitsReceiver {
    pub account: Address,
    pub weight: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum SplitsKey {
    /// Configured receivers list for an account.
    Config(Address),
    /// Received-but-not-split balance, per (account, token).
    Splittable(Address, Address),
    /// Split, ready-to-collect balance, per (account, token).
    Collectable(Address, Address),
}

fn read(env: &Env, key: &SplitsKey) -> i128 {
    env.storage().persistent().get(key).unwrap_or(0)
}

pub fn splittable(env: &Env, account: &Address, token: &Address) -> i128 {
    read(env, &SplitsKey::Splittable(account.clone(), token.clone()))
}

pub fn collectable(env: &Env, account: &Address, token: &Address) -> i128 {
    read(env, &SplitsKey::Collectable(account.clone(), token.clone()))
}

fn add_splittable(env: &Env, account: &Address, token: &Address, amt: i128) {
    if amt == 0 {
        return;
    }
    let key = SplitsKey::Splittable(account.clone(), token.clone());
    let new = read(env, &key) + amt;
    env.storage().persistent().set(&key, &new);
}

fn add_collectable(env: &Env, account: &Address, token: &Address, amt: i128) {
    if amt == 0 {
        return;
    }
    let key = SplitsKey::Collectable(account.clone(), token.clone());
    let new = read(env, &key) + amt;
    env.storage().persistent().set(&key, &new);
}

/// Set an account's splits configuration. Receivers must be sorted by account,
/// deduplicated, have non-zero weights, and sum to at most `TOTAL_SPLITS_WEIGHT`.
pub fn set_splits(env: &Env, account: &Address, receivers: &Vec<SplitsReceiver>) {
    if receivers.len() > MAX_SPLITS_RECEIVERS {
        panic!("too many splits receivers");
    }
    let mut total: u64 = 0;
    let mut prev: Option<Address> = None;
    for r in receivers.iter() {
        if r.weight == 0 {
            panic!("splits receiver weight is zero");
        }
        if let Some(p) = &prev {
            if &r.account <= p {
                panic!("splits receivers not sorted/deduped");
            }
        }
        total += r.weight as u64;
        prev = Some(r.account.clone());
    }
    if total > TOTAL_SPLITS_WEIGHT as u64 {
        panic!("splits weights sum too high");
    }
    env.storage().persistent().set(&SplitsKey::Config(account.clone()), receivers);
}

pub fn get_splits(env: &Env, account: &Address) -> Vec<SplitsReceiver> {
    env.storage()
        .persistent()
        .get(&SplitsKey::Config(account.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

/// Give `amt` directly to `receiver`'s splittable balance.
pub fn give(env: &Env, receiver: &Address, token: &Address, amt: i128) {
    add_splittable(env, receiver, token, amt);
}

/// Split the account's entire splittable balance among its receivers by weight.
/// The unsplit remainder becomes collectable for the account. Returns
/// `(collectable_added, split_total)`. Uses the cumulative-weight method from
/// `Splits.sol` so rounding never loses or creates value.
pub fn split(env: &Env, account: &Address, token: &Address) -> (i128, i128) {
    let amount = splittable(env, account, token);
    if amount == 0 {
        return (0, 0);
    }
    env.storage()
        .persistent()
        .set(&SplitsKey::Splittable(account.clone(), token.clone()), &0i128);

    let receivers = get_splits(env, account);
    let mut split_total: i128 = 0;
    let mut weight_acc: u64 = 0;
    for r in receivers.iter() {
        weight_acc += r.weight as u64;
        let cumulative = amount * (weight_acc as i128) / (TOTAL_SPLITS_WEIGHT as i128);
        let curr = cumulative - split_total;
        split_total += curr;
        add_splittable(env, &r.account, token, curr);
    }
    let collectable_added = amount - split_total;
    add_collectable(env, account, token, collectable_added);
    (collectable_added, split_total)
}

/// Zero and return the account's collectable balance (for payout).
pub fn collect(env: &Env, account: &Address, token: &Address) -> i128 {
    let key = SplitsKey::Collectable(account.clone(), token.clone());
    let amt = read(env, &key);
    if amt != 0 {
        env.storage().persistent().set(&key, &0i128);
    }
    amt
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, vec};

    #[test]
    fn give_split_collect_distributes_by_weight() {
        let env = Env::default();
        let id = env.register(crate::Drips, ());
        env.as_contract(&id, || {
            let token = Address::generate(&env);
            let parent = Address::generate(&env);
            let kid_a = Address::generate(&env);
            let kid_b = Address::generate(&env);

            // Sort the two kid receivers for the sortedness invariant.
            let (r1, r2) = if kid_a < kid_b {
                (kid_a.clone(), kid_b.clone())
            } else {
                (kid_b.clone(), kid_a.clone())
            };
            // 60% / 30% split (10% stays collectable for the parent).
            set_splits(
                &env,
                &parent,
                &vec![
                    &env,
                    SplitsReceiver { account: r1.clone(), weight: 600_000 },
                    SplitsReceiver { account: r2.clone(), weight: 300_000 },
                ],
            );

            give(&env, &parent, &token, 1_000);
            assert_eq!(splittable(&env, &parent, &token), 1_000);

            let (collectable_added, split_total) = split(&env, &parent, &token);
            assert_eq!(split_total, 900);
            assert_eq!(collectable_added, 100);
            assert_eq!(splittable(&env, &r1, &token), 600);
            assert_eq!(splittable(&env, &r2, &token), 300);

            // Parent collects the unsplit remainder.
            assert_eq!(collect(&env, &parent, &token), 100);
            assert_eq!(collect(&env, &parent, &token), 0);
        });
    }
}
