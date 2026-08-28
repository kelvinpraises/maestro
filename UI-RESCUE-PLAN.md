# UI RESCUE PLAN — port the redacted shell, page by page

> Working file. Re-read at the start of EVERY turn. Strike items with `[x]` when
> done. Never write code that isn't a step below.

## Invariants (rank-ordered — these BEAT redacted's design when they clash)

- **I1:** All money-movement goes through our STRK20/drips modules — never port Stellar calls
- **I2:** Family state = encrypted board blob. Admin writes via `useBoard.mutate`, never their localStorage family store
- **I3:** Rewards = direct `privateTransfer` at chore approval. Claim-link screens are DROPPED, not ported
- **I4:** Allowance = rotating burner inboxes. Family screen's invite ALSO carries inbox instructions; `/stash` becomes inbox manager under Me
- **I5:** Wallet needed for tx, not for board participation. Guards on buttons, not routes

## Phase 0 — Removal (strip to bare shell)

- [x] 0.1 Kill invented header in `__root.tsx` (WalletButton + syncing pill out of the frame). Wallet access moves into /me. Syncing pill → tiny fixed pill bottom-left, only while syncing
- [x] 0.2 Kill 6-tab role-split text bar → exact redacted 3-tab BottomNav: Home / Family / Me, Phosphor icons (House/Users/Smiley), role-independent, sibling routes fold under Home
- [x] 0.3 `routes/index.tsx`: delete redirect hack — becomes the dashboard (Home) itself
- [x] 0.4 Route survivor set: KEEP /welcome /setup /join /dashboard /family /allowance /chores /me; KILL as routes: /pot (fold into dashboard), /stash + /goals (fold into Me/Home), /dev/* stays env-gated out of nav
- [x] 0.5 Keep our dependency-free toast (restyle to card-pop pill only if time; sonner NOT ported)
- [x] 0.6 Add ONE dependency: `@phosphor-icons/react`

## Phase 1 — Design tokens

- [x] 1.1 Port full token set from redacted styles: canvas dot-grid, m-butter/m-sky/m-lilac/m-gold/mint tints, m-pop shadows (sm/lg), --m-ink, font-display stack, microlabel
- [x] 1.2 Port utilities: press-pop, stagger-rise, animate-float-soft, animate-pop-in, card-pop variants (mint/sky)
- [x] 1.3 Verify: build green + visually dot-grid canvas renders

## Phase 2 — Shell + entry screens

- [x] 2.1 `__root.tsx`: exact redacted layout — fullscreen routes (/welcome /setup /join) render bare; everything else inside canvas column (max-w-md) + BottomNav. NO header chrome
- [x] 2.2 BottomNav component: copy redacted's (icon tabs, press-pop, active fill), adjust `match()` to our routes: Home↔/dashboard /allowance /chores; Family↔/family; Me↔/me /stash-remnants
- [ ] 2.3 `/welcome`: copy verbatim structure — piggy mascot tile, tagline "Chores your kids actually want to do…", two doors + kid explainer view. Grown-up→/setup, invite door→/join. (I5: no wallet prompt)
- [ ] 2.4 `/setup`: port 3-beat flow (name family → kid name chips → starter chores w/ emoji rows + custom dialog-lite). STRK rewards (I1). Finish = ensureFamily() + board mutate (I2) writing familyName, kids (name-only, address empty), chosen chores. NEW beat 4 (I2-forced): recovery code shown once + per-kid invite links (familyId+key inside link, I2)
- [ ] 2.5 `/join`: restyle mine with redacted's balloons + 3-step explainer card. On join: adopt familyId+key from link, role=kid, → /dashboard (I2)

## Phase 3 — Main screens

- [ ] 3.1 `/dashboard` (Home): port structure — kid chips + invite nudge, chores list w/ states, family-bank style summary card. Data = board (I2). Approve = our two-phase payout inline (I1/I3). Allowance card links /allowance (I4)
- [ ] 3.2 `/family`: port kids-list-with-invites + chore admin. NO reward-send flow (I3). Show per-kid inbox status (I4). Invite links from lib/invite
- [ ] 3.3 `/me`: connected wallet info, family recovery code (view/copy), burner inbox status + rotate button (I4), dev links if flag
- [ ] 3.4 Fold: /pot's approve logic lives in dashboard chores list; /stash burner mgmt → /me; /goals stays a route but reachable from Home card + Me (not a tab)
- [ ] 3.5 `/allowance`: restyle into shell; stays parent tool under Home
- [ ] 3.6 `/chores` (kid view): restyle into shell

## Phase 4 — Cleanup + verify

- [ ] 4.1 Delete dead routes/styles; routeTree regenerate
- [ ] 4.2 tsc + build + all node suites green
- [ ] 4.3 ./dev.sh boot; walk every page at 390px against redacted screenshots (dist/design-refs/*.png READ ONLY)
- [ ] 4.4 Update docs/demo-shotlist.md routes if any moved
- [ ] 4.5 Commit per phase (atomic), never push

## Rules for this work

- Master hands-on. No agent briefs unless something needs a full reimplementation
- After EVERY item: re-read this file, strike it, next item
- If redacted's design and an invariant clash: invariant wins, note the deviation inline in code comment
- No new UI inventions — if redacted doesn't have it, it doesn't exist (exception: invite-link beat 4, burner rotation — both I2/I4-forced)
