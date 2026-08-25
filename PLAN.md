# Maestro → Starknet Port Plan

Port of maestro-redacted (Stellar) to Starknet, using **STRK20** as the privacy
layer. Route: **Wallet API** (`strk20-wallet-api`) — user-facing dapp acting
through the user's privacy-enabled wallet. No custom circuit, no Groth16, no
snarkjs, no relayer.

## What carries over vs. what's replaced

| From Soroban version | Fate |
| --- | --- |
| `zwtoken` + `groth16_verifier` + Circom circuit + snarkjs | **Delete.** STRK20 pool does it: shield reward = deposit note; private claim = unshield |
| Two wallets per kid (spending/stash) | Keep concept; stash = STRK20 notes owned by kid's account |
| Relayer for anonymity | **Delete** — STRK20 proofs are the anonymity set |
| `drips` contract | Rewrite in Cairo (Scarb) |
| `yield_manager` | Defer to stretch; if kept, Vesu integration via anonymizer pattern |
| React client (chores board, goals, streaks) | Port as-is, swap chain libs: `@stellar/*` → `starknet.js` + `useStrk20` hooks |
| AES-GCM family board relay (`apps/server`) | Port unchanged — chain-agnostic |

## Trust boundary (from strk20-privacy skill)

- Signing key: user's wallet (parent/kid). Viewing key: stays with user, never
  requested by app.
- Note discovery: wallet/SDK screens deposits.
- Proof + submit: wallet constructs STRK20_ACTION and proves on-chain.
- Hidden: which kid claimed what, note amounts/owners. Visible: pool totals,
  shield/unshield events exist.

## Stages

### Stage 1 — Skeleton & wallets (day 1)
- Scaffold `apps/client` from redacted client (strip Stellar deps), Vite + React.
- Wallet connect (Argent/Braavos, `WalletAccountV6`), auto-create flow for kids.
- Deploy target: Sepolia testnet, Alchemy RPC key in env (never committed).

### Stage 2 — Pot & chores, public layer (day 1–2)
- Parent funds pot (plain XLM/STRK transfers to a simple pot contract or EOA).
- Chores CRUD rides in the encrypted family-board relay blob (port server).
- Chore claim/approve flow, public spending-wallet payouts.

### Stage 3 — Private rewards via STRK20 (day 2–3) ← the core
- Parent shields reward amount into STRK20 pool when chore approved.
- Reward link (note id placeholder / open-note reference) stored in family blob.
- Kid unshields into their stash with one `STRK20_ACTION[]` batch.
- Shielded-balance UI via `useStrk20` hooks.

### Stage 4 — Allowance drips in Cairo (day 3–4)
- Scarb workspace `apps/contracts`: `drips` (per-second streaming, split across
  N recipients). Unit tests with starknet-foundry.
- Client scoop-to-stash button; stream lands in public spending wallet.

### Stage 5 — Goals, streaks, polish (day 4–5)
- Savings goal tracking against real balance, streak logic (client-side over
  on-chain history).
- Phone-width UI pass (~390px), demo script.

### Stretch — Yield & mainnet
- `yield_manager`: idle pot → Vesu via anonymizer `privacy_invoke` helper
  (strk20-anonymizer-contracts skill).
- Mainnet deploy, fill `strk20.json` (3 tx hashes touching the pool,
  contracts list, 3-min video, demo URL).

## Deliverables checklist (hackathon rules)

- [ ] `strk20.json`: transactions (3 mainnet pool txs), contracts, demo_video, demo_url
- [ ] Demo at phone width, 3-minute video
- [ ] Skills referenced during build: strk20-wallet-api (Stage 2–3),
      strk20-anonymizer-contracts (stretch)
