// /family — "ours". The family tab (DESIGN-STORY §5).
//
// This replaces the old "/circles" screen AND folds the treasury history feed
// (was its own "/history" tab) into a "Family treasury" section, so there's no
// orphan tab. Everything is localStorage + links + chain — no API server.
//
//   • A device with NO family sees a friendly setup card (create → parent).
//   • PARENT view: manage chores, add kid names, produce INVITE LINKS and private
//     CLAIM LINKS (send-a-reward) — PLUS the family treasury feed at the bottom.
//   • KID view: a read-only team card (family name + who's in it) and the same
//     treasury feed ("what our family's been up to"). No chore management.

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
  BroomIcon,
  LockIcon,
  BankIcon,
  WifiSlashIcon,
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
import { useFamily } from "@/hooks/use-family";
import { useFundReward } from "@/hooks/use-rewards";
import {
  useTreasuryHistory,
  type HistoryItem,
} from "@/hooks/use-treasury-history";
import { formatRelativeTime, truncateAddress } from "@/utils";
import { buildInviteLink, buildClaimLink, type Chore } from "@/lib/family";

export const Route = createFileRoute("/family/")({
  component: FamilyPage,
});

const EMOJI_CHOICES = ["🛏️", "🗑️", "🍽️", "🐕", "🧹", "📚", "🌱", "🧺", "🧼", "🚿"];

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
// Family creation now lives in the warm, single-screen-at-a-time /setup flow
// (name → kids → starter chores). This card is just the doorway to it.

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
          Name your family, add your kids, and pick a few starter chores — it
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

// ── parent view ──────────────────────────────────────────────────────────────

function ParentView({
  family,
  addChore,
  removeChore,
  addKidName,
}: {
  family: ReturnType<typeof useFamily>["family"] & object;
  addChore: ReturnType<typeof useFamily>["addChore"];
  removeChore: ReturnType<typeof useFamily>["removeChore"];
  addKidName: ReturnType<typeof useFamily>["addKidName"];
}) {
  return (
    <>
      <ChoresSection family={family} addChore={addChore} removeChore={removeChore} />
      <KidsSection family={family} addKidName={addKidName} />
      <RewardSection family={family} />
      <TreasurySection />
    </>
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

  const handleAdd = () => {
    if (!name.trim()) {
      toast.error("Name the chore first");
      return;
    }
    addChore({ name: name.trim(), emoji, rewardXlm: reward });
    setName("");
    setEmoji(EMOJI_CHOICES[0]);
    setReward(1);
    setOpen(false);
    toast.success("Chore added");
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <SparkleIcon className="size-4 text-m-gold" weight="fill" />
          Chores
        </h2>
        <Dialog open={open} onOpenChange={setOpen}>
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
            <div className="space-y-4">
              <div>
                <Label className="mb-2">Chore name</Label>
                <Input
                  placeholder="e.g. Make the bed"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
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
                    onClick={() =>
                      setReward((v) => Math.round((v + 0.5) * 100) / 100)
                    }
                    className="press-pop flex size-10 items-center justify-center rounded-full border-2 border-m-ink bg-primary text-primary-foreground font-display text-lg font-extrabold shadow-[var(--m-pop-sm)]"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
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
        <div className="space-y-2.5">
          {family.chores.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 card-pop p-3"
            >
              <EmojiTile emoji={c.emoji} tint="neutral" bordered />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-extrabold">
                  {c.name}
                </p>
                <p className="text-[13px] font-extrabold tabular-nums text-m-green-ink">
                  {c.rewardXlm.toFixed(2)} XLM
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
    </section>
  );
}

function KidsSection({
  family,
  addKidName,
}: {
  family: NonNullable<ReturnType<typeof useFamily>["family"]>;
  addKidName: ReturnType<typeof useFamily>["addKidName"];
}) {
  const { publicKey } = useStellarWallet();
  const [inviteFor, setInviteFor] = useState<string | null>(null);
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
          <div
            key={k}
            className="flex items-center gap-3 card-pop p-3"
          >
            <span className="flex size-11 items-center justify-center rounded-[13px] border-2 border-m-ink bg-m-sky font-display text-lg font-extrabold text-m-blue shadow-[var(--m-pop-sm)]">
              {k.charAt(0).toUpperCase()}
            </span>
            <p className="min-w-0 flex-1 truncate font-display text-[15px] font-extrabold">
              {k}
            </p>
            <button
              type="button"
              onClick={() => {
                setInviteFor(k);
                setCopied(false);
              }}
              className="press-pop flex items-center gap-1.5 rounded-full border-2 border-m-ink bg-primary/20 px-3 py-1.5 text-xs font-extrabold text-m-green-ink"
            >
              <LinkIcon className="size-3.5" weight="bold" />
              Invite
            </button>
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
              and chores — no accounts needed.
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
    </section>
  );
}

// ── reward → claim link (parent) ─────────────────────────────────────────────

function RewardSection({
  family,
}: {
  family: NonNullable<ReturnType<typeof useFamily>["family"]>;
}) {
  const fund = useFundReward();
  const [chore, setChore] = useState<Chore | null>(null);
  const [claimLink, setClaimLink] = useState("");
  const [copied, setCopied] = useState(false);

  const handleFund = (c: Chore) => {
    setChore(c);
    setClaimLink("");
    setCopied(false);
    fund.mutate(
      { amountXlm: c.rewardXlm, label: c.name },
      {
        onSuccess: ({ note }) => {
          setClaimLink(buildClaimLink(note));
          toast.success("Reward funded — share the claim link!");
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
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 font-display text-lg font-extrabold">
          <GiftIcon className="size-4 text-m-purple" weight="duotone" />
          Send a reward
        </h2>
      </div>

      {family.chores.length === 0 ? (
        <p className="px-1 text-[13px] font-bold text-muted-foreground text-pretty">
          Add a chore above, then reward it here with a private claim link.
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
                <SpinnerGapIcon className="size-5 animate-spin text-m-purple" weight="bold" />
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

      {/* Claim-link dialog after a successful fund */}
      <Dialog
        open={!!claimLink}
        onOpenChange={(o) => !o && setClaimLink("")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reward ready! 🎁</DialogTitle>
            <DialogDescription>
              Send this link to {chore?.name ? `"${chore.name}"` : "your kid"}.
              Opening it lets them import and privately claim{" "}
              {chore?.rewardXlm.toFixed(2)} XLM.
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
        </DialogContent>
      </Dialog>
    </section>
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

      {/* What our family's been up to — the treasury feed, read-only. */}
      <TreasurySection heading="What we've been up to" />
    </>
  );
}

// ── Family treasury feed (shared by both roles) ──────────────────────────────
//
// The activity feed that used to live on its own "/history" tab. Folded here as
// a section so there's no orphan tab (DESIGN-STORY §5). Read-only for everyone.

function TreasurySection({
  heading = "Family treasury",
}: {
  heading?: string;
}) {
  const { items, truncated, isLoading } = useTreasuryHistory();

  const claimedTotal = useMemo(
    () =>
      items
        .filter((i) => i.kind === "claimed")
        .reduce((sum, i) => sum + i.amountXlm, 0),
    [items],
  );

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-1.5 px-1 font-display text-lg font-extrabold">
        <BankIcon className="size-4 text-m-gold" weight="duotone" />
        {heading}
      </h2>

      {/* Paid-out total */}
      <div className="card-pop card-pop-green card-pop-lg flex items-center justify-between p-5 text-primary-foreground">
        <div>
          <p className="text-microlabel text-primary-foreground/70">
            Claimed so far
          </p>
          <p className="text-money text-4xl leading-none">
            {claimedTotal.toFixed(2)}
            <span className="ml-1.5 align-baseline text-lg font-extrabold text-primary-foreground/80">
              XLM
            </span>
          </p>
        </div>
        <span className="flex size-14 items-center justify-center rounded-[17px] border-2 border-m-ink bg-white/25 shadow-[var(--m-pop-sm)]">
          <GiftIcon className="size-8 text-m-gold" weight="fill" />
        </span>
      </div>

      {truncated && (
        <div className="flex items-center gap-2 card-pop card-pop-sm bg-card/70 px-4 py-3 text-xs font-semibold text-muted-foreground">
          <WifiSlashIcon className="size-4 shrink-0" weight="bold" />
          <span>
            Showing recent activity plus your own rewards. Older history may be
            beyond the network&apos;s retention window.
          </span>
        </div>
      )}

      {/* Activity list */}
      {isLoading && items.length === 0 ? (
        <p className="px-1 text-sm font-semibold text-muted-foreground">
          Loading treasury activity…
        </p>
      ) : items.length === 0 ? (
        <div className="card-pop bg-card/70 p-8 text-center">
          <IconTile icon={GiftIcon} tint="lilac" size="lg" className="mx-auto" />
          <p className="mt-2 font-display text-base font-bold text-foreground">
            No rewards yet
          </p>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            Fund a reward and it shows up here.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ActivityRow({ item }: { item: HistoryItem }) {
  const claimed = item.kind === "claimed";
  return (
    <div className="flex items-center gap-3 card-pop p-3">
      <IconTile
        icon={claimed ? SparkleIcon : GiftIcon}
        tint={claimed ? "green" : "purple"}
        size="lg"
        bordered
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[15px] font-bold text-foreground">
          {claimed ? "Reward claimed" : "Reward funded"}
          {item.mine && (
            <span className="ml-1.5 align-middle text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
              · you
            </span>
          )}
        </p>
        <p className="truncate text-xs font-semibold text-muted-foreground">
          {formatRelativeTime(new Date(item.timestamp))}
          {claimed && item.to ? ` · to ${truncateAddress(item.to)}` : ""}
        </p>
      </div>
      <span
        className={`shrink-0 font-display text-base font-extrabold tabular-nums ${
          claimed ? "text-m-green-ink" : "text-foreground"
        }`}
      >
        {claimed ? "+" : ""}
        {item.amountXlm.toFixed(2)}
        <span className="ml-0.5 text-[11px] font-bold text-muted-foreground">XLM</span>
      </span>
    </div>
  );
}
