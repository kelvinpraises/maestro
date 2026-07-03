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
  SparkleIcon,
  ListChecksIcon,
  PiggyBankIcon,
  CaretRightIcon,
  CheckCircleIcon,
  GiftIcon,
  UsersIcon,
  BroomIcon,
  BankIcon,
  HandHeartIcon,
  CheckIcon,
  UserPlusIcon,
  DropIcon,
  SpinnerGapIcon,
  CopyIcon,
  DownloadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EarningsHero } from "@/components/organisms/earnings-hero";
import { QuestCard, type QuestTint } from "@/components/molecules/quest-card";
import { ChoreCard } from "@/components/molecules/chore-card";
import { NoticesBell } from "@/components/molecules/notices-bell";
import { IconTile, EmojiTile } from "@/components/atoms/icon-tile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import { Button } from "@/components/atoms/button";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { cn } from "@/utils";
import { useMyRewards, useFundReward } from "@/hooks/use-rewards";
import {
  useFamily,
  useChoreStates,
  useKidStreak,
  useSavingsGoal,
  useScoopedThisWeek,
} from "@/hooks/use-family";
import {
  loadFamily,
  buildClaimLink,
  importNote,
  recordLocalNote,
  type Chore,
  type ChoreState,
  type FamilyRole,
  type ClaimLinkPayload,
} from "@/lib/family";
import { requestPostNotice } from "@/hooks/use-family-board";
import { useAllowanceDrip } from "@/hooks/use-allowance-drip";
import { useCollectAllowance, type CollectStep } from "@/hooks/use-allowance";
import { classifyTxError } from "@/lib/tx-errors";
import { useCountUp } from "@/hooks/use-count-up";

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

/** One chore joined with a stable tint (per-kid status is derived at render). */
interface ChoreRow extends Chore {
  tint: QuestTint;
}

function DashboardPage() {
  // Chores come from the family store (shared via the invite link). Per-kid
  // progress (todo/pending/done) lives in chore-states, freshness-derived.
  const { family, role } = useFamily();

  const chores = useMemo<ChoreRow[]>(
    () =>
      (family?.chores ?? []).map((c, i) => ({
        ...c,
        tint: CHORE_TINTS[i % CHORE_TINTS.length],
      })),
    [family],
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
  role,
  kidName,
}: {
  avatarSeed: string;
  fallback: string;
  fallbackTint: string;
  title: React.ReactNode;
  subtitle: string;
  /** Scopes the bell's inbox to this device's relevant notices. */
  role: FamilyRole | null;
  kidName?: string;
}) {
  // The bell is back, real this time: it opens the board notices inbox with an
  // unseen-count badge (audit survivor 8). No badge when there's nothing new.
  return (
    <header className="flex items-center justify-between gap-3">
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
      <NoticesBell role={role} kidName={kidName} />
    </header>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  KID HOME — greeting + stash + Today's Chores. The earn-it mirror.
// ═════════════════════════════════════════════════════════════════════════════

function KidHome({ chores }: { chores: ChoreRow[] }) {
  const navigate = useNavigate();
  const { family } = useFamily();
  const { setChoreState, stateFor } = useChoreStates();
  const { publicKey, xlmBalance } = useStellarWallet();

  const kidName = family?.kidName?.trim() || "there";
  // The name this kid device acts as when marking chores. Falls back to the
  // greeting name so a kid device that somehow lacks a kidName still records.
  const myName = family?.kidName?.trim() || kidName;

  // A kid sees chores assigned to them or unassigned ("anyone"); chores owned by
  // OTHER kids don't render here. Each row's status is this kid's own effective
  // (freshness-derived) state. A done chore LEAVES the active list and drops into
  // its own quiet, struck-through "Done" section (owner ask). Pending stays
  // active with its waiting badge. So we split into:
  //   1. MINE   — assigned to me, still active (todo/pending).
  //   2. ANYONE — shared chores, still active (todo/pending).
  //   3. DONE   — anything I completed this period, struck out at the bottom.
  const { mine, anyone, done } = useMemo(() => {
    const mine: { chore: ChoreRow; status: ChoreState }[] = [];
    const anyone: { chore: ChoreRow; status: ChoreState }[] = [];
    const done: { chore: ChoreRow; status: ChoreState }[] = [];
    for (const c of chores) {
      if (c.assignee && c.assignee !== myName) continue; // someone else's
      const status = stateFor(c, myName);
      if (status === "done") done.push({ chore: c, status });
      else if (c.assignee === myName) mine.push({ chore: c, status });
      else anyone.push({ chore: c, status });
    }
    return { mine, anyone, done };
  }, [chores, myName, stateFor]);

  const totalMine = mine.length + anyone.length + done.length;
  const choresLeft = mine.length + anyone.length;

  // Real XLM balance drives the stash card. Unfunded is a valid 0, not an error.
  const stashBalance = useMemo(
    () => (xlmBalance === null ? null : parseFloat(xlmBalance)),
    [xlmBalance],
  );

  // The kid-set savings goal (name + target). Null until the kid names one on
  // /me — the stash mini-card's goal line reads the same store.
  const { goal } = useSavingsGoal();

  // Private rewards on this device (notes + on-chain claimed status).
  const rewards = useMyRewards();
  const rewardViews = rewards.data ?? [];
  const claimableCount = rewardViews.filter((r) => !r.claimed).length;

  // Real streak: consecutive days with ≥1 chore done, from the done log.
  const streakDays = useKidStreak(myName);

  // Earned this week (XLM) = rewards this device claimed on-chain in the last 7
  // days PLUS allowance scooped in the last 7 days (audit issue 5 — the number
  // must match what the kid watched land). A zero hero is a sad hero, so we skip
  // the hero entirely below when this is 0.
  const scoopedThisWeek = useScoopedThisWeek();
  const earnedThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const fromRewards = rewardViews
      .filter((r) => r.claimed && r.createdAt >= weekAgo)
      .reduce((sum, r) => sum + r.amountXlm, 0);
    return fromRewards + scoopedThisWeek;
  }, [rewardViews, scoopedThisWeek]);

  // The chore card: tapping a chore opens it (todo → "I did it! ✋"; pending →
  // the waiting state). One component for both.
  const [cardChore, setCardChore] = useState<ChoreRow | null>(null);
  const cardStatus =
    cardChore ? (stateFor(cardChore, myName) as "todo" | "pending" | "done") : "todo";

  // Who the kid is waiting on. We don't know the parent's name, so use the
  // warmest generic ("the grown-ups") — the eyes carry the "someone's checking"
  // energy from Story B.
  const waitingFor = "the grown-ups 👀";

  const allDone = totalMine > 0 && choresLeft === 0;

  const openChore = (c: ChoreRow) => setCardChore(c);

  return (
    <div className="stagger-rise space-y-5">
      <HomeHeader
        avatarSeed={kidName === "there" ? publicKey || "kid" : kidName}
        fallback={(family?.kidName?.trim()?.[0] ?? "K").toUpperCase()}
        fallbackTint="bg-m-sky text-m-blue"
        title={`Hey ${kidName}!`}
        subtitle="Ready to earn?"
        role="kid"
        kidName={myName}
      />

      {/* Earnings hero — only when there's money to celebrate this week. */}
      {earnedThisWeek > 0 && (
        <EarningsHero amount={earnedThisWeek} streakDays={streakDays} />
      )}

      {/* My Stash — balance + the live allowance drip that pours into it. The
          faucet drips into the piggy bank you're looking at (DESIGN-STORY §4).
          Tapping it opens /me, where the stash's detail + goal live. */}
      <KidStashCard
        stashBalance={stashBalance}
        goalName={goal?.name}
        goalTarget={goal?.targetXlm}
        onOpen={() => navigate({ to: "/me" })}
      />

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

      {/* My chores today — active chores (mine, then anyone-chores); done ones
          leave the active list and collect struck-through in a quiet "Done"
          section at the bottom. */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
            <SparkleIcon className="size-4 text-m-gold" weight="fill" />
            My chores today
          </h2>
          {choresLeft > 0 && (
            <span className="rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
              {choresLeft} left
            </span>
          )}
        </div>

        {totalMine === 0 ? (
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
          <>
            {allDone && (
              <div className="card-pop card-pop-mint p-5 text-center">
                <p className="font-display text-lg font-extrabold text-m-green-ink">
                  You crushed everything today! 💪
                </p>
                <p className="mt-0.5 text-[13px] font-bold text-m-green-ink/70">
                  Come back tomorrow for more.
                </p>
              </div>
            )}

            {/* 1 — Mine (assigned to me). */}
            {mine.length > 0 && (
              <ChoreGroup label="Just for you">
                {mine.map(({ chore: c, status }) => (
                  <ChoreRowKid
                    key={c.id}
                    chore={c}
                    status={status}
                    waitingFor={waitingFor}
                    onOpen={() => openChore(c)}
                  />
                ))}
              </ChoreGroup>
            )}

            {/* 2 — Anyone-chores (shared, first-claim). */}
            {anyone.length > 0 && (
              <ChoreGroup label="Anyone can grab these">
                {anyone.map(({ chore: c, status }) => (
                  <ChoreRowKid
                    key={c.id}
                    chore={c}
                    status={status}
                    waitingFor={waitingFor}
                    onOpen={() => openChore(c)}
                  />
                ))}
              </ChoreGroup>
            )}

            {/* 3 — Done: out of the active list, struck through and quiet. */}
            {done.length > 0 && (
              <ChoreGroup label="Done">
                {done.map(({ chore: c, status }) => (
                  <ChoreRowKid
                    key={c.id}
                    chore={c}
                    status={status}
                    waitingFor={waitingFor}
                    onOpen={() => openChore(c)}
                  />
                ))}
              </ChoreGroup>
            )}
          </>
        )}
      </section>

      {/* The chore card — the doing moment's own room. Todo shows the one huge
          primary; pending shows the waiting state (same card). */}
      <ChoreCard
        chore={cardChore}
        status={cardStatus === "done" ? "todo" : cardStatus}
        waitingFor={waitingFor}
        open={!!cardChore && cardStatus !== "done"}
        onOpenChange={(o) => !o && setCardChore(null)}
        onConfirm={() => {
          if (cardChore) {
            setChoreState(cardChore.id, myName, "pending");
            // Tell the parent: "{kid} says it's done." The pending STATE already
            // syncs to the parent's nod queue (setChoreState pushes the board);
            // this posts a chore-pending NOTICE too, so the nod also lands in the
            // parent's bell + feed — the ask is news, not only a card to notice.
            // id keyed on (chore, kid, tap) so each distinct mark is one notice
            // and repeated board polls never duplicate it.
            requestPostNotice({
              id: `pending-${cardChore.id}-${myName}-${Date.now()}`,
              at: Date.now(),
              kind: "chore-pending",
              kidName: myName,
              text: cardChore.name,
              choreId: cardChore.id,
            });
          }
          setCardChore(null);
        }}
      />
    </div>
  );
}

/** A titled group inside "My chores today" with an in-voice ALL-CAPS microlabel. */
function ChoreGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <p className="text-microlabel px-1 text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * One kid chore row. todo/pending tap open the chore card; done renders quiet
 * and struck-through (muted mint + a small check) via QuestCard, and still opens
 * the card (read-only-ish) on tap. Pending keeps its own row with the waiting
 * badge, inside the active list (never in Done).
 */
function ChoreRowKid({
  chore,
  status,
  waitingFor,
  onOpen,
}: {
  chore: ChoreRow;
  status: ChoreState;
  waitingFor: string;
  onOpen: () => void;
}) {
  if (status === "pending") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="animate-pop-in press-pop card-pop card-pop-sky flex w-full items-center gap-3.5 p-3 text-left"
      >
        {chore.emoji ? (
          <EmojiTile emoji={chore.emoji} tint="blue" size="lg" bordered />
        ) : (
          <IconTile icon={ListChecksIcon} tint="blue" size="lg" bordered />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-bold text-foreground">
            {chore.name}
          </p>
          {chore.note && (
            <p className="truncate text-[12px] font-semibold text-foreground/60">
              {chore.note}
            </p>
          )}
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-white/85 px-2.5 py-0.5 text-[11px] font-extrabold text-m-blue">
            Waiting for {waitingFor}
          </span>
        </div>
      </button>
    );
  }

  // todo → the shared chore-row card, tap opens the chore card. done → celebrated
  // (mint + check) by QuestCard; still tappable to reopen its card.
  return (
    <QuestCard
      title={chore.name}
      amount={chore.rewardXlm}
      icon={ListChecksIcon}
      emoji={chore.emoji}
      note={chore.note}
      tint={status === "done" ? "green" : chore.tint}
      status={status}
      onClick={onOpen}
    />
  );
}

// ── Kid stash card: balance + live allowance drip + "Scoop it up" ────────────

/** Playful staged copy for the receive → split → collect pipeline. */
const SCOOP_COPY: Record<CollectStep, string> = {
  idle: "Scoop it up",
  receive: "Scooping…",
  split: "Pouring…",
  collect: "Pouring…",
  done: "Yours!",
  error: "Try again",
};

/**
 * The butter stash card. When an allowance is dripping in, it grows a mint drip
 * line ("+ dripping in · X waiting") whose number ticks live between polls, a
 * pulsing droplet, and a "Scoop it up" button that runs the collect pipeline and
 * counts the balance up on success. Zero-allowance kids see it exactly as before
 * (no drip line, no scoop) — the whole card is a plain button to history.
 */
function KidStashCard({
  stashBalance,
  goalName,
  goalTarget,
  onOpen,
}: {
  stashBalance: number | null;
  /** The kid's goal (from the shared store), or undefined when none is set. */
  goalName?: string;
  goalTarget?: number;
  onOpen: () => void;
}) {
  const { publicKey } = useStellarWallet();
  const drip = useAllowanceDrip(publicKey);
  const collect = useCollectAllowance();

  // Staged copy: the hook's mutation is one promise, so we time the stages
  // (receive → split → collect) to feel like the pipeline underneath rather than
  // reading intermediate steps the mutation doesn't expose.
  const [step, setStep] = useState<CollectStep>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Count the balance up on a successful scoop (old → new, ~800ms ease-out).
  const displayBalance = useCountUp(stashBalance ?? 0);

  const waitingXlm = drip.waitingXlm;
  const canScoop = drip.hasIncoming && waitingXlm > 0 && !collect.isPending;

  const runScoop = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canScoop) return;
    setStep("receive");
    timers.current.forEach(clearTimeout);
    timers.current = [
      setTimeout(() => setStep("split"), 900),
      setTimeout(() => setStep("collect"), 1800),
    ];
    collect.mutate(
      { to: publicKey },
      {
        onSuccess: () => {
          timers.current.forEach(clearTimeout);
          setStep("done");
          timers.current = [setTimeout(() => setStep("idle"), 1600)];
        },
        onError: () => {
          timers.current.forEach(clearTimeout);
          setStep("error");
          timers.current = [setTimeout(() => setStep("idle"), 2200)];
        },
      },
    );
  };

  const scooping = collect.isPending || step === "receive" || step === "split" || step === "collect";

  return (
    <div className="animate-pop-in card-pop card-pop-butter overflow-hidden">
      <button
        type="button"
        onClick={onOpen}
        className="press-pop flex w-full items-center gap-3 p-4 text-left"
      >
        <IconTile icon={PiggyBankIcon} tint="gold" bordered />
        <div className="shrink-0">
          <p className="text-microlabel whitespace-nowrap text-muted-foreground">
            My Stash
          </p>
          <p className="text-money whitespace-nowrap text-xl tabular-nums">
            {stashBalance === null ? "…" : displayBalance.toFixed(2)}
            <span className="ml-1 text-[11px] font-bold text-muted-foreground">
              XLM
            </span>
          </p>
        </div>
        {/* Goal line reads the shared store; hidden entirely when no goal set. */}
        {goalName && goalTarget ? (
          <span className="mr-1 flex min-w-0 flex-1 flex-col items-end">
            <span className="max-w-full truncate text-[11px] font-bold text-muted-foreground">
              Goal: {goalName}
            </span>
            <span className="max-w-full truncate text-[11px] font-extrabold tabular-nums text-m-green-ink">
              {goalTarget.toFixed(0)} XLM
            </span>
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <CaretRightIcon
          className="size-5 shrink-0 text-muted-foreground"
          weight="bold"
        />
      </button>

      {/* Drip line + Scoop — only when money is actually dripping in. */}
      {drip.hasIncoming && (
        <div className="border-t-2 border-m-ink/15 px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="drip-dot flex size-5 shrink-0 items-center justify-center rounded-full bg-m-mint text-m-green-ink"
            >
              <DropIcon className="size-3.5" weight="fill" />
            </span>
            <p className="min-w-0 flex-1 text-[13px] font-extrabold text-m-green-ink">
              Dripping in
              <span className="mx-1 text-m-green-ink/50">·</span>
              <span className="tabular-nums">{waitingXlm.toFixed(4)}</span>
              <span className="ml-1 text-[11px] font-bold text-m-green-ink/70">
                XLM waiting
              </span>
            </p>
          </div>

          {waitingXlm > 0 && (
            <button
              type="button"
              onClick={runScoop}
              disabled={!canScoop}
              className="press-pop mt-2.5 flex h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-m-ink bg-primary font-display text-base font-extrabold text-primary-foreground shadow-[var(--m-pop-sm)] hover:brightness-[1.03] disabled:opacity-60"
            >
              {scooping ? (
                <>
                  <SpinnerGapIcon className="size-5 animate-spin" weight="bold" />
                  {SCOOP_COPY[step === "idle" ? "receive" : step]}
                </>
              ) : step === "done" ? (
                <>
                  <SparkleIcon className="size-5" weight="fill" />
                  {SCOOP_COPY.done}
                </>
              ) : (
                <>
                  <DropIcon className="size-5" weight="fill" />
                  Scoop it up
                </>
              )}
            </button>
          )}

          {collect.isError && step === "error" && (
            <p className="mt-2 text-center text-[12px] font-bold text-m-pink text-pretty">
              {collect.errorMessage ??
                "The bank line is busy. Your money is safe, try again in a moment."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  PARENT HOME — the nod + family bank + overview. The team's-doing mirror.
// ═════════════════════════════════════════════════════════════════════════════

// The approve-flow state machine, per nod card (DESIGN-STORY §2 Story B / §5):
//   idle  →  funding   (parent tapped "Approve & send"; useFundReward running)
//   funding → funded   (deposit landed on-chain; claim link built, chore → done)
//         →  error     (fund failed; chore stays pending, retriable — Story D)
// `funded` shows the same-device hand-off: copy claim link, or drop the note
// straight into this device's stash (the demo shortcut).
type NodStage = "idle" | "funding" | "funded" | "error";

/** One "Needs your nod" card with its own pay-on-approve loop. */
function NodCard({
  chore,
  kidName,
  kidLivesHere,
  boardSynced,
  onDismiss,
  onPaid,
}: {
  chore: ChoreRow;
  kidName: string;
  kidLivesHere: boolean;
  /** True when this family syncs a board — the kid device auto-imports the reward. */
  boardSynced: boolean;
  onDismiss: () => void;
  onPaid: () => void;
}) {
  const fund = useFundReward();
  const [stage, setStage] = useState<NodStage>("idle");
  const [claimLink, setClaimLink] = useState("");
  const [added, setAdded] = useState(false);

  const approve = () => {
    setStage("funding");
    fund.mutate(
      { amountXlm: chore.rewardXlm, label: chore.name },
      {
        onSuccess: ({ note }) => {
          setClaimLink(buildClaimLink(note));
          setStage("funded");
          // Post a reward-ready notice carrying the claim payload. On a
          // board-synced family the kid device auto-imports it into /rewards
          // (no link pasting); the claim rides the AES-GCM-encrypted board, which
          // is the transport security here. The manual copy-link stays for
          // pre-board families and as a fallback.
          const claim: ClaimLinkPayload = {
            secret: note.secret,
            amountStroops: note.amountStroops,
            leafIndex: note.leafIndex,
            ...(note.label ? { label: note.label } : {}),
          };
          requestPostNotice({
            id: `reward-${chore.id}-${kidName}-${note.id.slice(0, 10)}`,
            at: Date.now(),
            kind: "reward-ready",
            kidName,
            amountXlm: chore.rewardXlm,
            label: chore.name,
            choreId: chore.id,
            claim,
          });
          // The chore is paid → celebrate it on the kid's home (done row).
          onPaid();
        },
        // Honest failure (Story D): stay on this card, chore stays pending.
        onError: () => setStage("error"),
      },
    );
  };

  const copyLink = () => {
    navigator.clipboard.writeText(claimLink).then(
      () => toast.success("Claim link copied. Hand it to your kid!"),
      () => toast.error("Couldn't copy, try again"),
    );
  };

  // Same-device demo shortcut: import the funded note into THIS device's stash
  // (the exact localStorage shape useMyRewards reads), so switching to the kid
  // role shows it ready to claim — no link round-trip.
  const addToStash = () => {
    if (!fund.data) return;
    const wrote = importNote(fund.data.note);
    window.dispatchEvent(new Event("maestro:reward-notes-changed"));
    setAdded(true);
    toast.success(
      wrote ? "Added to this device's stash 🎁" : "Already in the stash",
    );
  };

  const kidLabel = kidName || "your kid";

  // ── funded: the reward is hidden; offer the hand-off ─────────────────────────
  if (stage === "funded") {
    return (
      <div className="animate-pop-in card-pop card-pop-mint p-3.5">
        <div className="flex items-center gap-3">
          <IconTile icon={GiftIcon} tint="green" size="lg" bordered />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-[15px] font-extrabold">
              Reward hidden for {kidLabel} 🎁
            </p>
            <p className="text-[13px] font-bold text-muted-foreground">
              <span className="font-extrabold tabular-nums text-m-green-ink">
                {chore.rewardXlm.toFixed(2)} XLM
              </span>{" "}
              tucked away · {chore.name}
            </p>
          </div>
        </div>
        {/* When the family is board-synced, the reward already flew to the kid's
            phone (auto-import); the link becomes an also-can, not the main path. */}
        {boardSynced && (
          <p className="mt-2.5 text-[13px] font-bold text-m-green-ink text-pretty">
            Sent to {kidLabel}&apos;s phone. You can also copy a link.
          </p>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <Button size="sm" className="w-full" onClick={copyLink}>
            <CopyIcon className="mr-1.5 size-4" weight="bold" />
            Copy claim link
          </Button>
          {kidLivesHere && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={addToStash}
                disabled={added}
                className="press-pop flex w-full items-center justify-center gap-1.5 rounded-full border-2 border-m-ink/25 bg-white/60 px-3.5 py-2.5 font-display text-[13px] font-extrabold text-foreground disabled:opacity-60"
              >
                <DownloadSimpleIcon className="size-4" weight="bold" />
                {added ? "In this device's stash" : "Add to this device's stash"}
              </button>
              <p className="px-1 text-center text-[11px] font-bold text-muted-foreground text-pretty">
                {kidName ? `Reward sent to ${kidName}.` : "Reward sent."}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="press-pop mt-0.5 text-center text-[12px] font-extrabold text-muted-foreground hover:text-foreground"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── idle / funding / error: the nod itself ───────────────────────────────────
  const funding = stage === "funding" || fund.isPending;

  return (
    <div className="animate-pop-in card-pop card-pop-mint p-3.5">
      <div className="flex items-center gap-3">
        {chore.emoji ? (
          <EmojiTile emoji={chore.emoji} tint="green" size="lg" bordered />
        ) : (
          <IconTile icon={ListChecksIcon} tint="green" size="lg" bordered />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-extrabold">
            {chore.name}
          </p>
          <p className="text-[13px] font-bold text-muted-foreground">
            {`${kidName} says it's done`}
            {" · "}
            <span className="font-extrabold tabular-nums text-m-green-ink">
              {chore.rewardXlm.toFixed(2)} XLM
            </span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={funding}
          onClick={onDismiss}
        >
          Not yet
        </Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={funding}
          onClick={approve}
        >
          {funding ? (
            <>
              <SpinnerGapIcon className="mr-1 size-4 animate-spin" weight="bold" />
              Tucking it away…
            </>
          ) : (
            <>
              <CheckIcon className="mr-1 size-4" weight="bold" />
              Approve &amp; send {chore.rewardXlm.toFixed(2)} XLM
            </>
          )}
        </Button>
      </div>
      {stage === "error" && (
        <p className="mt-2 text-center text-[12px] font-bold text-m-pink text-pretty">
          {fund.error
            ? classifyTxError(fund.error, "fund").kidMessage
            : "The bank line is busy. Nothing was sent, tap Approve to try again."}
        </p>
      )}
    </div>
  );
}

function ParentHome({ chores }: { chores: ChoreRow[] }) {
  const navigate = useNavigate();
  const { family } = useFamily();
  const { setChoreState, statesFor } = useChoreStates();

  const familyName = family?.name?.trim() || "your family";

  // Funding a nod marks that kid's entry "done" (so it celebrates on the kid's
  // home), but the parent still needs the funded card's hand-off (copy link /
  // add to stash). So we keep any (chore, kid) we just funded in the nod queue
  // until the parent dismisses it — the pending filter alone would yank the card
  // mid-hand-off. Keyed per chore+kid ("choreId::kidName").
  const [justFunded, setJustFunded] = useState<Set<string>>(new Set());
  const nodKey = (choreId: string, kid: string) => `${choreId}::${kid}`;

  // The nod queue: one card per (chore, kid) with a fresh pending entry — for
  // ANY number of kids ("Zuri says it's done", "Kofi says it's done"). Plus any
  // (chore, kid) we just funded (held for the hand-off).
  const nodEntries = useMemo(() => {
    const out: { chore: ChoreRow; kidName: string }[] = [];
    for (const c of chores) {
      // statesFor returns fresh pending/done per kid. A just-funded entry is
      // "done" here but stays in the queue via justFunded until dismissed.
      for (const [kid, st] of Object.entries(statesFor(c))) {
        if (st === "pending" || justFunded.has(nodKey(c.id, kid))) {
          out.push({ chore: c, kidName: kid });
        }
      }
    }
    return out;
  }, [chores, statesFor, justFunded]);
  const hasKids = (family?.kidNames.length ?? 0) > 0;
  // Board-synced when this family carries both board coordinates — the reward
  // auto-imports on the kid device, so the funded card says "Sent to their phone".
  const boardSynced = !!(family?.boardId && family?.familyKey);

  // Same-device demo reality (DESIGN-STORY §5, step 5): in the demo, the parent
  // and kid share one browser's localStorage — so after funding we can offer to
  // drop the reward straight into THIS device's stash (importNote), no link
  // round-trip. In a real two-device family the parent would only copy/share the
  // link. We surface both: copy link (primary) + add-to-this-stash (secondary).
  // ParentHome only ever renders on a parent device, so this is always true;
  // named for intent so the NodCard's demo affordance reads honestly.
  const kidLivesHere = true;

  return (
    <div className="stagger-rise space-y-5">
      <HomeHeader
        avatarSeed={familyName}
        fallback={familyName.charAt(0).toUpperCase()}
        fallbackTint="bg-m-lilac text-m-purple"
        title={familyName}
        subtitle="Here's how the team is doing."
        role="parent"
      />

      {/* Needs your nod — approvals FIRST when non-empty. One card per (chore,
          kid): "Zuri says it's done" and "Kofi says it's done" stand apart. */}
      {nodEntries.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
              <HandHeartIcon className="size-4 text-m-green-ink" weight="duotone" />
              Needs your nod
            </h2>
            <span className="rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-xs font-extrabold text-m-green-ink">
              {nodEntries.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {nodEntries.map(({ chore: c, kidName: kid }) => (
              <NodCard
                key={nodKey(c.id, kid)}
                chore={c}
                kidName={kid}
                kidLivesHere={kidLivesHere}
                boardSynced={boardSynced}
                onDismiss={() => {
                  // Dismiss a not-yet-funded card = clear THAT kid's entry (→ todo).
                  // Dismiss ("Done") after funding = just drop it from the queue.
                  if (!justFunded.has(nodKey(c.id, kid)))
                    setChoreState(c.id, kid, null);
                  setJustFunded((s) => {
                    const next = new Set(s);
                    next.delete(nodKey(c.id, kid));
                    return next;
                  });
                }}
                onPaid={() => {
                  setChoreState(c.id, kid, "done");
                  setJustFunded((s) => new Set(s).add(nodKey(c.id, kid)));
                  // Warm, attributable family-feed note (this device's local log).
                  recordLocalNote({
                    kind: "reward-ready",
                    kidName: kid,
                    text: `A reward for ${kid}: ${c.name}`,
                  });
                }}
              />
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
            onClick={() => navigate({ to: "/family" })}
            className="flex items-center gap-0.5 text-xs font-extrabold text-muted-foreground hover:text-foreground"
          >
            Manage
            <CaretRightIcon className="size-3.5" weight="bold" />
          </button>
        </div>

        {chores.length === 0 ? (
          <button
            type="button"
            onClick={() => navigate({ to: "/family" })}
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
            {chores.map((c) => {
              // Reflect what the kids have done, so approving a nod visibly
              // resolves the chore here too (owner ask: it should "move to done").
              const st = statesFor(c);
              const doneKids = Object.entries(st).filter(([, s]) => s === "done").map(([k]) => k);
              const waiting = Object.values(st).some((s) => s === "pending");
              const isDone = doneKids.length > 0;
              return (
                <div key={c.id} className={cn("card-pop flex items-center gap-3 p-3", isDone && "bg-m-mint/40")}>
                  {c.emoji ? (
                    <EmojiTile emoji={c.emoji} tint="neutral" bordered />
                  ) : (
                    <IconTile icon={ListChecksIcon} tint="neutral" bordered />
                  )}
                  <p className={cn("min-w-0 flex-1 truncate font-display text-[15px] font-extrabold", isDone && "text-foreground/55 line-through decoration-2")}>
                    {c.name}
                  </p>
                  {isDone ? (
                    <span className="inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-primary/20 px-2.5 py-0.5 text-[13px] font-extrabold text-m-green-ink">
                      <CheckCircleIcon className="size-3.5" weight="fill" />
                      {doneKids.length === 1 ? doneKids[0] : `${doneKids.length} done`}
                    </span>
                  ) : waiting ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-m-ink/25 bg-m-sky/60 px-2.5 py-0.5 text-[13px] font-extrabold text-m-blue">
                      Waiting
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-m-ink/25 bg-white/70 px-2.5 py-0.5 text-[13px] font-extrabold tabular-nums text-m-green-ink">
                      +{c.rewardXlm.toFixed(2)} XLM
                    </span>
                  )}
                </div>
              );
            })}
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
              <button
                key={k}
                type="button"
                onClick={() => navigate({ to: "/family", search: { g: "kids" } })}
                className="press-pop flex items-center gap-2 rounded-full border-2 border-m-ink bg-m-sky py-1.5 pl-1.5 pr-3.5 shadow-[var(--m-pop-sm)]"
              >
                <span className="flex size-7 items-center justify-center rounded-full border-2 border-m-ink bg-card font-display text-sm font-extrabold text-m-blue">
                  {k.charAt(0).toUpperCase()}
                </span>
                <span className="font-display text-[15px] font-extrabold">{k}</span>
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate({ to: "/family" })}
            className="animate-pop-in press-pop card-pop card-pop-lilac flex w-full items-center gap-3 p-5 text-left"
          >
            <IconTile icon={UserPlusIcon} tint="lilac" size="lg" bordered />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] font-extrabold">
                Invite your kid
              </p>
              <p className="text-[13px] font-bold text-muted-foreground text-pretty">
                Send a link. They join with no accounts, no passwords.
              </p>
            </div>
            <CaretRightIcon className="size-5 text-muted-foreground" weight="bold" />
          </button>
        )}
      </section>
    </div>
  );
}

/** Family bank — the parent's wallet balance + a top-up affordance in-voice. */
function FamilyBankCard() {
  const navigate = useNavigate();
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
        Your family bank lives on Stellar. Top it up any time to fund rewards.
      </p>

      {/* Quiet secondary action: set up a steady drip into a kid's stash. */}
      <button
        type="button"
        onClick={() => navigate({ to: "/streams" })}
        className="press-pop mt-3 flex w-full items-center gap-2 rounded-2xl border-2 border-m-ink/25 bg-white/60 px-3.5 py-2.5 text-left"
      >
        <DropIcon className="size-4 shrink-0 text-m-green-ink" weight="duotone" />
        <span className="min-w-0 flex-1 truncate font-display text-[13px] font-extrabold text-foreground">
          Set up allowance
        </span>
        <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" weight="bold" />
      </button>
    </div>
  );
}
