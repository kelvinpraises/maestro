#![no_std]

//! YieldManager — lets a stream creator put idle treasury capital to work in a
//! yield strategy and reclaim it (plus yield) on demand. Port of
//! `xylkstream/apps/contracts/src/yield/YieldManager.sol` and the Sui
//! `yield_manager.move` re-architecture.
//!
//! Accounting (per manager instance, one token):
//!   total   = liquid + invested
//!   yield   = total − principal      (only `principal` is owed back to Drips)
//!
//! `deposit` brings funds in and grows `principal`; `open_position` moves liquid
//! funds into a strategy (`liquid → invested`); `close_position` pulls them back
//! with any yield (`invested → liquid`, where the surplus over the recorded
//! position is yield); `claim_yield` skims `total − principal`; `return_principal`
//! sends owed capital back to Drips.
//!
//! Soroban adaptations vs the Sui original: Move's hot-potato receipts
//! (`InvestmentReceipt`/`WithdrawalReceipt`) and dynamic-field positions become
//! ordinary cross-contract calls through a `#[contractclient]` Strategy
//! interface plus a `Position(strategy)` storage map. Each contract authorizes
//! its own outgoing token transfers, so no receipt threading is needed.

use soroban_sdk::{contract, contractclient, contractimpl, contracttype, token, Address, Env};

/// A pluggable yield venue. A production strategy (e.g. a Blend lending pool
/// adapter) implements this; the manager only ever calls `withdraw`.
#[contractclient(name = "StrategyClient")]
pub trait StrategyInterface {
    /// Send the strategy's entire balance for this manager to `to` and return
    /// the amount transferred (recorded principal + earned yield).
    fn withdraw(env: Env, to: Address) -> i128;
}

#[contracttype]
pub enum DataKey {
    Owner,
    Token,
    Principal,
    Liquid,
    Invested,
    /// Recorded principal currently held in a given strategy.
    Position(Address),
}

#[contract]
pub struct YieldManager;

fn read(env: &Env, key: &DataKey) -> i128 {
    env.storage().persistent().get(key).unwrap_or(0)
}

fn write(env: &Env, key: &DataKey, v: i128) {
    env.storage().persistent().set(key, &v);
}

fn owner(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Owner).expect("not initialized")
}

fn token_addr(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).expect("not initialized")
}

fn min(a: i128, b: i128) -> i128 {
    if a < b {
        a
    } else {
        b
    }
}

#[contractimpl]
impl YieldManager {
    pub fn init(env: Env, owner: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Owner) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Token, &token);
    }

    /// Bring `amount` of the token into the vault as returnable principal.
    /// `from` is whoever funds it (the Drips contract, or the owner directly).
    pub fn deposit(env: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        token::TokenClient::new(&env, &token_addr(&env)).transfer(
            &from,
            &env.current_contract_address(),
            &amount,
        );
        write(&env, &DataKey::Principal, read(&env, &DataKey::Principal) + amount);
        write(&env, &DataKey::Liquid, read(&env, &DataKey::Liquid) + amount);
    }

    /// Move `amount` of liquid funds into `strategy`.
    pub fn open_position(env: Env, strategy: Address, amount: i128) {
        owner(&env).require_auth();
        let liquid = read(&env, &DataKey::Liquid);
        if amount <= 0 || amount > liquid {
            panic!("insufficient liquid balance");
        }
        token::TokenClient::new(&env, &token_addr(&env)).transfer(
            &env.current_contract_address(),
            &strategy,
            &amount,
        );
        write(&env, &DataKey::Liquid, liquid - amount);
        write(&env, &DataKey::Invested, read(&env, &DataKey::Invested) + amount);
        let pkey = DataKey::Position(strategy);
        write(&env, &pkey, read(&env, &pkey) + amount);
    }

    /// Pull everything back from `strategy`. Whatever exceeds the recorded
    /// position is yield: it lands in `liquid` but does not reduce `invested`.
    pub fn close_position(env: Env, strategy: Address) -> i128 {
        owner(&env).require_auth();
        let withdrawn =
            StrategyClient::new(&env, &strategy).withdraw(&env.current_contract_address());

        let pkey = DataKey::Position(strategy);
        let position = read(&env, &pkey);
        let principal_withdrawn = min(withdrawn, position);
        write(&env, &pkey, position - principal_withdrawn);
        write(&env, &DataKey::Invested, read(&env, &DataKey::Invested) - principal_withdrawn);
        write(&env, &DataKey::Liquid, read(&env, &DataKey::Liquid) + withdrawn);
        withdrawn
    }

    /// Skim accrued yield (`total − principal`) to `to`. Requires enough liquid.
    pub fn claim_yield(env: Env, to: Address) -> i128 {
        owner(&env).require_auth();
        let liquid = read(&env, &DataKey::Liquid);
        let invested = read(&env, &DataKey::Invested);
        let principal = read(&env, &DataKey::Principal);
        let total = liquid + invested;
        if total <= principal {
            panic!("no yield");
        }
        let yield_amt = total - principal;
        if yield_amt > liquid {
            panic!("yield not liquid; close a position first");
        }
        token::TokenClient::new(&env, &token_addr(&env)).transfer(
            &env.current_contract_address(),
            &to,
            &yield_amt,
        );
        write(&env, &DataKey::Liquid, liquid - yield_amt);
        yield_amt
    }

    /// Return up to `amount` of owed principal back to Drips (`to`).
    pub fn return_principal(env: Env, to: Address, amount: i128) {
        owner(&env).require_auth();
        let principal = read(&env, &DataKey::Principal);
        let liquid = read(&env, &DataKey::Liquid);
        if amount <= 0 || amount > principal {
            panic!("exceeds principal");
        }
        if amount > liquid {
            panic!("insufficient liquid balance");
        }
        token::TokenClient::new(&env, &token_addr(&env)).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
        write(&env, &DataKey::Principal, principal - amount);
        write(&env, &DataKey::Liquid, liquid - amount);
    }

    /// (principal, liquid, invested).
    pub fn balances(env: Env) -> (i128, i128, i128) {
        (
            read(&env, &DataKey::Principal),
            read(&env, &DataKey::Liquid),
            read(&env, &DataKey::Invested),
        )
    }

    pub fn position_amount(env: Env, strategy: Address) -> i128 {
        read(&env, &DataKey::Position(strategy))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    // A stand-in yield venue: a dumb vault that holds the token and, on
    // `withdraw`, returns its whole balance to the manager. Yield is modeled by
    // an external `fund` transfer (a real strategy would earn it from a lending
    // pool). This keeps the manager's accounting honest while isolating it from
    // any specific protocol integration.
    #[contract]
    pub struct MockStrategy;

    #[contracttype]
    enum SKey {
        Token,
        Manager,
    }

    #[contractimpl]
    impl MockStrategy {
        pub fn init(env: Env, token: Address, manager: Address) {
            env.storage().instance().set(&SKey::Token, &token);
            env.storage().instance().set(&SKey::Manager, &manager);
        }
        /// Simulate yield accrual: anyone can top the vault up.
        pub fn fund(env: Env, from: Address, amount: i128) {
            from.require_auth();
            let token: Address = env.storage().instance().get(&SKey::Token).unwrap();
            token::TokenClient::new(&env, &token).transfer(
                &from,
                &env.current_contract_address(),
                &amount,
            );
        }
        pub fn withdraw(env: Env, to: Address) -> i128 {
            let manager: Address = env.storage().instance().get(&SKey::Manager).unwrap();
            manager.require_auth();
            let token: Address = env.storage().instance().get(&SKey::Token).unwrap();
            let coin = token::TokenClient::new(&env, &token);
            let bal = coin.balance(&env.current_contract_address());
            if bal > 0 {
                coin.transfer(&env.current_contract_address(), &to, &bal);
            }
            bal
        }
    }

    #[test]
    fn invest_earn_yield_and_reclaim_principal() {
        let env = Env::default();
        env.mock_all_auths();

        let sac_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(sac_admin);
        let token_addr = sac.address();
        let mint = token::StellarAssetClient::new(&env, &token_addr);
        let coin = token::TokenClient::new(&env, &token_addr);

        let owner = Address::generate(&env);
        let drips = Address::generate(&env);
        let yield_source = Address::generate(&env);
        mint.mint(&owner, &500);
        mint.mint(&yield_source, &50);

        let manager_id = env.register(YieldManager, ());
        let manager = YieldManagerClient::new(&env, &manager_id);
        manager.init(&owner, &token_addr);

        let strat_id = env.register(MockStrategy, ());
        let strat = MockStrategyClient::new(&env, &strat_id);
        strat.init(&token_addr, &manager_id);

        // Owner deposits 500 of idle treasury as principal.
        manager.deposit(&owner, &500);
        assert_eq!(manager.balances(), (500, 500, 0));

        // Invest all of it into the strategy.
        manager.open_position(&strat_id, &500);
        assert_eq!(manager.balances(), (500, 0, 500));
        assert_eq!(coin.balance(&strat_id), 500);

        // The strategy earns 50 of yield (modeled as an external top-up).
        strat.fund(&yield_source, &50);

        // Close out: 550 comes back, only 500 of it reduces invested principal.
        assert_eq!(manager.close_position(&strat_id), 550);
        assert_eq!(manager.balances(), (500, 550, 0));

        // Skim the 50 yield to the owner.
        assert_eq!(manager.claim_yield(&owner), 50);
        assert_eq!(manager.balances(), (500, 500, 0));
        assert_eq!(coin.balance(&owner), 50);

        // Return the 500 principal to Drips.
        manager.return_principal(&drips, &500);
        assert_eq!(manager.balances(), (0, 0, 0));
        assert_eq!(coin.balance(&drips), 500);
    }
}
