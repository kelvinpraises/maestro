import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/atoms/button";
import { Switch } from "@/components/atoms/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/atoms/avatar";
import {
  Copy,
  Check,
  ListChecks,
  Users,
  ShieldCheck,
  Sparkles,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useChain } from "@/providers/chain-provider";
import { useStealthWallet } from "@/providers/stealth-wallet-provider";
import { usePrivacyMode } from "@/store/wallet-registry";
import { useAutoCollectSetting } from "@/hooks/use-auto-collect";
import { useLogout } from "@/hooks/use-logout";
import { truncateAddress } from "@/utils";

export const Route = createFileRoute("/settings")({
  component: MePage,
});

function MePage() {
  const navigate = useNavigate();
  const { user } = usePrivy();
  const { chainConfig } = useChain();
  const { stealthAddress } = useStealthWallet();
  const privacyMode = usePrivacyMode();
  const autoCollect = useAutoCollectSetting();
  const { mutate: logout, isPending: loggingOut } = useLogout();
  const [copied, setCopied] = useState(false);

  const copyAddr = () => {
    if (!stealthAddress) return;
    navigator.clipboard.writeText(stealthAddress);
    setCopied(true);
    toast.success("Address copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="stagger-rise space-y-5">
      {/* Profile header */}
      <header className="animate-pop-in flex flex-col items-center gap-3 rounded-3xl border border-border/60 bg-card p-6 text-center shadow-sm">
        <Avatar className="size-20 rounded-[1.75rem] border-4 border-card shadow-md">
          <AvatarImage src={`https://avatar.vercel.sh/${stealthAddress || "alex"}.png`} alt="Alex" />
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
        {stealthAddress && (
          <button
            type="button"
            onClick={copyAddr}
            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            {truncateAddress(stealthAddress)}
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

      {/* Grown-up controls */}
      <section className="space-y-3">
        <h2 className="px-1 font-display text-lg font-extrabold">Grown-up controls</h2>

        <ToggleRow
          icon={ShieldCheck}
          title="Private wallets"
          subtitle="Give each chore its own safe piggy bank."
          checked={privacyMode.enabled}
          onChange={privacyMode.toggle}
        />
        <ToggleRow
          icon={Sparkles}
          title="Auto-collect rewards"
          subtitle="Coins land in the stash automatically."
          checked={autoCollect.enabled}
          onChange={autoCollect.set}
        />

        <div className="flex items-center justify-between rounded-2xl bg-muted/40 px-4 py-3">
          <span className="text-sm font-bold text-muted-foreground">Network</span>
          <span className="rounded-full bg-card px-3 py-1 text-xs font-extrabold text-foreground shadow-sm">
            {chainConfig.chain.name}
          </span>
        </div>
      </section>

      {/* Log out */}
      {user && (
        <Button
          variant="outline"
          size="lg"
          className="w-full text-destructive"
          disabled={loggingOut}
          onClick={() => logout()}
        >
          <LogOut className="size-5" strokeWidth={2.4} />
          Log out
        </Button>
      )}
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

function ToggleRow({
  icon: Icon,
  title,
  subtitle,
  checked,
  onChange,
}: {
  icon: typeof ShieldCheck;
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[1.6rem] border border-border/60 bg-card p-3.5 shadow-sm">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-m-butter shadow-sm">
        <Icon className="size-5 text-[oklch(0.55_0.12_78)]" strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-bold text-foreground">{title}</p>
        <p className="text-xs font-semibold text-muted-foreground text-pretty">{subtitle}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
