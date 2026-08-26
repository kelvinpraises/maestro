# maestro contracts — drips v1

Cairo (Starknet) streaming allowances with private-pool integration ahead.
Workspace: Scarb 2.20 + Starknet-Foundry 0.63.

## Quickstart (what a judge should run, in this order)

```bash
# 0. toolchain (once)
curl -sSfL https://sh.starkup.sh | sh -s -- --yes     # scarb + snforge

# 1. build + full test suite — no network, ~1 min
scarb build && snforge test                            # expect: Tests: 20 passed

# 2. read the operator runbook without spending anything
./scripts/e2e.sh --from-step 3                         # prints deploy/verify plan + manual steps

# 3. real deployment (needs a funded account — see scripts/deploy.sh header)
DEPLOY_NETWORK=sepolia DEPLOY_ACCOUNT=<profile> \
DRIPS_TOKEN_ADDRESS=<token felt> ./scripts/e2e.sh      # deploy → verify → manual checklist
```

First-10-minutes breakers, answered:

- **No scarb/snforge?** step 0 installs both.
- **Tests fail?** they don't touch the network; failures are real bugs — file it.
- **Deploy fails "Profile not found"?** you need an sncast profile (`sncast account create/import`) and sepolia funds; `--from-step 3` still lets you read everything else.
- **Client shows no drips address?** set `VITE_DRIPS_ADDRESS_SEPOLIA` (or `_MAINNET`) from `deployments.<network>.env` after deploying.

## Architecture — drips v1 state machine

One funded stream slot per contract. States and transitions:

```
            open_stream / open_stream_split
  EMPTY ────────────────────────────────────► RUNNING
    ▲                                          │ │
    │                                    pause │ │ t ≥ end (dry-out)
    │                                     ▼    ▼ ▼
    │                                  PAUSED   DRAINED_UNCLAIMED
    │                                     │        │          │
    │                                resume       │          │ claim ×N (last sweeps dust)
    └─────────────────────────────────────────────┘◄─────────┘
                          close() also drains→EMPTY (dust forfeited)
```

- **RUNNING**: pool accrues `floor(elapsed · rate)` capped by deposit, lazily derived — nothing is written per second.
- **PAUSED** (sender-only): accrual frozen at pause-time (`elapsed_at_pause` + remaining window stored); claims pay the frozen amount; resume shifts start/end so only post-resume seconds accrue.
- **DRAINED_UNCLAIMED** (`t ≥ end`): whole deposit claimable. When a claim brings `Σclaimed == deposited`, the slot frees itself (**auto-reopen**) — a new `open_stream` needs no separate tx. `close()` exists for freeing a drained-but-unclaimed slot early; it refunds nothing (documented forfeit).
- Claims are **permissionless**: anyone may call `claim_as(r)`; funds always move to `r`. Checks-effects-interactions throughout (state written before transfers).

### Splits — weight semantics

`open_stream_split(recipients: Span<(ContractAddress, u128)>, rate_per_sec, amount)`:

- `WPS = Σ shares`; recipient i's entitlement at time t = `floor(pool(t) · share_i / WPS)`.
- Once dry: entitlement = `floor(deposited · share_i / WPS)`.
- **Dust policy — last-claimer sweeps.** Floor slices can sum below deposit; a settled-counter tracks recipients at dry-out entitlement, and the last one to settle receives their slice plus the remainder. The slot frees exactly when every unit is paid.
- Rejections: empty list, zero share, duplicate recipient.
- Single-recipient `open_stream(addr, rate, amount)` is sugar over `split([(addr,1)])` — one code path for both.

### Note-mirroring design constraint (why there are few getters)

The client derives state from emitted events plus pure views (`accrued_at`), mirroring how STRK20 notes are discovered. Deliberate: keeps the contract surface minimal and the indexer logic portable to the private pool.

## Scripts

| Script | What it does | Env vars | Flags |
|---|---|---|---|
| `scripts/deploy.sh` | declare (skip if unchanged) + deploy + record into `deployments.<network>.env` | `DEPLOY_NETWORK=sepolia\|mainnet`, `DEPLOY_ACCOUNT` (sncast profile), `DRIPS_TOKEN_ADDRESS` | `--dry-run` |
| `scripts/verify.sh` | on-chain e2e proof: opens a 101-unit 7:3 split stream, waits out the 101 s, asserts exact deltas r1 +70 / r2 +31 (incl. swept remainder), then proves the slot freed | `VERIFY_NETWORK`, `VERIFY_ACCOUNT`, `DRIPS_TOKEN_ADDRESS`, optional `VERIFY_RECIPIENT_1/2` | `--dry-run` |
| `scripts/e2e.sh` | orchestrates deploy → verify → prints the manual client-side checklist with exact routes and success criteria | same as deploy.sh | `--from-step N` |

All three are shellcheck-clean and idempotent or read-mostly; re-running never burns fees on unchanged state.

## Test inventory (20, all exact-value)

Core accrual & claim:
- `accrued_at_t0_mid_large` — accrued(100)=0, accrued(150)=500, accrued(300)=1000
- `double_claim_second_is_dust_only` — 990 then 15 swept; on-chain balances asserted
- `drained_claim_panics` — post-drain claim panics `'no active stream'`
- `empty_stream_claim_fails` — claim with no stream panics `'no active stream'`

Lifecycle:
- `pause_freezes_exact_values` — freeze at 500 forever; claim-while-paused pays frozen amount
- `resume_accrues_only_post_resume_seconds` — window [150,250]; accrued(200)=500, accrued(225)=750, dry pays 1000
- `close_then_reopen_works` — recipient closes; old recipient forfeits; fresh stream pays new recipient
- `unauthorized_pause_reverts` / `resume_without_pause_reverts` / `close_before_drain_reverts` / `unauthorized_close_reverts`

Splits:
- `uneven_split_exact_payout` — 7:3 of 100 → 70/30 exactly, slot freed
- `drained_split_slot_freed` — further claim_as after full drain panics
- `dust_swept_by_last_claimer` — three slices of 100 → 33/33/34, sweep proven on-chain
- `sibling_claims_are_isolated` — mid-stream slices 35/15 independent; pool view unchanged
- `split_reclaim_without_time_panics` — instant re-claim panics `'nothing to claim'`
- `zero_share_rejected` / `duplicate_recipient_rejected` / `empty_recipient_list_rejected` / `claim_as_non_recipient_reverts`

## Known limitations & upgrade paths

See [docs/TODO.md](docs/TODO.md).
