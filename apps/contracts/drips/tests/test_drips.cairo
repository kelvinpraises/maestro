use core::result::ResultTrait;
use core::traits::TryInto;
use drips::drips::{IDripsDispatcher, IDripsDispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use crate::mock_token::MockToken::{IMintableDispatcher, IMintableDispatcherTrait};
use crate::mock_token::{ITestTokenDispatcher, ITestTokenDispatcherTrait};

fn addr(a: felt252) -> ContractAddress {
    a.try_into().unwrap()
}

fn recipient() -> ContractAddress {
    addr(0xace)
}

fn sender() -> ContractAddress {
    addr(0xdad)
}

// Deploy MockToken + Drips(token); mint `balance` to sender; approve drips.
fn setup(balance: u256) -> (ITestTokenDispatcher, IDripsDispatcher) {
    let token_class = declare("MockToken").unwrap().contract_class();
    let (token_addr, _) = token_class.deploy(@array![]).unwrap();

    let drips_class = declare("Drips").unwrap().contract_class();
    let (drips_addr, _) = drips_class.deploy(@array![token_addr.into()]).unwrap();

    let sender = sender();
    let token = ITestTokenDispatcher { contract_address: token_addr };
    start_cheat_caller_address(token_addr, sender);
    IMintableDispatcher { contract_address: token_addr }.mint(sender, balance);
    // approve while still impersonating `sender` on the token contract
    token.approve(drips_addr, balance);
    stop_cheat_caller_address(token_addr);

    let drips = IDripsDispatcher { contract_address: drips_addr };
    (token, drips)
}

/// t=0 (stream start), mid-stream, and large-t accrual — exact values.
#[test]
fn accrued_at_t0_mid_large() {
    // rate 10/sec, amount 1000 → runs from t=100 to t=200.
    let (_token, drips) = setup(1000);
    start_cheat_block_timestamp(drips.contract_address, 100);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 1000);
    stop_cheat_caller_address(drips.contract_address);

    assert(drips.accrued_at(100) == 0, 'nothing at start');
    assert(drips.accrued_at(150) == 500, 'mid-stream');
    assert(drips.accrued_at(300) == 1000, 'capped at deposit');
}

/// Claim pays real tokens; the follow-up claim yields only rounding dust.
#[test]
fn double_claim_second_is_dust_only() {
    // rate 10/sec, amount 1005 → runs t=0..=99 for floor accrual; the
    // 5-unit floor remainder is released once the stream runs dry at t=100.
    let (token, drips) = setup(1005);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 1005);
    stop_cheat_caller_address(drips.contract_address);

    start_cheat_block_timestamp(drips.contract_address, 99);
    assert(drips.claim() == 990, 'claim just before dry-out');
    assert(token.balance_of(recipient()) == 990, 'tokens moved');

    // One tick later the stream runs dry and releases the dust.
    start_cheat_block_timestamp(drips.contract_address, 100);
    assert(drips.claim() == 15, 'second claim is dust');
    assert(token.balance_of(recipient()) == 1005, 'fully paid');
}

/// A fully drained stream auto-reopens on the final claim; a further claim
/// finds no active stream.
#[test]
#[should_panic(expected: ('no active stream',))]
fn drained_claim_panics() {
    let (_token, drips) = setup(10);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 3, 10);
    stop_cheat_caller_address(drips.contract_address);

    start_cheat_block_timestamp(drips.contract_address, 4);
    drips.claim();
    drips.claim(); // slot already freed by auto-reopen
}

/// Claiming on a contract with no open stream must fail.
#[test]
#[should_panic(expected: ('no active stream',))]
fn empty_stream_claim_fails() {
    let (_token, drips) = setup(10);
    drips.claim();
}

// ───────────── lifecycle: pause / resume / close
// ─────────────

/// Pause freezes accrual at pause-time; claim while paused pays the frozen
/// amount.
#[test]
fn pause_freezes_exact_values() {
    let (token, drips) = setup(1000);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 1000);
    stop_cheat_caller_address(drips.contract_address);

    // 50s elapsed → freeze at exactly 500.
    start_cheat_block_timestamp(drips.contract_address, 50);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.pause();
    stop_cheat_caller_address(drips.contract_address);

    // Time keeps passing but accrual is frozen.
    start_cheat_block_timestamp(drips.contract_address, 500);
    assert(drips.accrued_at(500) == 500, 'frozen at pause value');

    // Claim-while-paused pays the frozen amount.
    assert(drips.claim() == 500, 'claim pays frozen');
    assert(token.balance_of(recipient()) == 500, 'tokens moved');
    // Still frozen after the claim.
    assert(drips.accrued_at(501) == 500, 'still frozen post-claim');
}

/// Resume shifts the window so only post-resume seconds accrue.
#[test]
fn resume_accrues_only_post_resume_seconds() {
    let (token, drips) = setup(1000);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 1000);

    // Pause at t=50 with 500 accrued; stay paused for 150s.
    start_cheat_block_timestamp(drips.contract_address, 50);
    drips.pause();
    stop_cheat_caller_address(drips.contract_address);

    // Resume at t=200: window becomes [150, 250] — 50s credited + 50s left.
    start_cheat_block_timestamp(drips.contract_address, 200);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.resume();
    stop_cheat_caller_address(drips.contract_address);

    // No time passed since resume beyond the frozen credit.
    assert(drips.accrued_at(200) == 500, 'resume preserves frozen credit');
    // 25s of fresh accrual only.
    start_cheat_block_timestamp(drips.contract_address, 225);
    assert(drips.accrued_at(225) == 750, 'only post-resume seconds accrue');
    // Dry at t=250 → full deposit incl. remainder.
    start_cheat_block_timestamp(drips.contract_address, 260);
    assert(drips.accrued_at(260) == 1000, 'dry at shifted end');
    assert(drips.claim() == 1000, 'dry-out pays full deposit');
    assert(token.balance_of(recipient()) == 1000, 'fully paid');
}

/// Only the sender can pause/resume.
#[test]
#[should_panic(expected: ('caller is not sender',))]
fn unauthorized_pause_reverts() {
    let (_token, drips) = setup(100);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 100);
    stop_cheat_caller_address(drips.contract_address);

    start_cheat_caller_address(drips.contract_address, recipient());
    drips.pause();
}

#[test]
#[should_panic(expected: ('not paused',))]
fn resume_without_pause_reverts() {
    let (_token, drips) = setup(100);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 100);
    stop_cheat_caller_address(drips.contract_address);

    start_cheat_caller_address(drips.contract_address, sender());
    drips.resume();
}

/// Close frees a drained-but-unclaimed slot; then a new stream opens cleanly.
#[test]
fn close_then_reopen_works() {
    let (token, drips) = setup(200);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 100); // drains at t=10
    stop_cheat_caller_address(drips.contract_address);

    // Recipient may close too.
    start_cheat_block_timestamp(drips.contract_address, 11);
    start_cheat_caller_address(drips.contract_address, recipient());
    drips.close();
    stop_cheat_caller_address(drips.contract_address);

    // Old recipient got nothing (dust forfeited per spec).
    assert(token.balance_of(recipient()) == 0, 'close refunds nothing');

    // Slot free: sender reopens for a new recipient at t=20.
    let new_recipient = addr(0xbeef);
    start_cheat_block_timestamp(drips.contract_address, 20);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(new_recipient, 5, 100); // drains at t=40
    stop_cheat_caller_address(drips.contract_address);

    start_cheat_block_timestamp(drips.contract_address, 30);
    assert(drips.accrued_at(30) == 50, 'new stream accrues fresh');
    assert(drips.claim() == 50, 'new stream pays new recipient');
    assert(token.balance_of(new_recipient) == 50, 'new recipient paid');
    assert(token.balance_of(recipient()) == 0, 'old recipient got nothing');
}

/// Close before drain must fail.
#[test]
#[should_panic(expected: ('not drained',))]
fn close_before_drain_reverts() {
    let (_token, drips) = setup(100);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 100);
    stop_cheat_caller_address(drips.contract_address);

    start_cheat_block_timestamp(drips.contract_address, 5);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.close();
}

/// A third party can never close.
#[test]
#[should_panic(expected: ('unauthorized',))]
fn unauthorized_close_reverts() {
    let (_token, drips) = setup(100);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 10, 100);
    stop_cheat_caller_address(drips.contract_address);

    start_cheat_block_timestamp(drips.contract_address, 11);
    start_cheat_caller_address(drips.contract_address, addr(0xdead));
    drips.close();
}
