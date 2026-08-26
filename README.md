# Maestro

A family allowance app for kids, rebuilt on **Starknet** with **STRK20** privacy.

A parent funds a shared pot and posts chores with a reward on each. A kid does the chore, then claims that reward privately as an encrypted STRK20 note — arbitrary amounts, automatic change, STARK-proven on-chain. Allowances trickle in second by second, savings goals track a real balance, and every reward claim is unlinkable on the public ledger.

## What you can do

- **Chores and rewards.** A parent posts a chore. The kid taps "I did it", the parent nods, and the reward is shielded into STRK20.
- **Private claims.** The kid unshields their reward through the STRK20 pool. The chain sees a note spent, never which kid it belonged to.
- **Allowance streams.** Money drips to a kid, or to several kids split among them, every couple of seconds.
- **Goals and streaks.** Kids set a savings goal and watch a real balance climb toward it.
- **No login, no KYC.** The app makes a Starknet wallet for you on first open.

## Architecture

- **STRK20 pool** replaces the hand-rolled zk stack (no Circom, no Groth16, no snarkjs) — private reward claims are native notes with on-chain STARK verification.
- **Cairo contracts**: allowance drips streaming (single or weighted multi-kid splits, pause/resume, auto-freeing slots). See [apps/contracts/README.md](apps/contracts/README.md).
- **Client**: React/Vite phone-shaped web app.
- **Family board relay**: one AES-GCM blob per family; the server can read nothing.

## Status

🚧 Under active construction for the STRK20 Private Sprint.
- Contracts: drips v1 shipped — 20 exact-value tests green, sepolia deploy/verify pipeline ready (`apps/contracts/scripts/e2e.sh`).

## Future work: idle-pot yield (design sketch)

The pot's idle balance could earn yield instead of sitting still. Deliberately **not** built this sprint — here is the design we would ship next:

1. **Flow.** Pot funds live as STRK20 private notes. A small anonymizer helper contract exposes `privacy_invoke`: the pot session deposits a note into the helper (OpenNoteDeposit), the helper moves the underlying into a Vesu supply position, and returns a receipt note of equal value. Withdrawal inverts it: burn the receipt, Vesu withdraws, a fresh note is minted back to the pot — all balance changes proven via the balance-delta idiom so the helper never needs to know who owns what.
2. **Why our note model composes.** STRK20 notes are already bearer-style commitments with nullifier spending; an "interest-bearing wrapper note" is just a second commitment type whose value grows with the Vesu index at claim time. The pot's consent-gated reads (`shieldedBalances`) extend naturally to include wrapped positions.
3. **Audit-first list.** Before any mainnet yield: (a) the balance-delta check can't be gamed by reentrancy through the pool; (b) Vesu index drift between deposit and withdrawal can't strand a partial note; (c) the anonymizer never holds unaccounted slack (Σ notes minted == Σ underlying deposited + accrued); (d) fresh-account sequencing so the pot session can always spend its own receipts.
4. **Why not now.** Each of those is a wave of review, and the demo-critical path (chores → claims → streams) must not share risk surface with an experimental lending hop. Documented here as architectural intent; revisit post-demo.
