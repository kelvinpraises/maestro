// Minimal ERC-20 stand-in for the native token, test-only.
use starknet::ContractAddress;

#[starknet::interface]
pub trait ITestToken<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TState, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
}

#[starknet::contract]
pub mod MockToken {
    use core::traits::TryInto;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};

    #[starknet::interface]
    pub trait IMintable<TState> {
        fn mint(ref self: TState, to: ContractAddress, amount: u256);
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Transfer {
        pub from: ContractAddress,
        pub to: ContractAddress,
        pub value: u256,
    }

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        total_supply: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState) {}

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self.balances.write(to, self.balances.read(to) + amount);
            self.total_supply.write(self.total_supply.read() + amount);
            self.emit(Event::Transfer(Transfer { from: 0.try_into().unwrap(), to, value: amount }));
        }
    }

    #[abi(embed_v0)]
    impl TokenImpl of super::ITestToken<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'insufficient balance');
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.emit(Event::Transfer(Transfer { from: sender, to: recipient, value: amount }));
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            if spender != sender {
                let allowance = self.allowances.read((sender, spender));
                assert(allowance >= amount, 'insufficient allowance');
                self.allowances.write((sender, spender), allowance - amount);
            }
            let bal = self.balances.read(sender);
            assert(bal >= amount, 'insufficient balance');
            self.balances.write(sender, bal - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.emit(Event::Transfer(Transfer { from: sender, to: recipient, value: amount }));
            true
        }
    }

    #[abi(embed_v0)]
    impl MintableImpl of IMintable<ContractState> {
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            InternalImpl::mint(ref self, to, amount);
        }
    }
}
