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
}

#[starknet::contract]
pub mod Drips {
    use core::num::traits::{SaturatingAdd, SaturatingSub};
    use core::traits::TryInto;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};

    #[starknet::interface]
    pub trait IERC20<TState> {
        fn transfer_from(
            ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
        ) -> bool;
        fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        StreamOpened: StreamOpened,
        Claimed: Claimed,
        Paused: Paused,
        Resumed: Resumed,
        StreamClosed: StreamClosed,
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
        recipient: ContractAddress,
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
    }

    // ───────────── external ─────────────

    #[abi(embed_v0)]
    impl DripsImpl of super::IDrips<ContractState> {
        /// Open the single stream: pull `amount` of the native token from the
        /// caller (needs prior approval) and let it flow to `recipient` at
        /// `rate_per_sec` until it runs dry at `start + amount/rate`.
        fn open_stream(
            ref self: ContractState, recipient: ContractAddress, rate_per_sec: u128, amount: u256,
        ) -> u256 {
            assert(!self.active.read(), 'stream already open');
            assert(rate_per_sec > 0, 'rate must be positive');
            assert(amount > 0, 'amount must be positive');
            let zero: ContractAddress = TryInto::try_into(0).unwrap();
            assert(recipient != zero, 'recipient required');

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
            self.recipient.write(recipient);
            self.rate_per_sec.write(rate_per_sec);
            self.start.write(now_);
            self.end.write(end);
            self.deposited.write(amount);
            self.claimed_total.write(0);
            self.active.write(true);
            self.paused.write(false);

            self
                .emit(
                    Event::StreamOpened(
                        StreamOpened { sender, recipient, rate_per_sec, amount, start: now_, end },
                    ),
                );
            amount
        }

        /// View: accrued balance at arbitrary time `t`.
        fn accrued_at(self: @ContractState, t: u64) -> u256 {
            self.accrued_impl(t)
        }

        /// Pay out everything accrued but unclaimed. When the final claim
        /// drains the deposit (auto-reopen model), the slot is freed so a new
        /// `open_stream` needs no separate close tx.
        fn claim(ref self: ContractState) -> u256 {
            assert(self.active.read(), 'no active stream');

            let recipient = self.recipient.read();
            let total = self.accrued_impl(get_block_timestamp());
            let amount = total - self.claimed_total.read();
            assert(amount > 0, 'nothing to claim');

            // checks-effects-interactions: write before transfer
            self.claimed_total.write(total);
            if total == self.deposited.read() {
                self.active.write(false);
            }
            IERC20Dispatcher { contract_address: self.token.read() }.transfer(recipient, amount);

            self.emit(Event::Claimed(Claimed { recipient, amount }));
            amount
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
            assert(caller == self.sender.read() || caller == self.recipient.read(), 'unauthorized');
            assert(self.active.read(), 'no active stream');
            assert(get_block_timestamp() >= self.end.read(), 'not drained');

            self.active.write(false);
            self.deposited.write(0);
            self.emit(Event::StreamClosed(StreamClosed { caller }));
        }
    }
}
