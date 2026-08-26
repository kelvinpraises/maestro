// Drips v0 — single-recipient per-second stream with lazily computed accrual.
//
// Ported from maestro-redacted/apps/contracts/drips/src/{lib,streams}.rs
// (Soroban/Rust). The OG cycle/delta machinery is dropped: with one recipient
// and no splits, accrual is simply floor(elapsed × rate) capped by the
// deposited amount — the same `streamed_amt` math from streams.rs:190-199.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IDrips<TState> {
    fn open_stream(
        ref self: TState, recipient: ContractAddress, rate_per_sec: u128, amount: u256,
    ) -> u256;
    fn accrued_at(self: @TState, t: u64) -> u256;
    fn claim(ref self: TState) -> u256;
    fn pause(ref self: TState);
    fn resume(ref self: TState);
    fn close(ref self: TState);
    fn open_stream_split(
        ref self: TState,
        recipients: Span<(ContractAddress, u128)>,
        rate_per_sec: u128,
        amount: u256,
    ) -> u256;
    fn claim_as(ref self: TState, who: ContractAddress) -> u256;
}

#[starknet::contract]
pub mod Drips {
    use core::num::traits::{SaturatingAdd, SaturatingSub};
    use core::traits::TryInto;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};

    #[starknet::interface]
    pub trait IERC20<TState> {
        fn transfer_from(
            ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool;
        fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    }

    #[derive(Drop, starknet::Event)]
    pub struct SplitOpened {
        pub sender: ContractAddress,
        pub rate_per_sec: u128,
        pub amount: u256,
        pub start: u64,
        pub end: u64,
        pub num: u32,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        StreamOpened: StreamOpened,
        Claimed: Claimed,
        Paused: Paused,
        Resumed: Resumed,
        StreamClosed: StreamClosed,
        SplitOpened: SplitOpened,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StreamOpened {
        pub sender: ContractAddress,
        pub recipient: ContractAddress,
        pub rate_per_sec: u128,
        pub amount: u256,
        pub start: u64,
        pub end: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Claimed {
        pub recipient: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Paused {}

    #[derive(Drop, starknet::Event)]
    pub struct Resumed {}

    #[derive(Drop, starknet::Event)]
    pub struct StreamClosed {
        pub caller: ContractAddress,
    }


    #[storage]
    struct Storage {
        token: ContractAddress,
        sender: ContractAddress,
        // splits v1: flat recipient list with weights
        recipient_list: Map<u32, ContractAddress>,
        shares: Map<ContractAddress, u128>,
        claimed_by: Map<ContractAddress, u256>,
        num_recipients: u32,
        wps: u256, // Σ shares
        settled_count: u32,
        rate_per_sec: u128,
        start: u64,
        end: u64,
        deposited: u256,
        claimed_total: u256,
        active: bool,
        paused: bool,
        // seconds of accrual credited when the stream was paused
        paused_elapsed: u64,
        // seconds from pause-time to the original end
        paused_remaining: u64,
    }

    #[constructor]
    fn constructor(ref self: ContractState, token: ContractAddress) {
        self.token.write(token);
    }

    // ───────────── internal ─────────────

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Lazily derived accrued balance at time `t`. While the stream runs:
        /// min(floor((t − start) · rate), deposited); once it has run dry
        /// (t ≥ end) the whole deposit — including floor-remainder dust —
        /// becomes claimable.
        fn accrued_impl(self: @ContractState, t: u64) -> u256 {
            if !self.active.read() {
                return 0;
            }
            let start = self.start.read();
            let end = self.end.read();
            // While paused, accrual is frozen at pause-time.
            let t = if self.paused.read() {
                start + self.paused_elapsed.read()
            } else {
                t
            };
            if t >= end {
                return self.deposited.read();
            }
            if t <= start {
                return 0;
            }
            let elapsed: u256 = (t - start).into();
            let accrued = elapsed * self.rate_per_sec.read().into();
            let deposited = self.deposited.read();
            if accrued > deposited {
                deposited
            } else {
                accrued
            }
        }

        /// Shared payout: everything `who` has accrued-but-unclaimed. When
        /// they are the last settled claimer after dry-out, sweep the pool
        /// remainder and free the slot.
        fn claim_as_impl(ref self: ContractState, who: ContractAddress) -> u256 {
            let share = self.shares.read(who);
            assert(share > 0, 'not a recipient');

            let total = self.accrued_impl(get_block_timestamp());
            let entitlement = total * share.into() / self.wps.read();
            let amount = entitlement - self.claimed_by.read(who);
            assert(amount > 0, 'nothing to claim');

            let now_ = get_block_timestamp();
            // checks-effects-interactions: all writes before the transfer
            self.claimed_by.write(who, entitlement);
            self.claimed_total.write(self.claimed_total.read() + amount);

            let mut sweep: u256 = 0;
            if now_ >= self.end.read() && total == self.deposited.read() {
                self.settled_count.write(self.settled_count.read() + 1);
                if self.settled_count.read() == self.num_recipients.read() {
                    // last settled claimer sweeps the floor dust
                    sweep = self.deposited.read() - self.claimed_total.read();
                    self.claimed_total.write(self.deposited.read());
                    self.active.write(false); // auto-reopen: slot freed
                }
            }

            IERC20Dispatcher { contract_address: self.token.read() }.transfer(who, amount + sweep);
            self.emit(Event::Claimed(Claimed { recipient: who, amount: amount + sweep }));
            amount + sweep
        }
    }

    // ───────────── external ─────────────

    #[abi(embed_v0)]
    impl DripsImpl of super::IDrips<ContractState> {
        /// Sugar over `open_stream_split` with a single (recipient, 1) share.
        fn open_stream(
            ref self: ContractState, recipient: ContractAddress, rate_per_sec: u128, amount: u256,
        ) -> u256 {
            let mut single = array![(recipient, 1_u128)];
            self.open_stream_split(single.span(), rate_per_sec, amount)
        }

        /// Open a stream splitting `amount` across weighted recipients.
        /// Entitlement of recipient i at time t:
        ///   floor(accrued_total(t) · share_i / WPS),  WPS = Σ shares
        /// Once dry (t ≥ end): floor(deposited · share_i / WPS).
        /// Floor dust (deposit − Σ floors) is swept by the last settled
        /// claimer after dry-out; the slot then frees itself.
        fn open_stream_split(
            ref self: ContractState,
            recipients: Span<(ContractAddress, u128)>,
            rate_per_sec: u128,
            amount: u256,
        ) -> u256 {
            assert(!self.active.read(), 'stream already open');
            assert(rate_per_sec > 0, 'rate must be positive');
            assert(amount > 0, 'amount must be positive');
            assert(recipients.len() > 0, 'recipients required');

            // Clear stale per-recipient state from the previous stream first.
            let old_count = self.num_recipients.read();
            let mut i = 0;
            while i < old_count {
                let prev = self.recipient_list.read(i);
                self.shares.write(prev, 0);
                self.claimed_by.write(prev, 0);
                i += 1;
            }

            let zero: ContractAddress = TryInto::try_into(0).unwrap();
            let mut wps: u256 = 0;
            let mut j: u32 = 0;
            while j < recipients.len() {
                let (addr, share) = *recipients.at(j);
                assert(share > 0, 'share must be positive');
                assert(addr != zero, 'recipient required');
                assert(self.shares.read(addr) == 0, 'duplicate recipient');
                self.recipient_list.write(j, addr);
                self.shares.write(addr, share);
                self.claimed_by.write(addr, 0);
                wps += share.into();
                j += 1;
            }

            let sender = get_caller_address();
            let dispatcher = IERC20Dispatcher { contract_address: self.token.read() };
            let ok = dispatcher.transfer_from(sender, get_contract_address(), amount);
            assert(ok, 'transfer_from failed');

            let now_ = get_block_timestamp();
            let duration_u256: u256 = amount / rate_per_sec.into();
            // ponytail: u256→u64 wrap only matters for absurdly low rates;
            // upgrade path is checked arithmetic on the full chain
            let duration: u64 = duration_u256.try_into().unwrap();
            let end = now_.saturating_add(duration);

            self.sender.write(sender);
            self.rate_per_sec.write(rate_per_sec);
            self.start.write(now_);
            self.end.write(end);
            self.deposited.write(amount);
            self.claimed_total.write(0);
            self.active.write(true);
            self.paused.write(false);
            self.num_recipients.write(recipients.len());
            self.wps.write(wps);
            self.settled_count.write(0);

            self
                .emit(
                    Event::SplitOpened(
                        SplitOpened { sender, rate_per_sec, amount, start: now_, end, num: j },
                    ),
                );
            amount
        }

        /// View: accrued balance at arbitrary time `t`.
        fn accrued_at(self: @ContractState, t: u64) -> u256 {
            self.accrued_impl(t)
        }

        /// Legacy sugar: claims for the sole recipient of an N=1 stream.
        fn claim(ref self: ContractState) -> u256 {
            assert(self.active.read(), 'no active stream');
            assert(self.num_recipients.read() == 1, 'use claim_as');
            self.claim_as_impl(self.recipient_list.read(0))
        }

        /// Permissionless: pay `who` everything accrued-but-unclaimed on their
        /// slice. When they are the last settled claimer after dry-out they
        /// also sweep the pool remainder and the slot frees itself.
        fn claim_as(ref self: ContractState, who: ContractAddress) -> u256 {
            assert(self.active.read(), 'no active stream');
            self.claim_as_impl(who)
        }

        /// Freeze accrual at pause-time. Sender-only.
        fn pause(ref self: ContractState) {
            assert(get_caller_address() == self.sender.read(), 'caller is not sender');
            assert(self.active.read(), 'no active stream');
            assert(!self.paused.read(), 'stream paused');

            let now_ = get_block_timestamp();
            let end = self.end.read();
            self.paused_elapsed.write(core::cmp::min(now_, end) - self.start.read());
            self.paused_remaining.write(end.saturating_sub(now_));
            self.paused.write(true);
            self.emit(Event::Paused(Paused {}));
        }

        /// Unfreeze: shift start/end so only post-resume seconds accrue.
        /// Sender-only.
        fn resume(ref self: ContractState) {
            assert(get_caller_address() == self.sender.read(), 'caller is not sender');
            assert(self.active.read(), 'no active stream');
            assert(self.paused.read(), 'not paused');

            let now_ = get_block_timestamp();
            self.start.write(now_ - self.paused_elapsed.read());
            self.end.write(now_.saturating_add(self.paused_remaining.read()));
            self.paused.write(false);
            self.emit(Event::Resumed(Resumed {}));
        }

        /// Free a drained-but-unclaimed slot. Dust is forfeited (refunds
        /// nothing). Sender or recipient only.
        fn close(ref self: ContractState) {
            let caller = get_caller_address();
            assert(caller == self.sender.read() || self.shares.read(caller) > 0, 'unauthorized');
            assert(self.active.read(), 'no active stream');
            assert(get_block_timestamp() >= self.end.read(), 'not drained');

            self.active.write(false);
            self.deposited.write(0);
            self.emit(Event::StreamClosed(StreamClosed { caller }));
        }
    }
}
