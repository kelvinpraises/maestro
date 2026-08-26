# drips v1 — known limitations & upgrade paths

Honest ledger of what the contract does NOT do yet, each with the reason it's
acceptable for this sprint and the path to fix it.

## Limitations

### 1. Single active stream slot
The whole contract holds one stream. Opening a second requires the first to
drain (auto-reopen) or be closed.
- **Why OK:** the product is per-family; one allowance pool at a time covers the demo, and auto-reopen makes turnover free.
- **Upgrade path:** key all storage under `Map<u32, StreamSlot>` (stream id from a counter). No logic changes — every read/write gains an id argument.

### 2. `close()` forfeits unclaimed dust
Closing a drained-but-unclaimed slot zeroes the deposit record; slices nobody claimed are burned.
- **Why OK:** documented and opt-in — the natural path is claiming, which sweeps everything by design.
- **Upgrade path:** on close, transfer each slice to its recipient instead of zeroing (`claim_as` loop inside close), or block close while `deposited > Σclaimed`.

### 3. Minimal getters — client mirrors state
Only `accrued_at` is exposed as a view; sender/recipient/window state must come from events.
- **Why OK:** note-mirroring constraint — STRK20 discovery works the same way, so the client indexer logic stays uniform across both contracts.
- **Upgrade path:** add views (`stream_state()` returning the storage struct) when a server-side indexer replaces event mirroring.

### 4. u256→u64 duration wrap at absurdly low rates
`duration = amount / rate` computed in u256 then `try_into`ed to u64 with `unwrap()`.
- **Why OK:** wrap needs rate < 1 raw unit per ~584M years of duration headroom — not reachable with real tokens.
- **Upgrade path:** checked arithmetic on the full chain (`checked_div` + saturating conversions).

### 5. Permissionless claims
Anyone may call `claim_as(r)`; funds always reach `r`, but third parties can force-settle your claim timing.
- **Why OK:** it's a feature (gas-less kids) and can never misdirect funds.
- **Upgrade path:** none needed; optionally restrict to recipient if UX ever demands.

### 6. Non-standard tokens returning false without reverting
Handled: `transfer_from`'s bool is asserted. Tokens that revert behave normally via propagation.
- **Upgrade path:** full ERC-20 conformance suite if we ever accept arbitrary tokens.

## Deferred by ruling

- **Idle-pot yield (Vesu via anonymizer):** rejected for this cycle — see agent-comms Round 6 memo. Design sketch lives in the root README ("future work"). Revisit scoped to post-demo mainnet.
