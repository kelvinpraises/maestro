import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/atoms/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import {
  CopyIcon,
  CheckIcon,
  ListChecksIcon,
  UsersIcon,
  SparkleIcon,
  CaretRightIcon,
  type Icon,
} from "@phosphor-icons/react";
import { IconTile, type IconTileTint } from "@/components/atoms/icon-tile";
import { toast } from "sonner";
import { useState } from "react";
import { useStellarWallet } from "@/providers/stellar-wallet-provider";
import { truncateAddress } from "@/utils";

export const Route = createFileRoute("/settings")({
  component: MePage,
});

function MePage() {
  const navigate = useNavigate();
  const { publicKey, xlmBalance, fund, isFunding } = useStellarWallet();
  const [copied, setCopied] = useState(false);

  const copyAddr = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="stagger-rise space-y-5">
      {/* Profile header */}
      <header className="animate-pop-in card-pop flex flex-col items-center gap-3 p-6 text-center">
        <Avatar className="size-20 rounded-[1.75rem] border-2 border-m-ink shadow-[var(--m-pop-sm)]">
          <AvatarImage src={`https://avatar.vercel.sh/${publicKey || "alex"}.png`} alt="Alex" />
          <AvatarFallback className="rounded-[1.75rem] bg-m-sky font-display text-2xl font-extrabold text-m-blue">
            A
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-display text-2xl font-extrabold leading-tight">Alex</h1>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border-2 border-m-ink bg-primary/20 px-3 py-0.5 text-xs font-extrabold text-m-green-ink">
            <SparkleIcon className="size-3" weight="fill" />
            Chore Champion
          </span>
        </div>
        {publicKey && (
          <button
            type="button"
            onClick={copyAddr}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-m-ink/25 bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            {truncateAddress(publicKey)}
            {copied ? <CheckIcon className="size-3.5 text-primary" weight="bold" /> : <CopyIcon className="size-3.5" weight="bold" />}
          </button>
        )}
      </header>

      {/* Quick links */}
      <section className="space-y-2.5">
        <LinkRow
          icon={ListChecksIcon}
          tint="mint"
          label="Set up chores & rewards"
          onClick={() => navigate({ to: "/circles" })}
        />
        <LinkRow
          icon={UsersIcon}
          tint="lilac"
          label="My family"
          onClick={() => navigate({ to: "/circles" })}
        />
      </section>

      {/* Wallet — the in-app Stellar identity for the family treasury. */}
      <section className="space-y-3">
        <h2 className="px-1 font-display text-lg font-extrabold">Wallet</h2>

        <div className="flex items-center justify-between rounded-2xl border-2 border-m-ink bg-card px-4 py-3">
          <span className="text-sm font-bold text-muted-foreground">Network</span>
          <span className="rounded-full border border-m-ink/25 bg-muted px-3 py-1 text-xs font-extrabold text-foreground">
            Stellar Testnet
          </span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border-2 border-m-ink bg-card px-4 py-3">
          <span className="text-sm font-bold text-muted-foreground">XLM balance</span>
          <span className="rounded-full border-2 border-m-ink bg-m-butter px-3 py-1 text-xs font-extrabold tabular-nums text-foreground">
            {xlmBalance === null ? "…" : `${parseFloat(xlmBalance).toFixed(2)} XLM`}
          </span>
        </div>
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          disabled={isFunding}
          onClick={() => void fund()}
        >
          <SparkleIcon className="size-5" weight="fill" />
          {isFunding ? "Funding…" : "Top up test XLM"}
        </Button>
      </section>
    </div>
  );
}

function LinkRow({
  icon,
  tint,
  label,
  onClick,
}: {
  icon: Icon;
  tint: IconTileTint;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-pop card-pop flex w-full items-center gap-3 p-3.5 text-left"
    >
      <IconTile icon={icon} tint={tint} bordered />
      <span className="flex-1 font-display text-[15px] font-bold text-foreground">{label}</span>
      <CaretRightIcon className="size-5 text-muted-foreground" weight="bold" />
    </button>
  );
}
