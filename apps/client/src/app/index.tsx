import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  component: LoginPage,
});

function LoginPage() {
  const { ready, authenticated, login } = usePrivy();
  const navigate = useNavigate();

  useEffect(() => {
    if (ready && authenticated) {
      navigate({ to: "/dashboard" });
    }
  }, [ready, authenticated, navigate]);

  // Don't flash the login page if already authenticated
  if (!ready || authenticated) {
    return (
      <div className="bg-maestro-canvas flex min-h-dvh w-full items-center justify-center">
        <div className="size-9 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="bg-maestro-canvas relative min-h-dvh w-full overflow-hidden">
      {/* soft playful color blobs */}
      <div className="pointer-events-none absolute -left-16 top-10 size-56 rounded-full bg-m-mint/60 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-24 size-52 rounded-full bg-m-lilac/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 left-1/4 size-56 rounded-full bg-m-butter/60 blur-3xl" />

      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
        {/* Mascot */}
        <div className="mb-6 animate-[pop-in_0.5s_cubic-bezier(0.34,1.56,0.64,1)_both]">
          <div className="animate-float-soft flex size-28 items-center justify-center rounded-[2.25rem] bg-card text-6xl shadow-lg ring-1 ring-black/[0.04]">
            <span aria-hidden>🐷</span>
          </div>
        </div>

        {/* Wordmark */}
        <h1 className="font-display text-6xl font-extrabold tracking-tight text-foreground">
          Maestro
        </h1>
        <p className="mt-2 max-w-xs text-lg font-bold text-muted-foreground text-pretty">
          Do chores. Earn rewards. Watch your savings grow.
        </p>

        {/* CTA */}
        <button
          onClick={login}
          disabled={!ready}
          className="mt-8 h-14 w-full max-w-xs rounded-full bg-primary font-display text-lg font-extrabold text-primary-foreground shadow-lg transition-[transform,filter] duration-150 hover:brightness-[1.04] active:scale-[0.97] disabled:opacity-50"
        >
          {!ready ? "Loading…" : "Let's Go! 🚀"}
        </button>
        <button
          onClick={login}
          disabled={!ready}
          className="mt-3 text-sm font-bold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          I already have an account
        </button>

        {/* Feature trio */}
        <div className="mt-12 grid w-full grid-cols-3 gap-3">
          {[
            { emoji: "✅", label: "Finish quests" },
            { emoji: "💰", label: "Earn coins" },
            { emoji: "🎯", label: "Reach goals" },
          ].map((f) => (
            <div
              key={f.label}
              className="flex flex-col items-center gap-1.5 rounded-3xl border border-border/60 bg-card/70 p-3 shadow-sm"
            >
              <span className="text-2xl" aria-hidden>
                {f.emoji}
              </span>
              <span className="text-[11px] font-extrabold text-muted-foreground">
                {f.label}
              </span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
