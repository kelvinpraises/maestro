import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, PartyPopper, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/atoms/button";
import { toast } from "sonner";
import { z } from "zod";
import { useValidateInvite, useJoinCircle } from "@/hooks/use-circles";
import { useCircleCrypto } from "@/hooks/use-circle-crypto";
import { useStealthWallet } from "@/providers/stealth-wallet-provider";
import { usePending } from "@/hooks/use-pending";
import { encryptStealthAddress } from "@/utils/circle-crypto";
import { getPendingByType, removePendingAction } from "@/utils/pending-engine";
import { usePrivy } from "@privy-io/react-auth";

const joinSearchSchema = z.object({
  code: z.string().optional(),
  key: z.string().optional(),
});

export const Route = createFileRoute("/circles/join")({
  validateSearch: joinSearchSchema,
  component: JoinCirclePage,
});

/** Decorative faux-QR block — the real scan handshake happens via the invite link. */
function FauxQR() {
  return (
    <div className="relative mx-auto w-fit">
      <div className="rounded-[1.75rem] border-2 border-border bg-white p-4 shadow-md">
        <div
          className="size-40 rounded-2xl"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg,#20204a 0 8px,transparent 8px 16px),repeating-linear-gradient(90deg,#20204a 0 8px,transparent 8px 16px)",
            backgroundSize: "16px 16px",
            maskImage:
              "radial-gradient(circle at 18% 18%, #000 12%, transparent 13%), radial-gradient(circle at 82% 18%, #000 12%, transparent 13%), radial-gradient(circle at 18% 82%, #000 12%, transparent 13%), linear-gradient(#000,#000)",
          }}
        />
      </div>
      {/* SCAN ME sticker */}
      <span className="absolute -bottom-3 -right-3 -rotate-6 rounded-full bg-m-pink px-3 py-1 font-display text-xs font-extrabold text-white shadow-md">
        SCAN ME!
      </span>
    </div>
  );
}

function JoinCirclePage() {
  const navigate = useNavigate();
  const { code, key: senderPubKey } = Route.useSearch();
  const { authenticated, ready: privyReady, login } = usePrivy();
  const { isReady: walletReady, stealthAddress } = useStealthWallet();
  const { addAction, registerProcessor } = usePending();

  const { data: inviteData, isLoading: validating, error: validateError } =
    useValidateInvite(code ?? null);
  const joinCircle = useJoinCircle();
  const circleCrypto = useCircleCrypto();

  // Show cancel button after 10s on loading states
  const [showCancel, setShowCancel] = useState(false);
  const cancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLoading = validating || !privyReady;
  const isInvalid = !isLoading && (!code || !senderPubKey || validateError);
  const isUnauthenticated = !isLoading && !isInvalid && !authenticated;
  const isWalletPending = !isLoading && !isInvalid && authenticated && (!walletReady || !stealthAddress);
  const isReady = !isLoading && !isInvalid && authenticated && walletReady && !!stealthAddress;
  const isJoining = joinCircle.isPending || circleCrypto.isDeriving;
  const isSuccess = joinCircle.isSuccess;
  const isError = joinCircle.isError;

  // Start/reset 10s cancel timer on loading/joining states
  useEffect(() => {
    if (isLoading || isJoining || isWalletPending) {
      setShowCancel(false);
      cancelTimerRef.current = setTimeout(() => setShowCancel(true), 10000);
      return () => { if (cancelTimerRef.current) clearTimeout(cancelTimerRef.current); };
    }
    setShowCancel(false);
  }, [isLoading, isJoining, isWalletPending]);

  const handleCancel = useCallback(() => {
    navigate({ to: "/dashboard" });
  }, [navigate]);

  const attemptJoin = useCallback(
    async (inviteCode: string, pubKey: string, stealthAddr: string) => {
      try {
        const { encryptedStealthAddress, ephemeralPubKey } =
          encryptStealthAddress(stealthAddr, pubKey);

        await joinCircle.mutateAsync({
          inviteCode,
          encryptedStealthAddress,
          ephemeralPubKey,
        });

        // Clear any pending circle_join actions so dashboard doesn't redirect back
        for (const a of getPendingByType("circle_join")) {
          removePendingAction(a.id);
        }
        toast.success("You joined the team! 🎉");
        navigate({ to: "/circles" });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't join the team",
        );
      }
    },
    [joinCircle, navigate],
  );

  // Pending engine processor for deferred joins
  useEffect(() => {
    registerProcessor(
      "circle_join",
      async (action) => {
        const { inviteCode, senderPubKey: storedKey } = action.payload;
        if (!inviteCode || !storedKey) return;
        if (!stealthAddress) return;
        await attemptJoin(inviteCode, storedKey, stealthAddress);
      },
    );
  }, [registerProcessor, stealthAddress, attemptJoin]);

  const handleSignIn = useCallback(() => {
    if (code && senderPubKey) {
      addAction("circle_join", { inviteCode: code, senderPubKey });
    }
    login();
  }, [code, senderPubKey, addAction, login]);

  const joinFiredRef = useRef(false);

  const handleJoin = useCallback(() => {
    if (!code || !senderPubKey || !stealthAddress) return;
    joinFiredRef.current = true;
    attemptJoin(code, senderPubKey, stealthAddress);
  }, [code, senderPubKey, stealthAddress, attemptJoin]);

  const circleName = inviteData?.name ?? "the family";

  const showCancelButton =
    (showCancel && (isLoading || isWalletPending || isJoining)) ||
    (isReady && !isJoining && !isSuccess && !isError);

  return (
    <div className="bg-maestro-canvas fixed inset-0 z-50 overflow-y-auto">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 py-10 text-center">
        {/* Cancel button — top right */}
        {showCancelButton && (
          <button
            onClick={handleCancel}
            className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-sm transition-transform hover:text-foreground active:scale-95"
            title="Close"
          >
            <X className="size-5" strokeWidth={2.4} />
          </button>
        )}

        {/* Title */}
        {!isInvalid && (
          <div className="mb-7">
            <h1 className="font-display text-4xl font-extrabold tracking-tight">
              {isSuccess ? "You're in! 🎉" : isError ? "Hmm, that didn't work" : "Join the Team!"}
            </h1>
            {!isSuccess && !isError && (
              <p className="mt-2 max-w-xs text-[15px] font-bold text-muted-foreground text-pretty">
                Point a phone at this code to join{" "}
                <span className="text-foreground">{circleName}</span> and start earning.
              </p>
            )}
          </div>
        )}

        {/* State content */}
        <div className="w-full max-w-xs">
          {isLoading && (
            <div className="flex flex-col items-center gap-4">
              <FauxQR />
              <p className="flex items-center gap-2 pt-2 text-sm font-bold text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Checking your invite…
              </p>
            </div>
          )}

          {isInvalid && (
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex size-20 items-center justify-center rounded-[1.75rem] bg-destructive/10 text-4xl shadow-inner">
                <span aria-hidden>😕</span>
              </div>
              <h2 className="mb-2 font-display text-2xl font-extrabold">Invite not valid</h2>
              <p className="mb-8 text-sm font-semibold text-muted-foreground text-pretty">
                {validateError instanceof Error
                  ? validateError.message
                  : "This link is missing something or has expired."}
              </p>
              <Button variant="outline" onClick={() => navigate({ to: "/circles" })} className="w-full">
                Go to my teams
              </Button>
            </div>
          )}

          {isUnauthenticated && (
            <div className="flex flex-col items-center gap-6">
              <FauxQR />
              <div className="w-full">
                <p className="mb-4 text-sm font-semibold text-muted-foreground text-pretty">
                  Sign in to join. Your info stays private — only the grown-up who
                  invited you can see it.
                </p>
                <Button onClick={handleSignIn} size="lg" className="w-full">
                  Sign in to join
                </Button>
              </div>
            </div>
          )}

          {isWalletPending && (
            <div className="flex flex-col items-center gap-4">
              <FauxQR />
              <p className="pt-2 text-sm font-semibold text-muted-foreground text-pretty">
                Setting things up — you'll be added automatically. ✨
              </p>
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          )}

          {/* Ready to join */}
          {isReady && !isJoining && !isSuccess && !isError && (
            <div className="flex flex-col items-center gap-6">
              <FauxQR />
              <div className="w-full">
                <p className="mb-4 text-sm font-semibold text-muted-foreground text-pretty">
                  Your info stays private — only the circle owner can see it.
                </p>
                <Button onClick={handleJoin} size="lg" className="w-full">
                  Join the team!
                </Button>
              </div>
            </div>
          )}

          {isJoining && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-20 items-center justify-center rounded-[1.75rem] bg-primary/10 text-4xl shadow-inner">
                <Loader2 className="size-8 animate-spin text-primary" />
              </div>
              <p className="text-sm font-bold text-muted-foreground">Adding you to the team…</p>
            </div>
          )}

          {isSuccess && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex size-24 items-center justify-center rounded-full bg-m-mint text-5xl shadow-inner">
                <PartyPopper className="size-10 text-m-green-ink" />
              </div>
              <p className="text-sm font-bold text-muted-foreground">Taking you in…</p>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex size-20 items-center justify-center rounded-[1.75rem] bg-destructive/10 shadow-inner">
                <AlertCircle className="size-9 text-destructive" />
              </div>
              <p className="mb-8 text-sm font-semibold text-muted-foreground text-pretty">
                {joinCircle.error instanceof Error
                  ? joinCircle.error.message
                  : "Something went wrong."}
              </p>
              <div className="flex w-full gap-3">
                <Button variant="outline" onClick={() => navigate({ to: "/circles" })} className="flex-1">
                  My teams
                </Button>
                <Button
                  onClick={() => {
                    joinFiredRef.current = false;
                    handleJoin();
                  }}
                  className="flex-1"
                >
                  Try again
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer / "later" affordance */}
        {(isUnauthenticated || isReady) && !isJoining && !isSuccess && (
          <button
            onClick={handleCancel}
            className="mt-8 rounded-full border-2 border-border bg-card px-6 py-2.5 text-sm font-extrabold text-muted-foreground shadow-sm transition-transform hover:text-foreground active:scale-95"
          >
            I'll do it later
          </button>
        )}

        <p className="absolute bottom-6 flex items-center gap-1 text-xs font-bold text-muted-foreground/60">
          🔒 Private &amp; safe
        </p>
      </div>
    </div>
  );
}
