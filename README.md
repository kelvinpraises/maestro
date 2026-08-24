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
- **Cairo contracts**: allowance drips streaming + yield manager.
- **Client**: React/Vite phone-shaped web app.
- **Family board relay**: one AES-GCM blob per family; the server can read nothing.

## Status

🚧 Under active construction for the STRK20 Private Sprint.
