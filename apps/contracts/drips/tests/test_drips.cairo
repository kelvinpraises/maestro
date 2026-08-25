use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_block_timestamp,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use core::result::ResultTrait;
use core::traits::TryInto;
use starknet::ContractAddress;

use drips::drips::{IDripsDispatcher, IDripsDispatcherTrait};
use crate::mock_token::{ITestTokenDispatcher, ITestTokenDispatcherTrait};
use crate::mock_token::MockToken::{IMintableDispatcher, IMintableDispatcherTrait};

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

/// A fully drained stream has nothing left to claim.
#[test]
#[should_panic(expected: ('nothing to claim',))]
fn drained_claim_panics() {
    let (_token, drips) = setup(10);
    start_cheat_block_timestamp(drips.contract_address, 0);
    start_cheat_caller_address(drips.contract_address, sender());
    drips.open_stream(recipient(), 3, 10);
    stop_cheat_caller_address(drips.contract_address);

    start_cheat_block_timestamp(drips.contract_address, 4);
    drips.claim();
    drips.claim(); // second immediate claim: everything already taken
}

/// Claiming on a contract with no open stream must fail.
#[test]
#[should_panic(expected: ('no active stream',))]
fn empty_stream_claim_fails() {
    let (_token, drips) = setup(10);
    drips.claim();
}

