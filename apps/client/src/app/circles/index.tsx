// /circles — the family home (serverless).
//
// This replaces the old server-backed "Circles" screen entirely. No requests to
// any API server are made from here. Everything is localStorage + links + chain:
//
//   • A device with NO family sees a friendly setup card (create → parent).
//   • A parent manages the family: add/remove chores, add kid names, and produce
//     an INVITE LINK (family + chores encoded in the URL fragment).
//   • A parent produces CLAIM LINKS: fund a private reward on-chain, then share a
//     link that lets the kid device import + privately claim it.
//   • A kid sees a read-only view of their family + chores.

import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useMemo } from "react";
import {
  Plus,
  Users,
  Copy,
  CheckCircle2,
  Share2,
  Trash2,
  Loader2,
  Gift,
  Link2,
  Sparkles,
  UserPlus,
} from "lucide-react";
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
import { buildInviteLink, buildClaimLink, type Chore } from "@/lib/family";

export const Route = createFileRoute("/circles/")({
  component: FamilyPage,
});

const EMOJI_CHOICES = ["🛏️", "🗑️", "🍽️", "🐕", "🧹", "📚", "🌱", "🧺", "🧼", "🚿"];

function FamilyPage() {
  const {
    family,
    role,
    createFamily,
    addChore,
    removeChore,
    addKidName,
  } = useFamily();

  if (!family) return <SetupCard onCreate={createFamily} />;

  return (
    <div className="stagger-rise space-y-5">
      <header>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          {family.name}
        </h1>
        <p className="mt-1 text-[15px] font-bold text-muted-foreground text-pretty">
          {role === "parent"
            ? "Set up chores, invite your kids, and send rewards."
            : "Your family, your chores, your rewards."}
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

// ── setup card: a device with no family ──────────────────────────────────────

function SetupCard({
  onCreate,
}: {
  onCreate: (input: {
    name: string;
    parentAddress: string;
    kidNames?: string[];
  }) => void;
}) {
  const { publicKey } = useStellarWallet();
  const [name, setName] = useState("");
  const [kids, setKids] = useState("");

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error("Give your family a name first");
      return;
    }
    const kidNames = kids
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    onCreate({ name: name.trim(), parentAddress: publicKey, kidNames });
    toast.success("Family created! 🎉");
  };

  return (
    <div className="stagger-rise flex flex-col items-center gap-6 pt-6 text-center">
      <div className="flex size-24 items-center justify-center rounded-[1.9rem] bg-m-lilac text-5xl shadow-inner">
        👨‍👩‍👧‍👦
      </div>
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Start your family
        </h1>
        <p className="mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
          Name your family and add your kids. No accounts — everything lives on
          this device.
        </p>
      </div>

      <div className="w-full space-y-3.5 rounded-[1.75rem] border border-border/60 bg-card p-5 text-left shadow-sm">
        <div>
          <Label className="mb-2">Family name</Label>
          <Input
            placeholder="e.g. The Smiths"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <div>
          <Label className="mb-2">Kids (comma separated)</Label>
          <Input
            placeholder="e.g. Alex, Sam"
            value={kids}
            onChange={(e) => setKids(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
        </div>
        <Button onClick={handleCreate} size="lg" className="w-full">
          <Sparkles className="mr-2 size-5" strokeWidth={2.6} />
          Create family
        </Button>
      </div>
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
          <Sparkles className="size-4 text-m-gold" strokeWidth={2.6} />
          Chores
        </h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md transition-transform active:scale-95">
              <Plus className="size-4" strokeWidth={2.8} />
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
                        "flex size-10 items-center justify-center rounded-2xl text-xl shadow-sm transition-transform active:scale-90",
                        emoji === e
                          ? "bg-primary/20 ring-2 ring-primary"
                          : "bg-muted",
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
                    className="flex size-10 items-center justify-center rounded-full bg-muted font-display text-lg font-extrabold shadow-sm active:scale-90"
                  >
                    −
                  </button>
                  <span className="flex-1 text-center font-display text-xl font-extrabold tabular-nums text-m-green-ink">
                    {reward.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setReward((v) => Math.round((v + 0.5) * 100) / 100)
                    }
                    className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-display text-lg font-extrabold shadow-sm active:scale-90"
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
                <Plus className="mr-2 size-4" />
                Add chore
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {family.chores.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/70 bg-card/60 p-6 text-center">
          <span className="text-3xl" aria-hidden>
            🧹
          </span>
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
              className="flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-sm"
            >
              <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-xl shadow-sm">
                <span aria-hidden>{c.emoji}</span>
              </span>
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
                className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground shadow-sm transition-colors hover:text-m-pink active:scale-90"
              >
                <Trash2 className="size-4" strokeWidth={2.4} />
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
          <Users className="size-4 text-m-purple" strokeWidth={2.6} />
          Kids
        </h2>
      </div>

      <div className="space-y-2.5">
        {family.kidNames.map((k) => (
          <div
            key={k}
            className="flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-sm"
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-m-sky font-display text-lg font-extrabold text-m-blue shadow-sm">
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
              className="flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5 text-xs font-extrabold text-m-green-ink transition-transform active:scale-95"
            >
              <Link2 className="size-3.5" strokeWidth={2.8} />
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
            className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md transition-transform active:scale-95"
          >
            <UserPlus className="size-5" strokeWidth={2.6} />
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
            className="w-full rounded-2xl border border-border/60 bg-muted/30 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
          >
            <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">
              {inviteLink}
            </p>
            <span className="mt-2.5 flex items-center gap-1.5 text-xs font-bold">
              {copied ? (
                <span className="flex items-center gap-1.5 text-m-green-ink">
                  <CheckCircle2 className="size-3.5" />
                  Copied!
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Copy className="size-3.5" />
                  Tap to copy
                </span>
              )}
            </span>
          </button>
          {typeof navigator !== "undefined" && !!navigator.share && (
            <Button variant="outline" onClick={handleShare} className="w-full">
              <Share2 className="mr-2 size-4" />
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
          <Gift className="size-4 text-m-purple" strokeWidth={2.6} />
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
              className="flex w-full items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99] disabled:opacity-60"
            >
              <span className="flex size-11 items-center justify-center rounded-2xl bg-m-purple/12 text-xl shadow-sm">
                <span aria-hidden>{c.emoji}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-extrabold">
                  {c.name}
                </p>
                <p className="text-[13px] font-extrabold tabular-nums text-m-green-ink">
                  {c.rewardXlm.toFixed(2)} XLM
                </p>
              </div>
              {fund.isPending && chore?.id === c.id ? (
                <Loader2 className="size-5 animate-spin text-m-purple" />
              ) : (
                <span className="flex items-center gap-1.5 rounded-full bg-m-purple/15 px-3 py-1.5 text-xs font-extrabold text-m-purple">
                  <Gift className="size-3.5" strokeWidth={2.8} />
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
            className="w-full rounded-2xl border border-border/60 bg-muted/30 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
          >
            <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">
              {claimLink}
            </p>
            <span className="mt-2.5 flex items-center gap-1.5 text-xs font-bold">
              {copied ? (
                <span className="flex items-center gap-1.5 text-m-green-ink">
                  <CheckCircle2 className="size-3.5" />
                  Copied!
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Copy className="size-3.5" />
                  Tap to copy
                </span>
              )}
            </span>
          </button>
          {typeof navigator !== "undefined" && !!navigator.share && (
            <Button variant="outline" onClick={handleShare} className="w-full">
              <Share2 className="mr-2 size-4" />
              Share
            </Button>
          )}
          <p className="text-center text-[11px] font-semibold text-muted-foreground/70">
            🔒 Only someone with this link can claim the reward.
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
  return (
    <>
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 px-1 font-display text-lg font-extrabold">
          <Sparkles className="size-4 text-m-gold" strokeWidth={2.6} />
          My chores
        </h2>
        {family.chores.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border/70 bg-card/60 p-6 text-center">
            <span className="text-3xl" aria-hidden>
              🎈
            </span>
            <p className="mt-2 font-display text-sm font-extrabold">
              No chores yet
            </p>
            <p className="mt-0.5 text-[13px] font-bold text-muted-foreground text-pretty">
              Your grown-up will add some soon!
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {family.chores.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-3xl border border-border/60 bg-card p-3 shadow-sm"
              >
                <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-xl shadow-sm">
                  <span aria-hidden>{c.emoji}</span>
                </span>
                <p className="min-w-0 flex-1 truncate font-display text-[15px] font-extrabold">
                  {c.name}
                </p>
                <span className="font-display text-[13px] font-extrabold tabular-nums text-m-green-ink">
                  {c.rewardXlm.toFixed(2)} XLM
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="px-1 text-[13px] font-bold text-muted-foreground text-pretty">
          Do a chore on your home screen, then your grown-up sends the reward.
        </p>
      </section>
    </>
  );
}
