import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/atoms/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import {
  Copy,
  Check,
  ListChecks,
  Users,
  Sparkles,
  ChevronRight,
} from "lucide-react";
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
      <header className="animate-pop-in flex flex-col items-center gap-3 rounded-3xl border border-border/60 bg-card p-6 text-center shadow-sm">
        <Avatar className="size-20 rounded-[1.75rem] border-4 border-card shadow-md">
          <AvatarImage src={`https://avatar.vercel.sh/${publicKey || "alex"}.png`} alt="Alex" />
          <AvatarFallback className="rounded-[1.75rem] bg-m-sky font-display text-2xl font-extrabold text-m-blue">
            A
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-display text-2xl font-extrabold leading-tight">Alex</h1>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-0.5 text-xs font-extrabold text-m-green-ink">
            <Sparkles className="size-3" strokeWidth={2.8} />
            Chore Champion
          </span>
        </div>
        {publicKey && (
          <button
            type="button"
            onClick={copyAddr}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            {truncateAddress(publicKey)}
            {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
          </button>
        )}
      </header>

      {/* Quick links */}
      <section className="space-y-2.5">
        <LinkRow
          icon={ListChecks}
          tint="bg-m-mint"
          iconColor="text-m-green-ink"
          label="Set up chores & rewards"
          onClick={() => navigate({ to: "/streams" })}
        />
        <LinkRow
          icon={Users}
          tint="bg-m-lilac"
          iconColor="text-m-purple"
          label="My family"
          onClick={() => navigate({ to: "/circles" })}
        />
      </section>

      {/* Wallet — the in-app Stellar identity for the family treasury. */}
      <section className="space-y-3">
        <h2 className="px-1 font-display text-lg font-extrabold">Wallet</h2>

        <div className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3">
          <span className="text-sm font-bold text-muted-foreground">Network</span>
          <span className="rounded-full bg-card px-3 py-1 text-xs font-extrabold text-foreground shadow-sm">
            Stellar Testnet
          </span>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3">
          <span className="text-sm font-bold text-muted-foreground">XLM balance</span>
          <span className="rounded-full bg-card px-3 py-1 text-xs font-extrabold tabular-nums text-foreground shadow-sm">
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
          <Sparkles className="size-5" strokeWidth={2.4} />
          {isFunding ? "Funding…" : "Top up test XLM"}
        </Button>
      </section>
    </div>
  );
}

function LinkRow({
  icon: Icon,
  tint,
  iconColor,
  label,
  onClick,
}: {
  icon: typeof ListChecks;
  tint: string;
  iconColor: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[1.6rem] border border-border/60 bg-card p-3.5 text-left shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md active:scale-[0.99]"
    >
      <span className={`flex size-11 items-center justify-center rounded-2xl ${tint} shadow-sm`}>
        <Icon className={`size-5 ${iconColor}`} strokeWidth={2.4} />
      </span>
      <span className="flex-1 font-display text-[15px] font-bold text-foreground">{label}</span>
      <ChevronRight className="size-5 text-muted-foreground" strokeWidth={2.6} />
    </button>
  );
}
