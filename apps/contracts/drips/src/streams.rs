//! Streams — cyclical streaming payments. Port of
//! `xylkstream/apps/contracts/src/protocol/Streams.sol` (and the Sui
//! `streams.move` re-architecture) to Soroban.
//!
//! Model: a sender configures a set of `StreamReceiver`s, each streaming
//! `amt_per_sec` (carrying `AMT_PER_SEC_MULTIPLIER` extra decimals) over a time
//! window. The engine records, per receiver, a pair of per-cycle deltas
//! (`AmtDelta { this_cycle, next_cycle }`) so that a receiver can later walk
//! whole elapsed cycles and sum what flowed to them in O(cycles) — never
//! O(streams × time). `set_streams` diffs the old vs new receiver lists with a
//! two-pointer merge and only nudges the affected deltas; `calc_max_end` binary
//! searches for the timestamp at which the sender's balance runs dry.
//!
//! Adaptations vs the EVM original, consistent with `splits.rs`:
//! - accounts and tokens are `Address`; amounts are `i128`.
//! - the receiver list is stored **directly** (keyed by token+account) rather
//!   than as a keccak hash the caller must reproduce — so `set_streams` reads
//!   the prior list itself. The EVM hash was a calldata/storage gas trick.
//! - native `i128` replaces the emulated `movemate::i128`; `I256` covers only
//!   the `t * amt_per_sec / MULTIPLIER` intermediates that can exceed 128 bits.
//! - `squeeze_streams` (receive from the in-progress cycle of one sender) is
//!   intentionally omitted: it relies on the streams-history hash chain that the
//!   direct-storage model drops, and whole-cycle `receive_streams` covers the
//!   product need (recurring allowances).

use soroban_sdk::{contracttype, Address, Env, Vec, I256};

/// Extra fixed-point decimals carried by every `amt_per_sec` (1e9).
pub const AMT_PER_SEC_MULTIPLIER: i128 = 1_000_000_000;
/// Max receivers per sender (bounds per-call work).
pub const MAX_STREAMS_RECEIVERS: u32 = 100;

// ───────────────────────────── types ─────────────────────────────

/// One stream's settings. `start == 0` means "from the configuration time";
/// `duration == 0` means "until the balance runs out" (i.e. to `max_end`).
#[contracttype]
#[derive(Clone)]
pub struct StreamConfig {
    pub stream_id: u64,
    pub amt_per_sec: i128,
    pub start: u64,
    pub duration: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct StreamReceiver {
    pub account: Address,
    pub config: StreamConfig,
}

/// Per-cycle delta pair. `this_cycle` applies to the cycle it is keyed under;
/// `next_cycle` is carried into the following cycle. A point-in-time rate change
/// is expressed as deltas in two cycles so whole-cycle summation stays exact.
#[contracttype]
#[derive(Clone)]
pub struct AmtDelta {
    pub this_cycle: i128,
    pub next_cycle: i128,
}

/// Per (token, account) sender/receiver snapshot.
#[contracttype]
#[derive(Clone)]
pub struct StreamsState {
    /// Earliest cycle not yet received (0 = nothing receivable yet).
    pub next_receivable_cycle: u64,
    /// Time of the last `set_streams` for this account (as a sender).
    pub update_time: u64,
    /// Timestamp at which this sender's balance is exhausted.
    pub max_end: u64,
    /// Sender balance snapshot at `update_time`.
    pub balance: i128,
}

/// Preprocessed stream window used by `calc_max_end`.
#[contracttype]
#[derive(Clone)]
pub struct ProcessedConfig {
    pub amt_per_sec: i128,
    pub start: u64,
    pub end: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum StreamsKey {
    /// Global cycle length in seconds (set once at init).
    CycleSecs,
    /// (token, account) -> StreamsState.
    State(Address, Address),
    /// (token, account) -> current receivers list.
    Receivers(Address, Address),
    /// (token, account, cycle) -> AmtDelta.
    Delta(Address, Address, u64),
}

// ───────────────────────── storage helpers ─────────────────────────

pub fn init(env: &Env, cycle_secs: u64) {
    let store = env.storage().instance();
    if store.has(&StreamsKey::CycleSecs) {
        panic!("already initialized");
    }
    if cycle_secs <= 1 {
        panic!("cycle_secs must be > 1");
    }
    store.set(&StreamsKey::CycleSecs, &cycle_secs);
}

pub fn cycle_secs(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&StreamsKey::CycleSecs)
        .expect("streams not initialized")
}

/// Minimum rate: at least one base unit per full cycle.
pub fn min_amt_per_sec(env: &Env) -> i128 {
    let cs = cycle_secs(env) as i128;
    (AMT_PER_SEC_MULTIPLIER + cs - 1) / cs
}

fn get_state(env: &Env, token: &Address, account: &Address) -> Option<StreamsState> {
    env.storage()
        .persistent()
        .get(&StreamsKey::State(token.clone(), account.clone()))
}

fn set_state(env: &Env, token: &Address, account: &Address, state: &StreamsState) {
    env.storage()
        .persistent()
        .set(&StreamsKey::State(token.clone(), account.clone()), state);
}

fn get_receivers(env: &Env, token: &Address, account: &Address) -> Vec<StreamReceiver> {
    env.storage()
        .persistent()
        .get(&StreamsKey::Receivers(token.clone(), account.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

fn set_receivers(env: &Env, token: &Address, account: &Address, recv: &Vec<StreamReceiver>) {
    env.storage()
        .persistent()
        .set(&StreamsKey::Receivers(token.clone(), account.clone()), recv);
}

fn get_delta(env: &Env, token: &Address, account: &Address, cycle: u64) -> Option<AmtDelta> {
    env.storage()
        .persistent()
        .get(&StreamsKey::Delta(token.clone(), account.clone(), cycle))
}

fn set_delta(env: &Env, token: &Address, account: &Address, cycle: u64, d: &AmtDelta) {
    env.storage()
        .persistent()
        .set(&StreamsKey::Delta(token.clone(), account.clone(), cycle), d);
}

fn remove_delta(env: &Env, token: &Address, account: &Address, cycle: u64) {
    let key = StreamsKey::Delta(token.clone(), account.clone(), cycle);
    if env.storage().persistent().has(&key) {
        env.storage().persistent().remove(&key);
    }
}

// ───────────────────────── pure helpers ─────────────────────────

fn now(env: &Env) -> u64 {
    env.ledger().timestamp()
}

/// Cycle containing `ts`. Cycle 0 never exists (ids start at 1).
fn cycle_of(ts: u64, cycle_secs: u64) -> u64 {
    ts / cycle_secs + 1
}

/// `a * b / denom` via a 256-bit intermediate, truncating toward zero (matching
/// Solidity/Rust integer division). Result must fit `i128`.
fn mul_div(env: &Env, a: i128, b: i128, denom: i128) -> i128 {
    I256::from_i128(env, a)
        .mul(&I256::from_i128(env, b))
        .div(&I256::from_i128(env, denom))
        .to_i128()
        .expect("mul_div overflows i128")
}

/// Amount streamed across `[start, end)` at `amt_per_sec`:
/// floor(end·rate) − floor(start·rate), in fixed point.
fn streamed_amt(env: &Env, amt_per_sec: i128, start: u64, end: u64) -> i128 {
    if end <= start {
        return 0;
    }
    let amt_end = mul_div(env, end as i128, amt_per_sec, AMT_PER_SEC_MULTIPLIER);
    let amt_start = mul_div(env, start as i128, amt_per_sec, AMT_PER_SEC_MULTIPLIER);
    amt_end - amt_start
}

/// Effective `[start, end)` of a config, clamped to `[start_cap, end_cap]`.
fn stream_range(
    c: &StreamConfig,
    update_time: u64,
    max_end: u64,
    start_cap: u64,
    end_cap: u64,
) -> (u64, u64) {
    let stream_start = if c.start == 0 { update_time } else { c.start };
    let mut stream_end = stream_start.saturating_add(c.duration);
    // duration 0 (== start) or past max_end ⇒ run to max_end.
    if stream_end == stream_start || stream_end > max_end {
        stream_end = max_end;
    }
    let start = stream_start.max(start_cap);
    let end = stream_end.min(end_cap).max(start);
    (start, end)
}

fn config_lt(a: &StreamConfig, b: &StreamConfig) -> bool {
    if a.stream_id != b.stream_id {
        return a.stream_id < b.stream_id;
    }
    if a.amt_per_sec != b.amt_per_sec {
        return a.amt_per_sec < b.amt_per_sec;
    }
    if a.start != b.start {
        return a.start < b.start;
    }
    a.duration < b.duration
}

/// Strict ordering of receivers: by account, then by config.
fn receiver_lt(a: &StreamReceiver, b: &StreamReceiver) -> bool {
    if a.account != b.account {
        return a.account < b.account;
    }
    config_lt(&a.config, &b.config)
}

// ───────────────────────── delta accounting ─────────────────────────

/// Apply `amt_per_sec` (signed) starting at `timestamp`, split across the two
/// cycle slots so whole-cycle summation reconstructs the exact streamed amount.
fn add_delta(
    env: &Env,
    token: &Address,
    account: &Address,
    timestamp: u64,
    amt_per_sec: i128,
    cycle_secs: u64,
) {
    let full_cycle = mul_div(env, cycle_secs as i128, amt_per_sec, AMT_PER_SEC_MULTIPLIER);
    let remainder = (timestamp % cycle_secs) as i128;
    let next_cycle = mul_div(env, remainder, amt_per_sec, AMT_PER_SEC_MULTIPLIER);
    let cycle = cycle_of(timestamp, cycle_secs);

    let mut delta = get_delta(env, token, account, cycle)
        .unwrap_or(AmtDelta { this_cycle: 0, next_cycle: 0 });
    delta.this_cycle += full_cycle - next_cycle;
    delta.next_cycle += next_cycle;
    set_delta(env, token, account, cycle, &delta);
}

/// Begin streaming `amt_per_sec` at `start` and stop it at `end`.
fn add_delta_range(
    env: &Env,
    token: &Address,
    account: &Address,
    start: u64,
    end: u64,
    amt_per_sec: i128,
    cycle_secs: u64,
) {
    if start == end {
        return;
    }
    add_delta(env, token, account, start, amt_per_sec, cycle_secs);
    add_delta(env, token, account, end, -amt_per_sec, cycle_secs);
}

/// Diff old vs new receivers with a two-pointer merge, nudging only the deltas
/// that change. Mirrors `Streams._updateReceiverStates`.
fn update_receiver_states(
    env: &Env,
    token: &Address,
    curr_receivers: &Vec<StreamReceiver>,
    last_update: u64,
    curr_max_end: u64,
    new_receivers: &Vec<StreamReceiver>,
    new_max_end: u64,
    cycle_secs: u64,
) {
    let curr_ts = now(env);
    let curr_len = curr_receivers.len();
    let new_len = new_receivers.len();
    let mut ci: u32 = 0;
    let mut ni: u32 = 0;

    loop {
        let mut pick_curr = ci < curr_len;
        let mut pick_new = ni < new_len;
        if !pick_curr && !pick_new {
            break;
        }

        let curr_recv = if pick_curr {
            Some(curr_receivers.get(ci).unwrap())
        } else {
            None
        };
        let new_recv = if pick_new {
            Some(new_receivers.get(ni).unwrap())
        } else {
            None
        };

        // When both remain, advance only the one that sorts first — unless they
        // are the *same* stream (same account+rate) differing only in timing, in
        // which case we shift it in place (pick both).
        if let (Some(c), Some(n)) = (&curr_recv, &new_recv) {
            if c.account != n.account || c.config.amt_per_sec != n.config.amt_per_sec {
                pick_curr = receiver_lt(c, n);
                pick_new = !pick_curr;
            }
        }

        if pick_curr && pick_new {
            // Shift an existing stream to its new window.
            let c = curr_recv.unwrap();
            let n = new_recv.unwrap();
            let (curr_start, curr_end) =
                stream_range(&c.config, last_update, curr_max_end, curr_ts, u64::MAX);
            let (new_start, new_end) =
                stream_range(&n.config, curr_ts, new_max_end, curr_ts, u64::MAX);
            let amt = c.config.amt_per_sec;
            // Move the start edge then the end edge, rather than full remove+add.
            add_delta_range(env, token, &c.account, curr_start, new_start, -amt, cycle_secs);
            add_delta_range(env, token, &c.account, curr_end, new_end, amt, cycle_secs);

            // If the stream now starts in an earlier cycle, let the receiver reach it.
            let curr_start_cycle = cycle_of(curr_start, cycle_secs);
            let new_start_cycle = cycle_of(new_start, cycle_secs);
            if curr_start_cycle > new_start_cycle {
                if let Some(mut st) = get_state(env, token, &c.account) {
                    if st.next_receivable_cycle > new_start_cycle {
                        st.next_receivable_cycle = new_start_cycle;
                        set_state(env, token, &c.account, &st);
                    }
                }
            }
            ci += 1;
            ni += 1;
        } else if pick_curr {
            // Remove a stream that is gone from the new list.
            let c = curr_recv.unwrap();
            let (start, end) =
                stream_range(&c.config, last_update, curr_max_end, curr_ts, u64::MAX);
            add_delta_range(env, token, &c.account, start, end, -c.config.amt_per_sec, cycle_secs);
            ci += 1;
        } else {
            // Create a brand-new stream.
            let n = new_recv.unwrap();
            let (start, end) =
                stream_range(&n.config, curr_ts, new_max_end, curr_ts, u64::MAX);
            add_delta_range(env, token, &n.account, start, end, n.config.amt_per_sec, cycle_secs);

            let start_cycle = cycle_of(start, cycle_secs);
            let mut st = get_state(env, token, &n.account).unwrap_or(StreamsState {
                next_receivable_cycle: 0,
                update_time: 0,
                max_end: 0,
                balance: 0,
            });
            if st.next_receivable_cycle == 0 || st.next_receivable_cycle > start_cycle {
                st.next_receivable_cycle = start_cycle;
                set_state(env, token, &n.account, &st);
            }
            ni += 1;
        }
    }
}

// ───────────────────────── balance & max_end ─────────────────────────

fn calc_balance(
    env: &Env,
    last_balance: i128,
    last_update: u64,
    max_end: u64,
    receivers: &Vec<StreamReceiver>,
    timestamp: u64,
) -> i128 {
    let mut balance = last_balance;
    for r in receivers.iter() {
        let (start, end) =
            stream_range(&r.config, last_update, max_end, last_update, timestamp);
        balance -= streamed_amt(env, r.config.amt_per_sec, start, end);
    }
    balance
}

/// Sender's remaining balance at `timestamp` (≥ its last update time).
pub fn balance_at(env: &Env, token: &Address, account: &Address, timestamp: u64) -> i128 {
    match get_state(env, token, account) {
        None => 0,
        Some(state) => {
            if timestamp < state.update_time {
                panic!("timestamp before last streams update");
            }
            let receivers = get_receivers(env, token, account);
            calc_balance(env, state.balance, state.update_time, state.max_end, &receivers, timestamp)
        }
    }
}

fn build_configs(
    env: &Env,
    receivers: &Vec<StreamReceiver>,
    min_amt: i128,
    curr_ts: u64,
) -> Vec<ProcessedConfig> {
    if receivers.len() > MAX_STREAMS_RECEIVERS {
        panic!("too many streams receivers");
    }
    let mut out: Vec<ProcessedConfig> = Vec::new(env);
    let mut prev: Option<StreamReceiver> = None;
    for r in receivers.iter() {
        if let Some(p) = &prev {
            if !receiver_lt(p, &r) {
                panic!("streams receivers not sorted/deduped");
            }
        }
        if r.config.amt_per_sec < min_amt {
            panic!("streams amt_per_sec below minimum");
        }
        // Future window: from now to "forever", clamped later by candidates.
        let (start, end) = stream_range(&r.config, curr_ts, u64::MAX, curr_ts, u64::MAX);
        if start != end {
            out.push_back(ProcessedConfig { amt_per_sec: r.config.amt_per_sec, start, end });
        }
        prev = Some(r);
    }
    out
}

fn is_balance_enough(env: &Env, balance: i128, configs: &Vec<ProcessedConfig>, max_end: u64) -> bool {
    let mut spent: i128 = 0;
    for c in configs.iter() {
        if max_end <= c.start {
            continue;
        }
        let capped_end = if c.end > max_end { max_end } else { c.end };
        spent += streamed_amt(env, c.amt_per_sec, c.start, capped_end);
        if spent > balance {
            return false;
        }
    }
    true
}

/// Binary search for the timestamp at which `balance` is exhausted by `receivers`.
pub fn calc_max_end(
    env: &Env,
    balance: i128,
    receivers: &Vec<StreamReceiver>,
    hint1: u64,
    hint2: u64,
) -> u64 {
    let curr_ts = now(env);
    let min_amt = min_amt_per_sec(env);
    let configs = build_configs(env, receivers, min_amt, curr_ts);

    if configs.is_empty() || balance == 0 {
        return curr_ts;
    }
    if is_balance_enough(env, balance, &configs, u64::MAX) {
        return u64::MAX;
    }

    // Work in u128 so the midpoint of two near-u64::MAX bounds cannot overflow.
    let mut enough: u128 = curr_ts as u128;
    let mut not_enough: u128 = u64::MAX as u128;

    for hint in [hint1, hint2] {
        let h = hint as u128;
        if h > enough && h < not_enough {
            if is_balance_enough(env, balance, &configs, hint) {
                enough = h;
            } else {
                not_enough = h;
            }
        }
    }

    loop {
        let mid = (enough + not_enough) / 2;
        if mid == enough {
            return mid as u64;
        }
        if is_balance_enough(env, balance, &configs, mid as u64) {
            enough = mid;
        } else {
            not_enough = mid;
        }
    }
}

// ───────────────────────── receiving ─────────────────────────

fn receivable_cycles_range(env: &Env, token: &Address, account: &Address, cycle_secs: u64) -> (u64, u64) {
    match get_state(env, token, account) {
        None => (0, 0),
        Some(state) => {
            let from = state.next_receivable_cycle;
            let to = cycle_of(now(env), cycle_secs);
            if from == 0 || to < from {
                (from, from)
            } else {
                (from, to)
            }
        }
    }
}

/// (received, from_cycle, to_cycle, trailing_rate) for receiving up to
/// `max_cycles` whole cycles. The trailing rate is what continues into
/// `to_cycle` and must be re-seeded after the consumed deltas are deleted.
fn receive_result(
    env: &Env,
    token: &Address,
    account: &Address,
    max_cycles: u32,
    cycle_secs: u64,
) -> (i128, u64, u64, i128) {
    let (from, to_raw) = receivable_cycles_range(env, token, account, cycle_secs);
    let to = if to_raw > from && (to_raw - from) > max_cycles as u64 {
        from + max_cycles as u64
    } else {
        to_raw
    };

    let mut received: i128 = 0;
    let mut rate: i128 = 0;
    if from < to {
        let mut cycle = from;
        while cycle < to {
            if let Some(d) = get_delta(env, token, account, cycle) {
                rate += d.this_cycle;
                received += rate;
                rate += d.next_cycle;
            } else {
                received += rate;
            }
            cycle += 1;
        }
    }
    (received, from, to, rate)
}

/// Receive all whole elapsed cycles (capped at `max_cycles`) for `account`,
/// deleting consumed deltas and carrying the trailing rate into `to_cycle`.
pub fn receive_streams(env: &Env, token: &Address, account: &Address, max_cycles: u32) -> i128 {
    let cs = cycle_secs(env);
    let (received, from, to, rate) = receive_result(env, token, account, max_cycles, cs);

    if from != to {
        let mut st = get_state(env, token, account).unwrap_or(StreamsState {
            next_receivable_cycle: 0,
            update_time: 0,
            max_end: 0,
            balance: 0,
        });
        st.next_receivable_cycle = to;
        set_state(env, token, account, &st);

        // Drop the consumed cycles so storage cannot grow without bound.
        let mut cycle = from;
        while cycle < to {
            remove_delta(env, token, account, cycle);
            cycle += 1;
        }

        // The trailing rate must persist as an absolute delta on `to_cycle`,
        // since the cycle it was relative to has just been zeroed.
        if rate != 0 {
            let mut d = get_delta(env, token, account, to)
                .unwrap_or(AmtDelta { this_cycle: 0, next_cycle: 0 });
            d.this_cycle += rate;
            set_delta(env, token, account, to, &d);
        }
    }
    received
}

/// Number of whole cycles currently receivable (for chunking large catch-ups).
pub fn receivable_streams_cycles(env: &Env, token: &Address, account: &Address) -> u64 {
    let cs = cycle_secs(env);
    let (from, to) = receivable_cycles_range(env, token, account, cs);
    if to > from {
        to - from
    } else {
        0
    }
}

// ───────────────────────── set_streams ─────────────────────────

/// Configure `account`'s streams of `token`. Returns the *real* balance delta
/// actually applied (a withdrawal is capped at the current balance), which the
/// caller uses to move the underlying token in/out of the vault.
pub fn set_streams(
    env: &Env,
    token: &Address,
    account: &Address,
    new_receivers: &Vec<StreamReceiver>,
    balance_delta: i128,
    max_end_hint1: u64,
    max_end_hint2: u64,
) -> i128 {
    let cs = cycle_secs(env);
    let curr_ts = now(env);

    // Snapshot the current balance from the prior config.
    let (curr_balance, last_update, curr_max_end) = match get_state(env, token, account) {
        None => (0i128, 0u64, 0u64),
        Some(state) => {
            let old = get_receivers(env, token, account);
            let bal = calc_balance(env, state.balance, state.update_time, state.max_end, &old, curr_ts);
            (bal, state.update_time, state.max_end)
        }
    };

    // A withdrawal cannot exceed the current balance.
    let real_balance_delta = if balance_delta < -curr_balance {
        -curr_balance
    } else {
        balance_delta
    };
    let new_balance = curr_balance + real_balance_delta;

    let new_max_end = calc_max_end(env, new_balance, new_receivers, max_end_hint1, max_end_hint2);

    let old_receivers = get_receivers(env, token, account);
    update_receiver_states(
        env,
        token,
        &old_receivers,
        last_update,
        curr_max_end,
        new_receivers,
        new_max_end,
        cs,
    );

    // Re-read so a self-stream's next_receivable_cycle bump (written inside
    // update_receiver_states) is preserved; then set the sender fields.
    let mut st = get_state(env, token, account).unwrap_or(StreamsState {
        next_receivable_cycle: 0,
        update_time: 0,
        max_end: 0,
        balance: 0,
    });
    st.update_time = curr_ts;
    st.max_end = new_max_end;
    st.balance = new_balance;
    set_state(env, token, account, &st);
    set_receivers(env, token, account, new_receivers);

    real_balance_delta
}

/// View: (next_receivable_cycle, update_time, max_end, balance).
pub fn streams_state(env: &Env, token: &Address, account: &Address) -> (u64, u64, u64, i128) {
    match get_state(env, token, account) {
        None => (0, 0, 0, 0),
        Some(s) => (s.next_receivable_cycle, s.update_time, s.max_end, s.balance),
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, vec};

    fn set_ts(env: &Env, ts: u64) {
        env.ledger().with_mut(|l| l.timestamp = ts);
    }

    /// One stream of 1 token/sec over a 10s cycle: after 3 whole cycles the
    /// receiver collects 30 and the sender's balance has dropped 100 → 70.
    #[test]
    fn stream_then_receive_over_cycles() {
        let env = Env::default();
        let id = env.register(crate::Drips, ());
        env.as_contract(&id, || {
            set_ts(&env, 0);
            init(&env, 10);

            let token = Address::generate(&env);
            let parent = Address::generate(&env);
            let kid = Address::generate(&env);

            // 1 unit/sec ⇒ amt_per_sec = 1 * MULTIPLIER. Deposit 100 units.
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
            let real = set_streams(&env, &token, &parent, &receivers, 100, 0, 0);
            assert_eq!(real, 100);

            // Funds last exactly 100s.
            let (_, _, max_end, bal) = streams_state(&env, &token, &parent);
            assert_eq!(max_end, 100);
            assert_eq!(bal, 100);

            // Advance 3 whole cycles (30s).
            set_ts(&env, 30);
            assert_eq!(receivable_streams_cycles(&env, &token, &kid), 3);
            let received = receive_streams(&env, &token, &kid, 100);
            assert_eq!(received, 30);

            // Sender balance at t=30 is 100 − 30 = 70.
            assert_eq!(balance_at(&env, &token, &parent, 30), 70);

            // Receiving again now yields nothing (no new whole cycle elapsed).
            assert_eq!(receive_streams(&env, &token, &kid, 100), 0);

            // One more cycle later, the next 10 units are receivable.
            set_ts(&env, 40);
            assert_eq!(receive_streams(&env, &token, &kid, 100), 10);
        });
    }
}
