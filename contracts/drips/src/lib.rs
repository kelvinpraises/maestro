#![no_std]

//! Drips — streaming + splitting payment protocol, ported from
//! `xylkstream/apps/contracts/src/protocol/` (and the Sui re-architecture) to
//! Soroban. Streams (cyclical flow) feed into Splits (weight distribution): a
//! received stream becomes the receiver's `splittable` balance, which `split`
//! fans out by weight and `collect` pays out.

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

pub mod splits;
pub mod streams;

use splits::SplitsReceiver;
use streams::StreamReceiver;

#[contract]
pub struct Drips;

/// Move `amt` (>0) of `token` from `from` to `to` via the SAC.
fn transfer(env: &Env, token: &Address, from: &Address, to: &Address, amt: i128) {
    if amt > 0 {
        token::TokenClient::new(env, token).transfer(from, to, &amt);
    }
}

#[contractimpl]
impl Drips {
    /// One-time setup of the global streams cycle length (seconds).
    pub fn init(env: Env, cycle_secs: u64) {
        streams::init(&env, cycle_secs);
    }

    // ───────────── streams ─────────────

    /// Configure `account`'s streams of `token`. `balance_delta > 0` tops the
    /// stream up; `< 0` withdraws. Returns the real delta applied.
    pub fn set_streams(
        env: Env,
        account: Address,
        token: Address,
        new_receivers: Vec<StreamReceiver>,
        balance_delta: i128,
        max_end_hint1: u64,
        max_end_hint2: u64,
    ) -> i128 {
        account.require_auth();
        let real = streams::set_streams(
            &env,
            &token,
            &account,
            &new_receivers,
            balance_delta,
            max_end_hint1,
            max_end_hint2,
        );
        // Settle the underlying: a top-up pulls funds into the vault, a
        // withdrawal pushes the (capped) amount back to the sender.
        let vault = env.current_contract_address();
        if real > 0 {
            transfer(&env, &token, &account, &vault, real);
        } else if real < 0 {
            transfer(&env, &token, &vault, &account, -real);
        }
        real
    }

    /// Receive up to `max_cycles` whole elapsed cycles for `account`; the
    /// received amount is credited to the account's splittable balance.
    pub fn receive_streams(
        env: Env,
        account: Address,
        token: Address,
        max_cycles: u32,
    ) -> i128 {
        let received = streams::receive_streams(&env, &token, &account, max_cycles);
        if received > 0 {
            splits::give(&env, &account, &token, received);
        }
        received
    }

    pub fn receivable_streams_cycles(env: Env, account: Address, token: Address) -> u64 {
        streams::receivable_streams_cycles(&env, &token, &account)
    }

    pub fn balance_at(env: Env, account: Address, token: Address, timestamp: u64) -> i128 {
        streams::balance_at(&env, &token, &account, timestamp)
    }

    /// (next_receivable_cycle, update_time, max_end, balance).
    pub fn streams_state(env: Env, account: Address, token: Address) -> (u64, u64, u64, i128) {
        streams::streams_state(&env, &token, &account)
    }

    // ───────────── splits ─────────────

    pub fn set_splits(env: Env, account: Address, receivers: Vec<SplitsReceiver>) {
        account.require_auth();
        splits::set_splits(&env, &account, &receivers);
    }

    pub fn splittable(env: Env, account: Address, token: Address) -> i128 {
        splits::splittable(&env, &account, &token)
    }

    pub fn collectable(env: Env, account: Address, token: Address) -> i128 {
        splits::collectable(&env, &account, &token)
    }

    pub fn split(env: Env, account: Address, token: Address) -> (i128, i128) {
        splits::split(&env, &account, &token)
    }

    /// `from` gives `amt` of `token` directly into `receiver`'s splittable
    /// balance, transferring the underlying into the vault.
    pub fn give(env: Env, from: Address, receiver: Address, token: Address, amt: i128) {
        from.require_auth();
        transfer(&env, &token, &from, &env.current_contract_address(), amt);
        splits::give(&env, &receiver, &token, amt);
    }

    /// Collect `account`'s collectable balance of `token` and pay it out to `to`.
    pub fn collect(env: Env, account: Address, token: Address, to: Address) -> i128 {
        account.require_auth();
        let amt = splits::collect(&env, &account, &token);
        transfer(&env, &token, &env.current_contract_address(), &to, amt);
        amt
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        token, vec,
    };
    use streams::{StreamConfig, AMT_PER_SEC_MULTIPLIER};

    /// Real-token allowance slice: parent funds a 1 unit/sec stream to a kid;
    /// after 30s the kid receives 30, splits (no sub-receivers ⇒ all
    /// collectable), and collects it out to their own wallet.
    #[test]
    fn allowance_stream_end_to_end() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 0);

        let id = env.register(Drips, ());
        let client = DripsClient::new(&env, &id);

        // A Stellar Asset Contract to stand in for testnet USDC.
        let sac_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(sac_admin);
        let token_addr = sac.address();
        let mint = token::StellarAssetClient::new(&env, &token_addr);
        let coin = token::TokenClient::new(&env, &token_addr);

        let parent = Address::generate(&env);
        let kid = Address::generate(&env);
        mint.mint(&parent, &1_000);

        client.init(&10);

        // Parent opens a 1 unit/sec allowance funded with 500.
        let receivers = vec![
            &env,
            StreamReceiver {
                account: kid.clone(),
                config: StreamConfig {
                    stream_id: 0,
                    amt_per_sec: AMT_PER_SEC_MULTIPLIER,
                    start: 0,
                    duration: 0,
                },
            },
        ];
        client.set_streams(&parent, &token_addr, &receivers, &500, &0, &0);

        // The deposit moved into the vault.
        assert_eq!(coin.balance(&parent), 500);
        assert_eq!(coin.balance(&id), 500);

        // Three cycles later the kid pulls their streamed allowance through.
        env.ledger().with_mut(|l| l.timestamp = 30);
        assert_eq!(client.receive_streams(&kid, &token_addr, &100), 30);
        client.split(&kid, &token_addr);
        assert_eq!(client.collect(&kid, &token_addr, &kid), 30);

        // The kid now holds 30 real tokens; the vault retains the rest.
        assert_eq!(coin.balance(&kid), 30);
        assert_eq!(coin.balance(&id), 470);
    }

    /// Init is one-time: a second call must not be able to re-key the global
    /// cycle length out from under existing delta accounting.
    #[test]
    #[should_panic(expected = "already initialized")]
    fn double_init_panics() {
        let env = Env::default();
        let id = env.register(Drips, ());
        let client = DripsClient::new(&env, &id);

        client.init(&10);
        client.init(&10);
    }
}
