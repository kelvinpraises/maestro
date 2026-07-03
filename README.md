# Maestro

A family allowance app for kids, built on Stellar. A parent funds a shared pot and posts chores with a reward on each. A kid does the chore, then claims that reward privately into their own stash. Allowances trickle in second by second, savings goals track a real balance, and every reward claim is unlinkable on the public ledger.

Everything here runs live on Stellar testnet. Real accounts, real transactions, real zero-knowledge proofs generated in the browser.

## What you can do

- **Chores and rewards.** A parent posts a chore. The kid taps "I did it", the parent nods, and a real reward moves on-chain.
- **Private claims.** The kid claims their reward with a zk proof made in the browser. The chain sees that a claim happened, never which kid it belonged to.
- **Allowance streams.** Money drips to a kid, or to several kids at once split among them, every couple of seconds. They scoop it into their stash whenever they like.
- **Goals and streaks.** Kids set a savings goal and watch a real balance climb toward it, with a streak for showing up.
- **No login, no KYC.** The app makes a Stellar wallet for you on first open. There is nothing to sign up for.

## How a private reward works

The private reward is a port of the ERC-8065 zero-knowledge token wrapper (see ZWToken) onto Soroban. The idea is simple: a reward is a secret note, not a line item with a name on it.

1. **Fund.** When a parent funds a reward, the app picks a random secret and computes a commitment, `Poseidon(secret, amount)`. It deposits the XLM into the family treasury and inserts that commitment as a leaf in a depth-20 Poseidon Merkle tree. The secret never touches the chain.
2. **Prove.** To claim, the kid's device rebuilds the tree from the on-chain leaves and generates a Groth16 proof in the browser with snarkjs. The proof says "I know the secret for one of these commitments, and I am owed this amount" without revealing which leaf is theirs.
3. **Pay.** The kid submits `remint` with the proof. The on-chain verifier checks it, the treasury pays the reward out, and a nullifier is consumed so the same note can never be claimed twice.

Poseidon is the load-bearing choice. A hash like Keccak is enormous inside a circuit, but Poseidon is cheap, so the whole proof generates in about a second in a browser with nothing behind it but a Stellar RPC node.

### Closing the trail

The deposit and the payout are unlinkable on-chain, but two small details would leak who claimed what if you were not careful, so the app handles both:

- **Two wallets per kid.** A kid holds a public *spending* wallet that receives the allowance stream, and a private *stash* wallet that only ever receives reward claims. Nothing public ever touches the stash, so a claim landing there ties back to nobody.
- **A relayer submits the claim.** `remint` needs no signature from the recipient, since the proof is what authorizes it, so a neutral relayer submits every claim. The kid's own wallet never appears as the sender. On-chain, every family's claims come from one relayer account, and that shared account is the anonymity set.

## What is on-chain

Four Soroban contracts, plus the native XLM asset they settle in. All live on Stellar testnet.

| Contract | What it does | Address |
| --- | --- | --- |
| `zwerc20` | Shielded family treasury. Holds the funds, stores reward commitments, pays private claims. | `CB4NCPRKEW4PQVCE74SGS42OAEMV75ULJTYHHZDC5UOVXGOBEAJF6PJH` |
| `groth16_verifier` | Checks the reward-claim proof on-chain. | `CAYENB4W7ALZPIPLAUPR64OSF47H52I5YL2QNKS5UUGRB65MNZBR7ZZE` |
| `drips` | Allowance streaming. Money that flows second by second, split across one or more kids. | `CBKYQ357VMHM4RVM6QK2UO324RSM75DD66LGFAOCDGJZCOWSERSEKHVH` |
| `yield_manager` | Puts idle pot money to work and tracks the growth separately. | `CAQKJBXQRRF4EUQWUZWHO2YBNUED6H5L5HTHAUZKBDZ2MCQTAF4DV2FB` |
| XLM (SAC) | The native asset the treasury holds. | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

Claims are relayed through a shared, gas-only account (`GAOICFNJH6G2SYL6EZHWWA2U2DOOJBHBJXQEXGWCI2RGOX2MLMB7CUOK`) so no kid wallet ever signs a claim. It holds no admin rights and is demo-grade; a production build would run the relayer as a service.

## Layout

```
apps/client      the phone-shaped web app (React, Vite)
apps/contracts   the four Soroban contracts, the circuit, and deployments.testnet.env
apps/packages    generated TypeScript clients for each contract
apps/server      the encrypted family board relay
context/         working notes, the design story, and the pitch (not shipped)
deploy.sh        one-shot testnet deploy
```

The family board is one AES-GCM blob per family, stored by the relay under a random id. The server cannot read a word of it. Chores, notices, and reward links ride inside that sealed blob, so the family syncs across devices while the infrastructure learns nothing.

## Run it

Contracts (the test suite and a deployable build):

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cd apps/contracts
cargo test
cargo build --target wasm32v1-none --release
```

The app (best viewed at phone width, around 390px):

```bash
cd apps/client
npm install
npm run dev        # http://localhost:5173
```

The family board relay (optional, for cross-device sync):

```bash
cd apps/server
npm run dev
```

## Credits

- **Marshmallow** for proving that crypto for kids can be warm and playful.
- **Drips** for the allowance streaming model.
- **ERC-8065 and ZWToken** for the zero-knowledge wrapper behind the private claims.
- **Screen Studio** for the UI craft that shaped how Maestro looks.
