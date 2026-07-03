// /family — "ours". The family tab (DESIGN-STORY §5).
//
// This replaces the old "/circles" screen AND folds the treasury history feed
// (was its own "/history" tab) into an "Activity" group, so there's no orphan
// tab. Everything is localStorage + links + chain — no API server.
//
//   • A device with NO family sees a friendly setup card (create → parent).
//   • PARENT view: an in-page segmented switcher (Chores / Kids / Activity), one
//     group at a time, calm on entry. Send-a-reward is smushed into each Kid row.
//   • KID view: a read-only team card (family name + who's in it) and the same
//     treasury feed, capped with a quiet "show all" expander.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useMemo } from "react";
import {
  PlusIcon,
  UsersIcon,
  CopyIcon,
  CheckCircleIcon,
  ShareNetworkIcon,
  TrashIcon,
  SpinnerGapIcon,
  GiftIcon,
  LinkIcon,
  SparkleIcon,
  UserPlusIcon,
  HandWavingIcon,
  BroomIcon,
  LockIcon,
  ListChecksIcon,
} from "@phosphor-icons/react";
import { EmojiTile, IconTile } from "@/components/atoms/icon-tile";
import { toast } from "sonner";
import { Button } from "@/components/atoms/button";
import { Input } from "@/components/atoms/input";
import { Label } from "@/components/atoms/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/molecules/dialog";
import { cn } from "@/utils";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { useFamily, useFamilyFeed, useChoreStates } from "@/hooks/use-family";
import { useFundReward } from "@/hooks/use-rewards";
import { formatRelativeTime } from "@/utils";
import {
  buildInviteLink,
  buildClaimLink,
  randomId,
  PARENT_SENDER_NAME,
  type Chore,
  type ChoreRepeat,
  type FeedEntry,
} from "@/lib/family";
import { requestPostNotice } from "@/hooks/use-family-board";
import { SendNoteDialog } from "@/components/molecules/send-note-dialog";

// The three parent groups. `?g=kids` deep-links straight to the Kids group so
// the home screen's kid chips can land here (dead-affordance fix, item 4).
type Group = "chores" | "kids" | "activity";
const GROUPS: { id: Group; label: string }[] = [
  { id: "chores", label: "Chores" },
  { id: "kids", label: "Kids" },
  { id: "activity", label: "Activity" },
];
function isGroup(v: unknown): v is Group {
  return v === "chores" || v === "kids" || v === "activity";
}

export const Route = createFileRoute("/family/")({
  validateSearch: (search: Record<string, unknown>): { g?: Group } => {
    return isGroup(search.g) ? { g: search.g } : {};
  },
  component: FamilyPage,
});

const EMOJI_CHOICES = ["🛏️", "🗑️", "🍽️", "🐕", "🧹", "📚", "🌱", "🧺", "🧼", "🚿"];

// Copy caps (item 4): a short, scannable title; a one-line optional note.
const TITLE_MAX = 28;
const TITLE_COUNTER_AT = 20;
const NOTE_MAX = 90;

function FamilyPage() {
  const { family, role, addChore, removeChore, addKidName } = useFamily();

  if (!family) return <NoFamilyCard />;

  return (
    <div className="stagger-rise space-y-5">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          {family.name}
        </h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          {role === "parent"
            ? "Set up chores, invite your kids, and send rewards."
            : "Your team and everything it's been up to."}
        </p>
      </header>

      {role === "parent" ? (
        <ParentView
          family={family}
          addChore={addChore}
          removeChore={removeChore}
          addKidName={addKidName}
        />
      ) : (
        <KidView family={family} />
      )}
    </div>
  );
}

// ── no-family card: a device with no family → send to the /setup flow ────────

function NoFamilyCard() {
  const navigate = useNavigate();
  return (
    <div className="stagger-rise flex flex-col items-center gap-6 pt-6 text-center">
      <div className="flex size-24 items-center justify-center rounded-[1.9rem] border-2 border-m-ink bg-m-lilac shadow-[var(--m-pop)]">
        <UsersIcon className="size-11 text-m-purple" weight="duotone" />
      </div>
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Start your family
        </h1>
        <p className="mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
          Name your family, add your kids, and pick a few starter chores. It
          takes about two minutes.
        </p>
      </div>

      <Button
        onClick={() => navigate({ to: "/setup" })}
        size="lg"
        className="w-full max-w-xs"
      >
        <SparkleIcon className="mr-2 size-5" weight="fill" />
        Set up my family
      </Button>
    </div>
  );
}

// ── the segmented pill switcher (in-page, NOT router tabs) ────────────────────
// Ink-bordered pill track, active pill green, press-pop on every pill.

function GroupSwitcher({
  group,
  onChange,
}: {
  group: Group;
  onChange: (g: Group) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Family sections"
      className="flex gap-1 rounded-full border-2 border-m-ink bg-card p-1 shadow-[var(--m-pop-sm)]"
    >
      {GROUPS.map((g) => {
        const active = g.id === group;
        return (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(g.id)}
            className={cn(
              "press-pop flex-1 rounded-full py-2 font-display text-sm font-extrabold transition-colors",
              active
                ? "border-2 border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]"
                : "border-2 border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {g.label}
          </button>
        );
      })}
    </div>
  );
}

// ── parent view ──────────────────────────────────────────────────────────────

function ParentView({
  family,
  addChore,
  removeChore,
  addKidName,
}: {
  family: NonNullable<ReturnType<typeof useFamily>["family"]>;
  addChore: ReturnType<typeof useFamily>["addChore"];
  removeChore: ReturnType<typeof useFamily>["removeChore"];
  addKidName: ReturnType<typeof useFamily>["addKidName"];
}) {
  const navigate = useNavigate();
  // The switcher reads/writes the `?g=` search param, so /family?g=kids deep
  // links (from the home kid chips) land on the right group.
  const search = Route.useSearch();
  const group: Group = search.g ?? "chores";
  const setGroup = (g: Group) =>
    navigate({ to: "/family", search: g === "chores" ? {} : { g }, replace: true });

  return (
    <div className="space-y-4">
      <GroupSwitcher group={group} onChange={setGroup} />

      {/* Keyed remount so the 240ms entrance replays on every group swap (the
          `both` fill on animate-pop-in would otherwise leave it stuck). */}
      <div key={group} className="animate-pop-in">
        {group === "chores" && (
          <ChoresSection
            family={family}
            addChore={addChore}
            removeChore={removeChore}
          />
        )}
        {group === "kids" && (
          <KidsSection family={family} addKidName={addKidName} />
        )}
        {group === "activity" && (
          <FamilyFeedSection
            noteSenderName={PARENT_SENDER_NAME}
            noteRecipientHint="to your kids"
          />
        )}
      </div>
    </div>
  );
}

// ── the add/edit-chore dialog body (shared shape; title cap + optional note) ──

const REPEAT_CHIPS: { id: ChoreRepeat; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "once", label: "Once" },
];

/**
 * Assignee ("Anyone" or a kid) + repeat (Daily/Weekly/Once) chip rows, shared by
 * the family + setup add-chore dialogs. Assignee is a kidName or undefined
 * ("anyone"); repeat defaults to "daily".
 */
function ChoreAssignFields({
  kidNames,
  assignee,
  setAssignee,
  repeat,
  setRepeat,
}: {
  kidNames: string[];
  assignee: string | undefined;
  setAssignee: (v: string | undefined) => void;
  repeat: ChoreRepeat;
  setRepeat: (v: ChoreRepeat) => void;
}) {
  return (
    <>
      <div>
        <Label className="mb-2">Who does it?</Label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setAssignee(undefined)}
            className={cn(
              "press-pop rounded-full border-2 px-3.5 py-1.5 font-display text-[13px] font-extrabold",
              !assignee
                ? "border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]"
                : "border-m-ink/25 bg-card text-muted-foreground",
            )}
          >
            Anyone
          </button>
          {kidNames.map((k) => {
            const on = assignee === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setAssignee(k)}
                className={cn(
                  "press-pop rounded-full border-2 px-3.5 py-1.5 font-display text-[13px] font-extrabold",
                  on
                    ? "border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]"
                    : "border-m-ink/25 bg-card text-muted-foreground",
                )}
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <Label className="mb-2">How often?</Label>
        <div className="flex gap-1.5">
          {REPEAT_CHIPS.map((r) => {
            const on = repeat === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRepeat(r.id)}
                className={cn(
                  "press-pop flex-1 rounded-full border-2 px-3 py-1.5 font-display text-[13px] font-extrabold",
                  on
                    ? "border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]"
                    : "border-m-ink/25 bg-card text-muted-foreground",
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ChoreDialogFields({
  name,
  setName,
  emoji,
  setEmoji,
  reward,
  setReward,
  note,
  setNote,
  kidNames,
  assignee,
  setAssignee,
  repeat,
  setRepeat,
  onSubmit,
}: {
  name: string;
  setName: (v: string) => void;
  emoji: string;
  setEmoji: (v: string) => void;
  reward: number;
  setReward: (fn: (v: number) => number) => void;
  note: string;
  setNote: (v: string) => void;
  kidNames: string[];
  assignee: string | undefined;
  setAssignee: (v: string | undefined) => void;
  repeat: ChoreRepeat;
  setRepeat: (v: ChoreRepeat) => void;
  onSubmit: () => void;
}) {
  const overCounter = name.length >= TITLE_COUNTER_AT;
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>Chore name</Label>
          {overCounter && (
            <span
              className={cn(
                "text-[11px] font-extrabold tabular-nums",
                name.length >= TITLE_MAX ? "text-m-pink" : "text-muted-foreground",
              )}
            >
              {name.length}/{TITLE_MAX}
            </span>
          )}
        </div>
        <Input
          placeholder="e.g. Make the bed"
          value={name}
          maxLength={TITLE_MAX}
          onChange={(e) => setName(e.target.value.slice(0, TITLE_MAX))}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
      </div>
      <div>
        <Label className="mb-2">Emoji</Label>
        <div className="flex flex-wrap gap-1.5">
          {EMOJI_CHOICES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={cn(
                "press-pop flex size-10 items-center justify-center rounded-[12px] border-2 text-xl",
                emoji === e
                  ? "border-m-ink bg-primary/20 shadow-[var(--m-pop-sm)]"
                  : "border-transparent bg-muted",
              )}
            >
              <span aria-hidden>{e}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label className="mb-2">Note</Label>
        <Input
          placeholder="Anything they should know? (optional)"
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
      </div>
      <ChoreAssignFields
        kidNames={kidNames}
        assignee={assignee}
        setAssignee={setAssignee}
        repeat={repeat}
        setRepeat={setRepeat}
      />
      <div>
        <Label className="mb-2">Reward (XLM)</Label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setReward((v) => Math.max(0.1, Math.round((v - 0.5) * 100) / 100))
            }
            className="press-pop flex size-10 items-center justify-center rounded-full border-2 border-m-ink bg-muted font-display text-lg font-extrabold shadow-[var(--m-pop-sm)]"
          >
            −
          </button>
          <span className="flex-1 text-center text-money text-xl text-m-green-ink">
            {reward.toFixed(2)}
          </span>
          <button
            type="button"
            onClick={() => setReward((v) => Math.round((v + 0.5) * 100) / 100)}
            className="press-pop flex size-10 items-center justify-center rounded-full border-2 border-m-ink bg-primary text-primary-foreground font-display text-lg font-extrabold shadow-[var(--m-pop-sm)]"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function ChoresSection({
  family,
  addChore,
  removeChore,
}: {
  family: NonNullable<ReturnType<typeof useFamily>["family"]>;
  addChore: ReturnType<typeof useFamily>["addChore"];
  removeChore: ReturnType<typeof useFamily>["removeChore"];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]);
  const [reward, setReward] = useState(1);
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState<string | undefined>(undefined);
  const [repeat, setRepeat] = useState<ChoreRepeat>("daily");

  const reset = () => {
    setName("");
    setEmoji(EMOJI_CHOICES[0]);
    setReward(1);
    setNote("");
    setAssignee(undefined);
    setRepeat("daily");
  };

  const handleAdd = () => {
    if (!name.trim()) {
      toast.error("Name the chore first");
      return;
    }
    addChore({
      name: name.trim(),
      emoji,
      rewardXlm: reward,
      note: note.trim() || undefined,
      // Omit defaults: undefined assignee = "anyone", "daily" = default repeat.
      ...(assignee ? { assignee } : {}),
      ...(repeat !== "daily" ? { repeat } : {}),
    });
    // Tell the kid device(s): a new chore landed. Assignee (when set) scopes the
    // bell so an "anyone" chore reaches everyone and an assigned one only that
    // kid. The chore list itself already syncs via the board; this is the ping.
    requestPostNotice({
      id: `chore-${randomId()}`,
      at: Date.now(),
      kind: "chore-added",
      text: name.trim(),
      emoji,
      ...(assignee ? { kidName: assignee } : {}),
    });
    reset();
    setOpen(false);
    toast.success("Chore added");
  };

  // Split the chore list by this period's progress: a chore a kid has completed
  // (fresh "done") drops out of the active list and into a struck-through "Done"
  // group with who did it. Recurring chores come back on their own next period
  // (effectiveChoreState freshness), so nothing piles up.
  const { statesFor } = useChoreStates();
  const { active, doneChores } = useMemo(() => {
    const active: Chore[] = [];
    const doneChores: { chore: Chore; doers: string[] }[] = [];
    for (const c of family.chores) {
      const doers = Object.entries(statesFor(c))
        .filter(([, s]) => s === "done")
        .map(([kid]) => kid);
      if (doers.length > 0) doneChores.push({ chore: c, doers });
      else active.push(c);
    }
    return { active, doneChores };
  }, [family.chores, statesFor]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <SparkleIcon className="size-4 text-m-gold" weight="fill" />
          Chores
        </h2>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) reset();
          }}
        >
          <DialogTrigger asChild>
            <button className="press-pop flex size-9 shrink-0 items-center justify-center rounded-2xl border-2 border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]">
              <PlusIcon className="size-4" weight="bold" />
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New chore</DialogTitle>
              <DialogDescription>
                Give it a name, pick an emoji, and set the reward.
              </DialogDescription>
            </DialogHeader>
            <ChoreDialogFields
              name={name}
              setName={setName}
              emoji={emoji}
              setEmoji={setEmoji}
              reward={reward}
              setReward={setReward}
              note={note}
              setNote={setNote}
              kidNames={family.kidNames}
              assignee={assignee}
              setAssignee={setAssignee}
              repeat={repeat}
              setRepeat={setRepeat}
              onSubmit={handleAdd}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAdd}>
                <PlusIcon className="mr-2 size-4" weight="bold" />
                Add chore
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {family.chores.length === 0 ? (
        <div className="card-pop bg-card/70 p-6 text-center">
          <IconTile icon={BroomIcon} tint="lilac" size="lg" className="mx-auto" />
          <p className="mt-2 font-display text-sm font-extrabold">No chores yet</p>
          <p className="mt-0.5 text-[13px] font-bold text-muted-foreground text-pretty">
            Add a chore and it shows up on everyone&apos;s home screen.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Active — still to do or awaiting a grown-up's nod. */}
          {active.length > 0 && (
            <div className="space-y-2.5">
              {active.map((c) => (
                <div key={c.id} className="flex items-center gap-3 card-pop p-3">
                  <EmojiTile emoji={c.emoji} tint="neutral" bordered />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[15px] font-extrabold">
                      {c.name}
                    </p>
                    {c.note && (
                      <p className="truncate text-[12px] font-semibold text-muted-foreground">
                        {c.note}
                      </p>
                    )}
                    <p className="flex items-center gap-1.5 text-[13px] font-extrabold tabular-nums text-m-green-ink">
                      {c.rewardXlm.toFixed(2)} XLM
                      <span className="font-bold text-muted-foreground">
                        · {c.assignee ?? "Anyone"}
                        {c.repeat && c.repeat !== "daily" ? ` · ${c.repeat}` : ""}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => removeChore(c.id)}
                    className="press-pop flex size-9 items-center justify-center rounded-full border-2 border-m-ink bg-muted text-muted-foreground shadow-[var(--m-pop-sm)] hover:text-m-pink"
                  >
                    <TrashIcon className="size-4" weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Done this period — struck through, with who did it. Recurring
              chores come back on their own next period, so nothing piles up. */}
          {doneChores.length > 0 && (
            <div className="space-y-2.5">
              <h3 className="flex items-center gap-1.5 px-1 text-microlabel text-muted-foreground">
                <CheckCircleIcon
                  className="size-4 text-m-green-ink"
                  weight="fill"
                />
                Done
              </h3>
              {doneChores.map(({ chore: c, doers }) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 card-pop bg-m-mint/30 p-3"
                >
                  <EmojiTile emoji={c.emoji} tint="green" bordered />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-[15px] font-extrabold text-muted-foreground line-through">
                      {c.name}
                    </p>
                    <p className="truncate text-[12px] font-bold text-m-green-ink">
                      {doers.join(", ")} did it · {c.rewardXlm.toFixed(2)} XLM
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => removeChore(c.id)}
                    className="press-pop flex size-9 items-center justify-center rounded-full border-2 border-m-ink bg-muted text-muted-foreground shadow-[var(--m-pop-sm)] hover:text-m-pink"
                  >
                    <TrashIcon className="size-4" weight="bold" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── kids: each row carries invite + a compact "Send a reward" action ─────────

function KidsSection({
  family,
  addKidName,
}: {
  family: NonNullable<ReturnType<typeof useFamily>["family"]>;
  addKidName: ReturnType<typeof useFamily>["addKidName"];
}) {
  const { publicKey } = useStellarWallet();
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [rewardFor, setRewardFor] = useState<string | null>(null);
  const [newKid, setNewKid] = useState("");
  const [copied, setCopied] = useState(false);

  const inviteLink = useMemo(() => {
    if (!inviteFor) return "";
    return buildInviteLink({
      familyId: family.id,
      familyName: family.name,
      parentAddress: publicKey,
      kidName: inviteFor,
      chores: family.chores,
      // Board fields ride the invite so the kid device joins the encrypted board
      // and syncs. Absent on a pre-board family → the kid still joins, unsynced.
      ...(family.boardId && family.familyKey
        ? { boardId: family.boardId, familyKey: family.familyKey }
        : {}),
    });
  }, [inviteFor, family, publicKey]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success("Invite link copied!");
  }, [inviteLink]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${family.name} on Maestro`,
          text: `${inviteFor}, join our family and start earning!`,
          url: inviteLink,
        });
      } catch {
        /* user cancelled */
      }
    }
  }, [inviteLink, family.name, inviteFor]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <UsersIcon className="size-4 text-m-purple" weight="duotone" />
          Kids
        </h2>
      </div>

      <div className="space-y-2.5">
        {family.kidNames.map((k) => (
          <div key={k} className="card-pop p-3">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-[13px] border-2 border-m-ink bg-m-sky font-display text-lg font-extrabold text-m-blue shadow-[var(--m-pop-sm)]">
                {k.charAt(0).toUpperCase()}
              </span>
              <p className="min-w-0 flex-1 truncate font-display text-[15px] font-extrabold">
                {k}
              </p>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setInviteFor(k);
                  setCopied(false);
                }}
                className="press-pop flex flex-1 items-center justify-center gap-1.5 rounded-full border-2 border-m-ink bg-card px-3 py-2 text-xs font-extrabold text-foreground shadow-[var(--m-pop-sm)]"
              >
                <LinkIcon className="size-3.5" weight="bold" />
                Invite
              </button>
              <button
                type="button"
                onClick={() => setRewardFor(k)}
                className="press-pop flex flex-1 items-center justify-center gap-1.5 rounded-full border-2 border-m-ink bg-primary/20 px-3 py-2 text-xs font-extrabold text-m-green-ink shadow-[var(--m-pop-sm)]"
              >
                <GiftIcon className="size-3.5" weight="duotone" />
                Send a reward
              </button>
            </div>
          </div>
        ))}

        {/* add a kid inline */}
        <div className="flex items-center gap-2">
          <Input
            placeholder="Add a kid…"
            value={newKid}
            onChange={(e) => setNewKid(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newKid.trim()) {
                addKidName(newKid);
                setNewKid("");
              }
            }}
          />
          <button
            type="button"
            aria-label="Add kid"
            onClick={() => {
              if (newKid.trim()) {
                addKidName(newKid);
                setNewKid("");
              }
            }}
            className="press-pop flex size-11 shrink-0 items-center justify-center rounded-2xl border-2 border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]"
          >
            <UserPlusIcon className="size-5" weight="bold" />
          </button>
        </div>
      </div>

      {/* Invite-link dialog */}
      <Dialog open={!!inviteFor} onOpenChange={(o) => !o && setInviteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite {inviteFor}</DialogTitle>
            <DialogDescription>
              Send this link to {inviteFor}&apos;s device. It carries your family
              and chores, no accounts needed.
            </DialogDescription>
          </DialogHeader>
          <button
            onClick={handleCopy}
            className="press-pop w-full rounded-2xl border-2 border-m-ink bg-muted/40 px-4 py-3.5 text-left"
          >
            <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">
              {inviteLink}
            </p>
            <span className="mt-2.5 flex items-center gap-1.5 text-xs font-bold">
              {copied ? (
                <span className="flex items-center gap-1.5 text-m-green-ink">
                  <CheckCircleIcon className="size-3.5" weight="fill" />
                  Copied!
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CopyIcon className="size-3.5" weight="bold" />
                  Tap to copy
                </span>
              )}
            </span>
          </button>
          {typeof navigator !== "undefined" && !!navigator.share && (
            <Button variant="outline" onClick={handleShare} className="w-full">
              <ShareNetworkIcon className="mr-2 size-4" weight="bold" />
              Share
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* Send-a-reward flow, prefilled for the chosen kid (smushed in, item 3). */}
      <SendRewardDialog
        family={family}
        kidName={rewardFor}
        onClose={() => setRewardFor(null)}
      />
    </section>
  );
}

// ── send-a-reward → claim link, prefilled for a specific kid ─────────────────
// Was a free-standing section; now opened per kid row. Same fund+claim-link
// flow, just scoped to whichever kid the parent tapped.

function SendRewardDialog({
  family,
  kidName,
  onClose,
}: {
  family: NonNullable<ReturnType<typeof useFamily>["family"]>;
  kidName: string | null;
  onClose: () => void;
}) {
  const fund = useFundReward();
  const [chore, setChore] = useState<Chore | null>(null);
  const [claimLink, setClaimLink] = useState("");
  const [copied, setCopied] = useState(false);

  const close = () => {
    setChore(null);
    setClaimLink("");
    setCopied(false);
    onClose();
  };

  const handleFund = (c: Chore) => {
    setChore(c);
    setClaimLink("");
    setCopied(false);
    fund.mutate(
      { amountXlm: c.rewardXlm, label: c.name },
      {
        onSuccess: ({ note }) => {
          setClaimLink(buildClaimLink(note));
          toast.success("Reward funded. Share the claim link!");
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(claimLink);
    setCopied(true);
    toast.success("Claim link copied!");
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "A reward for you!",
          text: `You earned ${chore?.rewardXlm.toFixed(2)} XLM 🎁`,
          url: claimLink,
        });
      } catch {
        /* cancelled */
      }
    }
  };

  return (
    <Dialog open={!!kidName} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {claimLink ? (
          // ── reward funded: hand off the claim link ──────────────────────────
          <>
            <DialogHeader>
              <DialogTitle>Reward ready! 🎁</DialogTitle>
              <DialogDescription>
                Send this link to {kidName}. Opening it lets them import and
                privately claim {chore?.rewardXlm.toFixed(2)} XLM.
              </DialogDescription>
            </DialogHeader>
            <button
              onClick={handleCopy}
              className="press-pop w-full rounded-2xl border-2 border-m-ink bg-muted/40 px-4 py-3.5 text-left"
            >
              <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">
                {claimLink}
              </p>
              <span className="mt-2.5 flex items-center gap-1.5 text-xs font-bold">
                {copied ? (
                  <span className="flex items-center gap-1.5 text-m-green-ink">
                    <CheckCircleIcon className="size-3.5" weight="fill" />
                    Copied!
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <CopyIcon className="size-3.5" weight="bold" />
                    Tap to copy
                  </span>
                )}
              </span>
            </button>
            {typeof navigator !== "undefined" && !!navigator.share && (
              <Button variant="outline" onClick={handleShare} className="w-full">
                <ShareNetworkIcon className="mr-2 size-4" weight="bold" />
                Share
              </Button>
            )}
            <p className="flex items-center justify-center gap-1 text-center text-[11px] font-semibold text-muted-foreground/70">
              <LockIcon className="size-3" weight="fill" />
              Only someone with this link can claim the reward.
            </p>
          </>
        ) : (
          // ── pick a chore to reward ──────────────────────────────────────────
          <>
            <DialogHeader>
              <DialogTitle>Send {kidName} a reward</DialogTitle>
              <DialogDescription>
                Pick a chore to reward. We tuck the XLM away privately and give
                you a claim link to hand over.
              </DialogDescription>
            </DialogHeader>
            {family.chores.length === 0 ? (
              <p className="px-1 text-[13px] font-bold text-muted-foreground text-pretty">
                Add a chore first, then reward it here with a private claim link.
              </p>
            ) : (
              <div className="space-y-2.5">
                {family.chores.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={fund.isPending}
                    onClick={() => handleFund(c)}
                    className="press-pop card-pop flex w-full items-center gap-3 p-3 text-left disabled:opacity-60"
                  >
                    <EmojiTile emoji={c.emoji} tint="purple" bordered />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[15px] font-extrabold">
                        {c.name}
                      </p>
                      <p className="text-[13px] font-extrabold tabular-nums text-m-green-ink">
                        {c.rewardXlm.toFixed(2)} XLM
                      </p>
                    </div>
                    {fund.isPending && chore?.id === c.id ? (
                      <SpinnerGapIcon
                        className="size-5 animate-spin text-m-purple"
                        weight="bold"
                      />
                    ) : (
                      <span className="flex items-center gap-1.5 rounded-full border-2 border-m-ink bg-m-purple/15 px-3 py-1.5 text-xs font-extrabold text-m-purple">
                        <GiftIcon className="size-3.5" weight="duotone" />
                        Reward
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── kid view (read-only) ─────────────────────────────────────────────────────

function KidView({
  family,
}: {
  family: NonNullable<ReturnType<typeof useFamily>["family"]>;
}) {
  // Everyone on the team: the kid on this device (family.kidName) plus any names
  // the parent added at setup. De-duped, in a stable order.
  const teammates = useMemo(() => {
    const names = [...family.kidNames];
    const me = family.kidName?.trim();
    if (me && !names.includes(me)) names.unshift(me);
    return names;
  }, [family.kidNames, family.kidName]);

  return (
    <>
      {/* Team card — read-only: the family name + who's in it. */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 px-1 font-display text-lg font-extrabold">
          <UsersIcon className="size-4 text-m-purple" weight="duotone" />
          Your team
        </h2>
        <div className="card-pop card-pop-lilac p-4">
          <div className="flex items-center gap-3">
            <IconTile icon={UsersIcon} tint="lilac" size="lg" bordered />
            <div className="min-w-0 flex-1">
              <p className="text-microlabel text-muted-foreground">Family</p>
              <p className="truncate font-display text-xl font-extrabold">
                {family.name}
              </p>
            </div>
          </div>
          {teammates.length > 0 && (
            <div className="mt-3.5 flex flex-wrap gap-2">
              {teammates.map((k) => (
                <span
                  key={k}
                  className="flex items-center gap-2 rounded-full border-2 border-m-ink bg-card py-1.5 pl-1.5 pr-3.5 shadow-[var(--m-pop-sm)]"
                >
                  <span className="flex size-7 items-center justify-center rounded-full border-2 border-m-ink bg-m-sky font-display text-sm font-extrabold text-m-blue">
                    {k.charAt(0).toUpperCase()}
                  </span>
                  <span className="font-display text-[15px] font-extrabold">
                    {k}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* What our family's been up to — the warm, attributable family feed. The
          "+" beside the heading is the kid's send-a-note affordance (no longer a
          standalone card): the doer's voice, right where the family story lives. */}
      <FamilyFeedSection
        heading="What we've been up to"
        {...(family.kidName
          ? { noteSenderName: family.kidName, noteRecipientHint: "to your family" }
          : {})}
      />
    </>
  );
}

// ── Family feed (audit issue 11) ─────────────────────────────────────────────
//
// The warm "our family" activity: signed board notices (kid-joined, reward-ready…)
// fused with this device's own local notes — all attributable, cross-device. This
// is NOT the raw treasury/chain feed (which shows strangers' deposits and moved to
// /me → For grown-ups as "Treasury activity: private by design"). Read-only for
// both roles; latest ~6 with a quiet "show all" expander.

const FEED_PREVIEW = 6;

/** In-voice copy + icon for each feed kind. */
function feedRowCopy(e: FeedEntry): { title: string; icon: typeof GiftIcon; tint: "green" | "purple" | "gold" | "lilac" } {
  switch (e.kind) {
    case "kid-joined":
      return { title: `${e.kidName ?? "A kid"} joined the team 🎉`, icon: UserPlusIcon, tint: "purple" };
    case "reward-ready":
      return { title: `A reward is ready${e.kidName ? ` for ${e.kidName}` : ""} 🎁`, icon: GiftIcon, tint: "green" };
    case "allowance-started":
      return { title: `Allowance started${e.kidName ? ` for ${e.kidName}` : ""} 💧`, icon: SparkleIcon, tint: "gold" };
    case "chore-added":
      return { title: `New chore: ${e.emoji ? `${e.emoji} ` : ""}${e.text ?? "a chore"}`, icon: SparkleIcon, tint: "purple" };
    case "chore-pending":
      return { title: `${e.kidName ?? "A kid"} says ${e.text ? `"${e.text}"` : "a chore"} is done ✋`, icon: HandWavingIcon, tint: "gold" };
    case "message":
      return { title: e.text || "A note", icon: SparkleIcon, tint: "lilac" };
    default:
      return { title: e.text || "Activity", icon: SparkleIcon, tint: "lilac" };
  }
}

function FamilyFeedSection({
  heading = "Family activity",
  noteSenderName,
  noteRecipientHint,
}: {
  heading?: string;
  /** When set, a small round "+" beside the heading opens the send-note dialog. */
  noteSenderName?: string;
  noteRecipientHint?: string;
}) {
  const feed = useFamilyFeed();
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? feed : feed.slice(0, FEED_PREVIEW);
  const hiddenCount = feed.length - visible.length;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <SparkleIcon className="size-4 text-m-gold" weight="fill" />
          {heading}
        </h2>
        {noteSenderName && noteRecipientHint && (
          <SendNoteDialog
            senderName={noteSenderName}
            recipientHint={noteRecipientHint}
            iconOnly
          />
        )}
      </div>

      {feed.length === 0 ? (
        <div className="card-pop bg-card/70 p-8 text-center">
          <IconTile icon={SparkleIcon} tint="lilac" size="lg" className="mx-auto" />
          <p className="mt-2 font-display text-base font-bold text-foreground">
            Nothing yet
          </p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground text-pretty">
            When a kid joins or a reward goes out, it shows up here.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {visible.map((e) => (
              <FeedRow key={e.id} entry={e} />
            ))}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="press-pop flex w-full items-center justify-center gap-1.5 rounded-full border-2 border-m-ink/25 bg-card/60 py-2.5 font-display text-[13px] font-extrabold text-muted-foreground hover:text-foreground"
            >
              <ListChecksIcon className="size-4" weight="bold" />
              Show all {feed.length}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function FeedRow({ entry }: { entry: FeedEntry }) {
  const { title, icon, tint } = feedRowCopy(entry);
  return (
    <div className="flex items-center gap-3 card-pop p-3">
      <IconTile icon={icon} tint={tint} size="lg" bordered />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[15px] font-bold text-foreground">
          {title}
        </p>
        <p className="truncate text-xs font-semibold text-muted-foreground">
          {formatRelativeTime(new Date(entry.at))}
        </p>
      </div>
    </div>
  );
}
