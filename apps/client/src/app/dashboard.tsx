// /dashboard — the Fridge Door. One home per family, role-aware magnets.
//
// Same route, two compositions (DESIGN-STORY §4 "Home structure" survivor):
//   • KID    — greeting by name, earnings hero (only when > 0 this week), stash
//              card, Today's Chores rows (todo → "I did it!" → waiting), rewards
//              mini-card.
//   • PARENT — family-name greeting, "Needs your nod" approvals FIRST (chores a
//              kid marked pending), family bank + top-up, chores overview, kids.
//
// The chore state machine (todo → pending → done) is per-device (useChoreStates).
// A kid device flips a chore to `pending` with "I did it!"; on the parent device
// that same chore surfaces in "Needs your nod". (In the demo both roles share one
// browser's localStorage; the gate flips `role` in localStorage to move between
// the two mirrors.)

import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import {
  BellIcon,
  SparkleIcon,
  ListChecksIcon,
  PiggyBankIcon,
  CaretRightIcon,
  GiftIcon,
  UsersIcon,
  BroomIcon,
  BankIcon,
  HandHeartIcon,
  CheckIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { EarningsHero } from "@/components/organisms/earnings-hero";
import { QuestCard, type QuestTint } from "@/components/molecules/quest-card";
import { IconTile, EmojiTile } from "@/components/atoms/icon-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/molecules/dialog";
import { Button } from "@/components/atoms/button";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { useMyRewards } from "@/hooks/use-rewards";
import { useFamily, useChoreStates } from "@/hooks/use-family";
import { loadFamily, type Chore, type ChoreState } from "@/lib/family";
import { zwerc20 } from "@/contracts/stellar";

export const Route = createFileRoute("/dashboard")({
  // A device with no family hasn't walked through the front door yet — send it to
  // /welcome. (Families arrive here from /setup, /join, or a returning visit.)
  beforeLoad: () => {
    if (typeof window !== "undefined" && !loadFamily()) {
      throw redirect({ to: "/welcome" });
    }
  },
  component: DashboardPage,
});

// Rotating pastel tints so a family's chores stay colorful without the parent
// picking a color per chore.
const CHORE_TINTS: QuestTint[] = ["blue", "purple", "pink", "green", "gold"];

/** One chore joined with this device's local todo/pending/done state. */
interface ChoreRow extends Chore {
  tint: QuestTint;
  status: ChoreState;
}

function DashboardPage() {
  // Chores come from the family store (shared via the invite link). Per-device
  // kid progress (todo/pending/done) lives in chore-states.
  const { family, role } = useFamily();
  const { states } = useChoreStates();

  const chores = useMemo<ChoreRow[]>(
    () =>
      (family?.chores ?? []).map((c, i) => ({
        ...c,
        tint: CHORE_TINTS[i % CHORE_TINTS.length],
        status: states[c.id] ?? "todo",
      })),
    [family, states],
  );

  // Parents see the team's-doing mirror; kids (and family-less devices, which the
  // beforeLoad won't actually reach) see the earn-it mirror.
  if (role === "parent") return <ParentHome chores={chores} />;
  return <KidHome chores={chores} />;
}

// ── Shared header ────────────────────────────────────────────────────────────

function HomeHeader({
  avatarSeed,
  fallback,
  fallbackTint,
  title,
  subtitle,
}: {
  avatarSeed: string;
  fallback: string;
  fallbackTint: string;
  title: React.ReactNode;
  subtitle: string;
}) {
  const navigate = useNavigate();
  return (
    <header className="flex items-center justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-12 shrink-0 rounded-2xl border-2 border-m-ink shadow-[var(--m-pop-sm)]">
          <AvatarImage
            src={`https://avatar.vercel.sh/${avatarSeed}.png`}
            alt=""
          />
          <AvatarFallback
            className={`rounded-2xl font-display text-lg font-bold ${fallbackTint}`}
          >
            {fallback}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-extrabold leading-tight">
            {title}
          </h1>
          <p className="truncate text-sm font-semibold text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => navigate({ to: "/settings" })}
        aria-label="Notifications"
        className="press-pop flex size-11 shrink-0 items-center justify-center rounded-2xl border-2 border-m-ink bg-card text-foreground shadow-[var(--m-pop-sm)]"
      >
        <BellIcon className="size-5" weight="bold" />
      </button>
    </header>
  );
}

// ── Live-plumbing footer (step 6 moves this into Me / For grown-ups) ─────────

function GrownupsFooter({ label }: { label: string }) {
  const { publicKey, xlmBalance, balanceLoaded, fund, isFunding } =
    useStellarWallet();

  // Proof of plumbing: read the treasury's `next_index()` through the zwerc20
  // bindings client (a real on-chain simulation). Should read 1 on a fresh tree.
  const [treeIndex, setTreeIndex] = useState<number | null>(null);
  const [treeError, setTreeError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tx = await zwerc20.next_index();
        if (!cancelled) setTreeIndex(Number(tx.result));
      } catch (err) {
        console.warn("[dashboard] zwerc20.next_index() read failed", err);
        if (!cancelled) setTreeError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const balance = xlmBalance === null ? 0 : parseFloat(xlmBalance);

  return (
    <footer className="card-pop bg-card/70 p-4 text-[11px] font-semibold text-muted-foreground">
      <p className="text-microlabel mb-2 text-muted-foreground/80">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <span>Wallet</span>
        <span className="font-mono tabular-nums">
          {publicKey.slice(0, 4)}…{publicKey.slice(-4)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span>XLM balance</span>
        <span className="tabular-nums">
          {!balanceLoaded ? "loading…" : `${balance.toFixed(2)} XLM`}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span>Treasury leaf index</span>
        <span className="tabular-nums">
          {treeError
            ? "unavailable"
            : treeIndex === null
              ? "reading…"
              : treeIndex}
        </span>
      </div>
      <button
        type="button"
        onClick={() => void fund()}
        disabled={isFunding}
        className="press-pop mt-3 h-9 w-full rounded-full border-2 border-m-ink bg-primary/20 font-display text-xs font-extrabold text-m-green-ink disabled:opacity-50"
      >
        {isFunding ? "Funding…" : "Top up test XLM"}
      </button>
    </footer>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  KID HOME — greeting + stash + Today's Chores. The earn-it mirror.
// ═════════════════════════════════════════════════════════════════════════════

function KidHome({ chores }: { chores: ChoreRow[] }) {
  const navigate = useNavigate();
  const { family } = useFamily();
  const { setChoreState } = useChoreStates();
  const { publicKey, xlmBalance } = useStellarWallet();

  const kidName = family?.kidName?.trim() || "there";

  // Real XLM balance drives the stash card. Unfunded is a valid 0, not an error.
  const stashBalance = useMemo(
    () => (xlmBalance === null ? null : parseFloat(xlmBalance)),
    [xlmBalance],
  );

  // "Stash" savings-goal target (sample copy).
  const stashGoalTarget = 25;

  // Private rewards on this device (notes + on-chain claimed status).
  const rewards = useMyRewards();
  const rewardViews = rewards.data ?? [];
  const claimableCount = rewardViews.filter((r) => !r.claimed).length;

  // Earned this week (XLM): this device's rewards claimed on-chain AND funded in
  // the last 7 days. A zero hero is a sad hero — first-day Zuri shouldn't open to
  // 0.00, so we skip the hero entirely below when this is 0.
  const earnedThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return rewardViews
      .filter((r) => r.claimed && r.createdAt >= weekAgo)
      .reduce((sum, r) => sum + r.amountXlm, 0);
  }, [rewardViews]);

  const choresLeft = chores.filter((c) => c.status !== "done").length;

  // The confirm-before-pending sheet: tapping a todo chore opens "I did it! ✋".
  const [confirmChore, setConfirmChore] = useState<ChoreRow | null>(null);

  // Who the kid is waiting on. We don't know the parent's name, so use the
  // warmest generic ("the grown-ups") — the eyes carry the "someone's checking"
  // energy from Story B.
  const waitingFor = "the grown-ups 👀";

  return (
    <div className="stagger-rise space-y-5">
      <HomeHeader
        avatarSeed={kidName === "there" ? publicKey || "kid" : kidName}
        fallback={(family?.kidName?.trim()?.[0] ?? "K").toUpperCase()}
        fallbackTint="bg-m-sky text-m-blue"
        title={`Hey ${kidName}!`}
        subtitle="Ready to earn?"
      />

      {/* Earnings hero — only when there's money to celebrate this week. */}
      {earnedThisWeek > 0 && (
        <EarningsHero amount={earnedThisWeek} streakDays={6} />
      )}

      {/* My Stash mini-card → treasury activity / earnings history. Step 4
          upgrades this with the live allowance drip. */}
      <button
        type="button"
        onClick={() => navigate({ to: "/history" })}
        className="animate-pop-in press-pop card-pop card-pop-butter flex w-full items-center gap-3 p-4 text-left"
      >
        <IconTile icon={PiggyBankIcon} tint="gold" bordered />
        <div className="shrink-0">
          <p className="text-microlabel whitespace-nowrap text-muted-foreground">
            My Stash
          </p>
          <p className="text-money whitespace-nowrap text-xl">
            {stashBalance === null ? "…" : stashBalance.toFixed(2)}
            <span className="ml-1 text-[11px] font-bold text-muted-foreground">
              XLM
            </span>
          </p>
        </div>
        <span className="mr-1 flex min-w-0 flex-1 flex-col items-end">
          <span className="max-w-full truncate text-[11px] font-bold text-muted-foreground">
            Goal: New Lego Set
          </span>
          <span className="max-w-full truncate text-[11px] font-extrabold tabular-nums text-m-green-ink">
            {stashGoalTarget.toFixed(0)} XLM
          </span>
        </span>
        <CaretRightIcon
          className="size-5 shrink-0 text-muted-foreground"
          weight="bold"
        />
      </button>

      {/* Rewards mini-card → private-claim flow. */}
      <button
        type="button"
        onClick={() => navigate({ to: "/rewards" })}
        className="animate-pop-in press-pop card-pop flex w-full items-center gap-3 p-4 text-left"
      >
        <IconTile icon={GiftIcon} tint="purple" bordered />
        <div className="min-w-0 flex-1">
          <p className="text-microlabel text-muted-foreground">Rewards</p>
          <p className="font-display text-xl font-extrabold">
            {claimableCount > 0
              ? `${claimableCount} ready to claim`
              : "Nothing to claim yet"}
          </p>
        </div>
        {claimableCount > 0 && (
          <span className="rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
            {claimableCount}
          </span>
        )}
        <CaretRightIcon className="size-5 text-muted-foreground" weight="bold" />
      </button>

      {/* Today's Chores — real chores from the family store. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <SparkleIcon className="size-4 text-m-gold" weight="fill" />
            Today&apos;s Chores
          </h2>
          {chores.length > 0 && (
            <span className="rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
              {choresLeft} Left
            </span>
          )}
        </div>

        {chores.length === 0 ? (
          <div className="card-pop bg-card/70 p-6 text-center">
            <IconTile
              icon={BroomIcon}
              tint="lilac"
              size="lg"
              className="mx-auto"
            />
            <p className="mt-2 font-display text-sm font-extrabold">
              No chores yet
            </p>
            <p className="mt-0.5 text-[13px] font-bold text-muted-foreground text-pretty">
              Your grown-up will add some soon!
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {chores.map((c) => (
              <ChoreRowKid
                key={c.id}
                chore={c}
                waitingFor={waitingFor}
                onTapTodo={() => setConfirmChore(c)}
              />
            ))}
          </div>
        )}
      </section>

      <GrownupsFooter label="Wallet" />

      {/* "I did it!" confirm — tapping a todo chore asks before waving it in. */}
      <Dialog
        open={!!confirmChore}
        onOpenChange={(o) => !o && setConfirmChore(null)}
      >
        <DialogContent>
          <DialogHeader>
            <div className="mx-auto mb-1">
              {confirmChore &&
                (confirmChore.emoji ? (
                  <EmojiTile emoji={confirmChore.emoji} tint="green" size="lg" bordered />
                ) : (
                  <IconTile icon={ListChecksIcon} tint="green" size="lg" bordered />
                ))}
            </div>
            <DialogTitle className="text-center">
              Did you finish&nbsp;{confirmChore?.name}?
            </DialogTitle>
            <DialogDescription className="text-center">
              We&apos;ll let {waitingFor.replace(" 👀", "")} know so they can send
              your {confirmChore ? confirmChore.rewardXlm.toFixed(2) : ""} XLM.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmChore(null)}>
              Not yet
            </Button>
            <Button
              onClick={() => {
                if (confirmChore) setChoreState(confirmChore.id, "pending");
                setConfirmChore(null);
              }}
            >
              I did it! ✋
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One kid chore row: todo taps to confirm; pending shows a waiting badge. */
function ChoreRowKid({
  chore,
  waitingFor,
  onTapTodo,
}: {
  chore: ChoreRow;
  waitingFor: string;
  onTapTodo: () => void;
}) {
  if (chore.status === "pending") {
    return (
      <div className="animate-pop-in card-pop card-pop-sky flex w-full items-center gap-3.5 p-3">
        {chore.emoji ? (
          <EmojiTile emoji={chore.emoji} tint="blue" size="lg" bordered />
        ) : (
          <IconTile icon={ListChecksIcon} tint="blue" size="lg" bordered />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-bold text-foreground">
            {chore.name}
          </p>
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-white/85 px-2.5 py-0.5 text-[11px] font-extrabold text-m-blue">
            Waiting for {waitingFor}
          </span>
        </div>
      </div>
    );
  }

  // todo / done → the shared chore-row card. Done renders celebrated (mint +
  // check) by QuestCard; todo taps open the "I did it!" confirm.
  return (
    <QuestCard
      title={chore.name}
      amount={chore.rewardXlm}
      icon={ListChecksIcon}
      emoji={chore.emoji}
      tint={chore.tint}
      status={chore.status}
      onClick={chore.status === "todo" ? onTapTodo : undefined}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  PARENT HOME — the nod + family bank + overview. The team's-doing mirror.
// ═════════════════════════════════════════════════════════════════════════════

function ParentHome({ chores }: { chores: ChoreRow[] }) {
  const navigate = useNavigate();
  const { family } = useFamily();
  const { setChoreState } = useChoreStates();

  const familyName = family?.name?.trim() || "your family";
  // One kid → attribute pending chores to them; otherwise stay generic.
  const soleKid =
    family && family.kidNames.length === 1 ? family.kidNames[0] : null;

  const pending = chores.filter((c) => c.status === "pending");
  const hasKids = (family?.kidNames.length ?? 0) > 0;

  return (
    <div className="stagger-rise space-y-5">
      <HomeHeader
        avatarSeed={familyName}
        fallback={familyName.charAt(0).toUpperCase()}
        fallbackTint="bg-m-lilac text-m-purple"
        title={familyName}
        subtitle="Here's how the team is doing."
      />

      {/* Needs your nod — approvals FIRST when non-empty. */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
              <HandHeartIcon className="size-4 text-m-green-ink" weight="duotone" />
              Needs your nod
            </h2>
            <span className="rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
              {pending.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {pending.map((c) => (
              <div key={c.id} className="animate-pop-in card-pop card-pop-mint p-3.5">
                <div className="flex items-center gap-3">
                  {c.emoji ? (
                    <EmojiTile emoji={c.emoji} tint="green" size="lg" bordered />
                  ) : (
                    <IconTile icon={ListChecksIcon} tint="green" size="lg" bordered />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[15px] font-extrabold">
                      {c.name}
                    </p>
                    <p className="text-[13px] font-bold text-muted-foreground">
                      {soleKid ? `${soleKid} says it's done` : "Marked done"}
                      {" · "}
                      <span className="font-extrabold tabular-nums text-m-green-ink">
                        {c.rewardXlm.toFixed(2)} XLM
                      </span>
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setChoreState(c.id, "todo")}
                  >
                    Not yet
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      // STEP-5 SEAM: the full pay-on-approve loop (fund reward →
                      // hand off claim link → kid celebration) lands in step 5.
                      // For now we route to the family screen's send-a-reward
                      // flow; there is no search-param prefill on /circles yet,
                      // so the parent picks the chore there. When step 5 wires
                      // fund-on-approve, replace this navigate with the mutation
                      // and flip the chore to "done" on success.
                      navigate({ to: "/circles" });
                    }}
                  >
                    <CheckIcon className="mr-1 size-4" weight="bold" />
                    Approve &amp; send
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Family bank — real XLM balance + top up. */}
      <FamilyBankCard />

      {/* Chores overview — read-only rows; manage on /circles. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <SparkleIcon className="size-4 text-m-gold" weight="fill" />
            Chores
          </h2>
          <button
            type="button"
            onClick={() => navigate({ to: "/circles" })}
            className="flex items-center gap-0.5 text-xs font-extrabold text-muted-foreground hover:text-foreground"
          >
            Manage
            <CaretRightIcon className="size-3.5" weight="bold" />
          </button>
        </div>

        {chores.length === 0 ? (
          <button
            type="button"
            onClick={() => navigate({ to: "/circles" })}
            className="animate-pop-in press-pop card-pop bg-card/70 flex w-full items-center gap-3 p-5 text-left"
          >
            <IconTile icon={BroomIcon} tint="lilac" size="lg" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-extrabold">
                No chores yet
              </p>
              <p className="text-[13px] font-bold text-muted-foreground text-pretty">
                Add a few and they show up on everyone&apos;s home.
              </p>
            </div>
            <CaretRightIcon className="size-5 text-muted-foreground" weight="bold" />
          </button>
        ) : (
          <div className="space-y-2.5">
            {chores.map((c) => (
              <div key={c.id} className="card-pop flex items-center gap-3 p-3">
                {c.emoji ? (
                  <EmojiTile emoji={c.emoji} tint="neutral" bordered />
                ) : (
                  <IconTile icon={ListChecksIcon} tint="neutral" bordered />
                )}
                <p className="min-w-0 flex-1 truncate font-display text-[15px] font-extrabold">
                  {c.name}
                </p>
                <span className="inline-flex items-center gap-1 rounded-full border border-m-ink/25 bg-white/70 px-2.5 py-0.5 text-[13px] font-extrabold tabular-nums text-m-green-ink">
                  +{c.rewardXlm.toFixed(2)} XLM
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Kids — chips, or a warm invite nudge when none has joined yet. */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <UsersIcon className="size-4 text-m-purple" weight="duotone" />
            Kids
          </h2>
        </div>

        {hasKids ? (
          <div className="flex flex-wrap gap-2.5">
            {family!.kidNames.map((k) => (
              <span
                key={k}
                className="flex items-center gap-2 rounded-full border-2 border-m-ink bg-m-sky py-1.5 pl-1.5 pr-3.5 shadow-[var(--m-pop-sm)]"
              >
                <span className="flex size-7 items-center justify-center rounded-full border-2 border-m-ink bg-card font-display text-sm font-extrabold text-m-blue">
                  {k.charAt(0).toUpperCase()}
                </span>
                <span className="font-display text-[15px] font-extrabold">{k}</span>
              </span>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate({ to: "/circles" })}
            className="animate-pop-in press-pop card-pop card-pop-lilac flex w-full items-center gap-3 p-5 text-left"
          >
            <IconTile icon={UserPlusIcon} tint="lilac" size="lg" bordered />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-extrabold">
                Invite your kid
              </p>
              <p className="text-[13px] font-bold text-muted-foreground text-pretty">
                Send a link — they join with no accounts, no passwords.
              </p>
            </div>
            <CaretRightIcon className="size-5 text-muted-foreground" weight="bold" />
          </button>
        )}
      </section>

      <GrownupsFooter label="For grown-ups" />
    </div>
  );
}

/** Family bank — the parent's wallet balance + a top-up affordance in-voice. */
function FamilyBankCard() {
  const { xlmBalance, balanceLoaded, fund, isFunding } = useStellarWallet();
  const balance = xlmBalance === null ? null : parseFloat(xlmBalance);

  return (
    <div className="animate-pop-in card-pop card-pop-butter p-4">
      <div className="flex items-center gap-3">
        <IconTile icon={BankIcon} tint="gold" bordered />
        <div className="min-w-0 flex-1">
          <p className="text-microlabel text-muted-foreground">Family bank</p>
          <p className="text-money text-2xl leading-tight">
            {!balanceLoaded || balance === null ? "…" : balance.toFixed(2)}
            <span className="ml-1 text-xs font-bold text-muted-foreground">
              XLM
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fund()}
          disabled={isFunding}
          className="press-pop shrink-0 rounded-full border-2 border-m-ink bg-primary px-4 py-2 font-display text-xs font-extrabold text-primary-foreground shadow-[var(--m-pop-sm)] disabled:opacity-50"
        >
          {isFunding ? "Topping up…" : "Top up"}
        </button>
      </div>
      <p className="mt-2.5 text-[12px] font-semibold text-muted-foreground text-pretty">
        Your family bank lives on Stellar — top it up any time to fund rewards.
      </p>
    </div>
  );
}
