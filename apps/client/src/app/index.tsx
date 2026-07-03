import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadFamily } from "@/lib/family";

// Maestro's front door. There is no login wall: the in-app Stellar wallet (see
// `stellar-wallet-provider`) is generated/restored on boot, so the family
// treasury is always ready. The only branch here is whether this device has
// already joined/created a family:
//   • no family  → /welcome (the two-door front door; wallet is born silently)
//   • has family → /dashboard (straight to the family home)
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    const hasFamily = typeof window !== "undefined" && !!loadFamily();
    throw redirect({ to: hasFamily ? "/dashboard" : "/welcome" });
  },
});
