// /setup — Dana's two-minute family flow (parent door from /welcome).
//
// One warm screen at a time, three beats, one primary action each:
//   1. Name the family        ("Team Okafor")
//   2. Add the kids           (name chips)
//   3. Pick starter chores    (tappable tinted rows + "add your own")
// Finish → createFamily(parent, chores) → land on /dashboard with everything real.
//
// IMPORTANT chore-data note: each chore keeps an `emoji` (it rides the invite
// link to kid devices via lib/family's codec — do NOT drop it) AND carries a
// Phosphor icon for rendering here. Only { name, emoji, rewardXlm } is persisted.

import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  BedIcon,
  TrashIcon,
  ForkKnifeIcon,
  DogIcon,
  BookOpenTextIcon,
  BroomIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  XIcon,
  UserPlusIcon,
  SparkleIcon,
  PiggyBankIcon,
} from "@phosphor-icons/react";
import { IconTile, type IconTileTint } from "@/components/atoms/icon-tile";
import { Button } from "@/components/atoms/button";
import { Input } from "@/components/atoms/input";
import { Label } from "@/components/atoms/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/molecules/dialog";
import { cn } from "@/utils";
import { toast } from "sonner";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { useFamily } from "@/hooks/use-family";
import { loadFamily, randomId } from "@/lib/family";

export const Route = createFileRoute("/setup")({
  // Setup is for a device with no family yet; if one exists, go home.
  beforeLoad: () => {
    if (typeof window !== "undefined" && loadFamily()) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: SetupPage,
});

// A starter chore the parent can tap to include. `emoji` travels through the
// invite link; `icon`/`tint` are UI-only. `defaultOn` seeds the first three.
interface Suggestion {
  key: string;
  name: string;
  emoji: string;
  rewardXlm: number;
  icon: Icon;
  tint: IconTileTint;
  defaultOn?: boolean;
}

const SUGGESTIONS: Suggestion[] = [
  { key: "bed", name: "Make the bed", emoji: "🛏️", rewardXlm: 0.5, icon: BedIcon, tint: "sky", defaultOn: true },
  { key: "trash", name: "Take out trash", emoji: "🗑️", rewardXlm: 0.3, icon: TrashIcon, tint: "green" },
  { key: "dishes", name: "Wash dishes", emoji: "🍽️", rewardXlm: 0.5, icon: ForkKnifeIcon, tint: "purple", defaultOn: true },
  { key: "dog", name: "Walk the dog", emoji: "🐕", rewardXlm: 0.8, icon: DogIcon, tint: "gold" },
  { key: "homework", name: "Homework done", emoji: "📚", rewardXlm: 1.0, icon: BookOpenTextIcon, tint: "pink", defaultOn: true },
  { key: "room", name: "Tidy your room", emoji: "🧹", rewardXlm: 0.5, icon: BroomIcon, tint: "lilac" },
];

const TOTAL_STEPS = 3;

function SetupPage() {
  const navigate = useNavigate();
  const { publicKey } = useStellarWallet();
  const { createFamily } = useFamily();

  const [step, setStep] = useState(0);

  // Beat 1 — family name.
  const [familyName, setFamilyName] = useState("");
  // Beat 2 — kid name chips.
  const [kids, setKids] = useState<string[]>([]);
  const [kidDraft, setKidDraft] = useState("");
  // Beat 3 — chores: suggestion keys that are ON + any custom chores added.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(SUGGESTIONS.filter((s) => s.defaultOn).map((s) => s.key)),
  );
  const [customChores, setCustomChores] = useState<Suggestion[]>([]);

  const addKid = () => {
    const name = kidDraft.trim();
    if (!name) return;
    if (kids.some((k) => k.toLowerCase() === name.toLowerCase())) {
      setKidDraft("");
      return;
    }
    setKids((prev) => [...prev, name]);
    setKidDraft("");
  };
  const removeKid = (name: string) =>
    setKids((prev) => prev.filter((k) => k !== name));

  const allChores = [...SUGGESTIONS, ...customChores];
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const chosenCount = selected.size;

  const canAdvance =
    step === 0 ? familyName.trim().length > 0 : step === 2 ? chosenCount > 0 : true;

  const next = () => {
    if (step === 0 && !familyName.trim()) {
      toast.error("Give your family a name first");
      return;
    }
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
    else finish();
  };
  const back = () => {
    if (step === 0) navigate({ to: "/welcome" });
    else setStep((s) => s - 1);
  };

  const finish = () => {
    const chores = allChores
      .filter((c) => selected.has(c.key))
      .map((c) => ({
        id: randomId(),
        name: c.name,
        emoji: c.emoji, // kept so it rides the invite link to kid devices
        rewardXlm: c.rewardXlm,
      }));
    createFamily({
      name: familyName.trim(),
      parentAddress: publicKey,
      kidNames: kids,
      chores,
    });
    toast.success("Your family is ready! 🎉");
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="bg-maestro-canvas fixed inset-0 z-50 overflow-y-auto">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 py-8">
        {/* Progress affordance: back caret + three dots */}
        <header className="flex items-center gap-3">
          <button
            onClick={back}
            aria-label="Back"
            className="press-pop flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-m-ink bg-card text-foreground shadow-[var(--m-pop-sm)]"
          >
            <ArrowLeftIcon className="size-5" weight="bold" />
          </button>
          <div className="flex flex-1 items-center justify-center gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-2.5 rounded-full border-2 border-m-ink transition-all duration-200",
                  i === step
                    ? "w-7 bg-primary"
                    : i < step
                      ? "w-2.5 bg-primary"
                      : "w-2.5 bg-card",
                )}
              />
            ))}
          </div>
          <div className="size-10 shrink-0" />
        </header>

        <div key={step} className="animate-pop-in mt-8 flex flex-1 flex-col">
          {step === 0 && (
            <StepName value={familyName} onChange={setFamilyName} onEnter={next} />
          )}
          {step === 1 && (
            <StepKids
              kids={kids}
              draft={kidDraft}
              setDraft={setKidDraft}
              addKid={addKid}
              removeKid={removeKid}
            />
          )}
          {step === 2 && (
            <StepChores
              chores={allChores}
              selected={selected}
              toggle={toggle}
              onAddCustom={(c) => {
                setCustomChores((prev) => [...prev, c]);
                setSelected((prev) => new Set(prev).add(c.key));
              }}
            />
          )}
        </div>

        {/* One primary action, always in the same place */}
        <div className="sticky bottom-0 -mx-6 mt-4 bg-gradient-to-t from-[oklch(0.975_0.014_92)] from-55% via-[oklch(0.975_0.014_92)] via-75% to-transparent px-6 pb-3 pt-12">
          <Button
            size="lg"
            onClick={next}
            disabled={!canAdvance}
            className="w-full text-[15px]"
          >
            {step < TOTAL_STEPS - 1 ? (
              <>
                Next
                <ArrowRightIcon className="ml-1 size-5" weight="bold" />
              </>
            ) : (
              <>
                <SparkleIcon className="mr-1 size-5" weight="fill" />
                Create {familyName.trim() || "family"}
              </>
            )}
          </Button>
          {step === 1 && kids.length === 0 && (
            <button
              onClick={next}
              className="mt-2.5 w-full text-center text-[13px] font-bold text-muted-foreground hover:text-foreground"
            >
              I&apos;ll add kids later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Beat 1 — name the family ────────────────────────────────────────────────

function StepName({
  value,
  onChange,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex size-20 items-center justify-center rounded-[1.6rem] border-2 border-m-ink bg-m-butter shadow-[var(--m-pop)]">
        <PiggyBankIcon className="size-10 text-[oklch(0.55_0.14_78)]" weight="duotone" />
      </div>
      <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight">
        Name your family
      </h1>
      <p className="mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
        This is what everyone sees at the top of the home screen.
      </p>
      <div className="mt-7 w-full text-left">
        <Label className="mb-2 text-microlabel text-muted-foreground">
          Family name
        </Label>
        <Input
          autoFocus
          placeholder="e.g. Team Okafor"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter()}
          className="h-14 text-lg"
        />
      </div>
    </div>
  );
}

// ── Beat 2 — add kids ───────────────────────────────────────────────────────

function StepKids({
  kids,
  draft,
  setDraft,
  addKid,
  removeKid,
}: {
  kids: string[];
  draft: string;
  setDraft: (v: string) => void;
  addKid: () => void;
  removeKid: (name: string) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Who&apos;s on the team?
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
          Add your kids by name. You&apos;ll send each of them an invite after.
        </p>
      </div>

      <div className="mt-7 flex items-center gap-2">
        <Input
          autoFocus
          placeholder="Add a kid…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addKid()}
          className="h-13"
        />
        <button
          type="button"
          aria-label="Add kid"
          onClick={addKid}
          className="press-pop flex size-13 shrink-0 items-center justify-center rounded-2xl border-2 border-m-ink bg-primary text-primary-foreground shadow-[var(--m-pop-sm)]"
        >
          <UserPlusIcon className="size-6" weight="bold" />
        </button>
      </div>

      {kids.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2.5 stagger-rise">
          {kids.map((k) => (
            <span
              key={k}
              className="flex items-center gap-2 rounded-full border-2 border-m-ink bg-m-sky py-2 pl-2 pr-3 shadow-[var(--m-pop-sm)]"
            >
              <span className="flex size-8 items-center justify-center rounded-full border-2 border-m-ink bg-card font-display text-sm font-extrabold text-m-blue">
                {k.charAt(0).toUpperCase()}
              </span>
              <span className="font-display text-[15px] font-extrabold">{k}</span>
              <button
                type="button"
                aria-label={`Remove ${k}`}
                onClick={() => removeKid(k)}
                className="press-pop flex size-5 items-center justify-center rounded-full bg-m-ink/10 text-foreground/60 hover:text-m-pink"
              >
                <XIcon className="size-3.5" weight="bold" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-6 card-pop bg-card/70 p-6 text-center">
          <IconTile icon={UserPlusIcon} tint="sky" size="lg" className="mx-auto" />
          <p className="mt-2 font-display text-sm font-extrabold">No kids yet</p>
          <p className="mt-0.5 text-[13px] font-bold text-muted-foreground text-pretty">
            Type a name above and tap the button.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Beat 3 — starter chores ─────────────────────────────────────────────────

function StepChores({
  chores,
  selected,
  toggle,
  onAddCustom,
}: {
  chores: Suggestion[];
  selected: Set<string>;
  toggle: (key: string) => void;
  onAddCustom: (c: Suggestion) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">
          Pick some chores
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
          Tap the ones you want. Each pays a little XLM into your kid&apos;s stash.
        </p>
      </div>

      <div className="mt-6 space-y-2.5">
        {chores.map((c) => {
          const on = selected.has(c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              className={cn(
                "press-pop flex w-full items-center gap-3 card-pop p-3 text-left transition-colors",
                on ? "card-pop-mint" : "bg-card",
              )}
            >
              <IconTile icon={c.icon} tint={c.tint} bordered />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-extrabold">
                  {c.name}
                </p>
                <p className="text-[13px] font-extrabold tabular-nums text-m-green-ink">
                  {c.rewardXlm.toFixed(2)} XLM
                </p>
              </div>
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-m-ink transition-colors",
                  on ? "bg-primary text-primary-foreground" : "bg-card",
                )}
              >
                {on && <CheckIcon className="size-4" weight="bold" />}
              </span>
            </button>
          );
        })}
      </div>

      <AddCustomChore onAdd={onAddCustom} />
    </div>
  );
}

const CUSTOM_EMOJI = ["✨", "🧺", "🌱", "🧼", "🚿", "🎒", "🧦", "🪥"];

function AddCustomChore({ onAdd }: { onAdd: (c: Suggestion) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(CUSTOM_EMOJI[0]);
  const [reward, setReward] = useState(0.5);

  const submit = () => {
    if (!name.trim()) {
      toast.error("Name the chore first");
      return;
    }
    onAdd({
      key: `custom-${randomId()}`,
      name: name.trim(),
      emoji,
      rewardXlm: reward,
      icon: SparkleIcon,
      tint: "gold",
    });
    setName("");
    setEmoji(CUSTOM_EMOJI[0]);
    setReward(0.5);
    setOpen(false);
    toast.success("Chore added");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press-pop mt-3 flex w-full items-center justify-center gap-2 rounded-[var(--m-radius-pop)] border-2 border-dashed border-m-ink/40 bg-card/40 py-3.5 font-display text-sm font-extrabold text-muted-foreground hover:border-m-ink hover:text-foreground"
      >
        <PlusIcon className="size-4" weight="bold" />
        Add your own
      </button>
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
              placeholder="e.g. Feed the cat"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div>
            <Label className="mb-2">Emoji</Label>
            <div className="flex flex-wrap gap-1.5">
              {CUSTOM_EMOJI.map((e) => (
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
                  setReward((v) => Math.max(0.1, Math.round((v - 0.1) * 100) / 100))
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
                onClick={() => setReward((v) => Math.round((v + 0.1) * 100) / 100)}
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
          <Button onClick={submit}>
            <PlusIcon className="mr-2 size-4" weight="bold" />
            Add chore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
