# Maestro demo shot list — 3-minute video (~180s)

Every shot maps to a real route in `apps/client/src/routes/`. Record at 390×844
(device frame), wallet on sepolia, dev flags on.

## Pre-flight checklist (before hitting record)

- [ ] Relay running: `cd apps/server && npm run dev` → `curl localhost:8787/health` returns ok
- [ ] Client running: `cd apps/client && npm run dev` → http://localhost:5173 loads
- [ ] `apps/client/.env.local` has: `VITE_ENABLE_DEV_MONEY=1`, `VITE_BOARD_URL=http://localhost:8787`,
      `VITE_DRIPS_ADDRESS_SEPOLIA=<from apps/contracts/deployments.sepolia.env>`
- [ ] Wallet (ArgentX/Braavos) unlocked, on **sepolia**, gas STRK present, popups allowed for localhost
- [ ] Demo board seeded: `node apps/server/scripts/seed-demo.mjs` and the printed
      `localStorage.setItem(...)` lines pasted into the browser console (both tabs), reloaded
- [ ] Parent wallet holds some shielded STRK (shield once at `/dev/money` before recording M-shots)
- [ ] Browser zoom ≤ 100%, viewport 390px wide, notifications silenced, clean browser profile

## Shots

| # | t | Screen (route) | Action | Expected on screen | Narration |
|---|---|----------------|--------|--------------------|-----------|
| 1 | 0:00–0:15 | `/` (index) + kid's phone lockscreen | Show empty allowance envelope / piggy bank | App welcome, "no login, no KYC" | "Pocket money is broken: cash disappears, bank accounts need KYC, and every 'I paid you' is a screenshot." |
| 2 | 0:15–0:30 | `/dev/board` | Open family board; kids Ava & Ben listed | Members list with two kids, addresses masked | "Maestro gives every family a shared board encrypted end-to-end — the relay stores ciphertext it can't read." |
| 3 | 0:30–0:50 | `/chores` (parent tab) | Post chore "Water the plants", reward 3 STRK | Chore appears with reward badge, state **todo** | "A parent posts chores with real rewards in STRK." |
| 4 | 0:50–1:10 | `/chores` (kid tab) | Kid taps "I did it" on the chore | State flips **todo → pending**, timestamped | "Ben claims he did it. Privately — no name hits a backend." |
| 5 | 1:10–1:40 | `/pot` (parent tab) | Parent taps **Approve** · wallet confirm popup shown briefly | Two-phase payout: state **paying → approved**, tx hash saved | "Approval fires a private transfer through the STRK20 pool. Starknet proves the note spend; nobody learns which kid got paid." *(if tx lingers >20s, cut to B-roll of architecture diagram, resume on 'approved')* |
| 6 | 1:40–2:05 | `/allowance` | Open split stream to the kids' current inboxes, shares 7:3 | "stream opened ✓ tx <hash>"; recipients weighted | "Allowances drip every second — but only ever to a fresh, disposable inbox each kid rotates in. Last month's inbox is dead; this one can't be traced to it." |
| 7 | 2:05–2:25 | `/stash` (kid tab) | Ava hits **Collect via inbox** → burner signs its own scoop → whole balance remints into STRK20 | "collected ✓ ... reminted into your shielded stash. Inbox rotated." | "Collection goes through the STRK20 pool and comes out as an unattributable note — then the inbox self-destructs. Watch the ledger try to follow that." |
| 8 | 2:25–2:45 | `/goals` | Show Ava's skateboard goal climbing toward target; streak counter | Goal progress bar moved after scoop; streak ≥ 4 | "Real balances climbing toward real goals — check-ins build a streak." |
| 9 | 2:45–3:00 | split-screen sepolia explorer over `/chores` | Show raw tx: only notes/nullifiers visible | Explorer shows note events, NO kid names/addresses linkage | "The chain settled all of it — and never learned which kid was which. That's Maestro." |

## Buffer/B-roll (cut away during any slow tx)
- Architecture diagram (STRK20 pool ↔ Cairo drips ↔ relay)
- `snforge test` terminal scrolling the 20 green tests
- Sepolia explorer tx view

## Recording notes
- One take per shot; mistakes are cut in edit, not restarted live.
- Shots 4→5 span tabs: record each tab separately, join on the chore title card.
- If a take shows any FAIL text, that's a product bug or pre-flight miss — fix, don't narrate around it (see failure table in task-a.md).
