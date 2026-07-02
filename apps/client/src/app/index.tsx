import { createFileRoute, redirect } from "@tanstack/react-router";

// Maestro boots straight into the dashboard on Stellar. There is no login wall:
// the in-app Stellar wallet (see `stellar-wallet-provider`) is generated/restored
// on boot, so the family treasury is always ready. The old Privy login screen is
// retired — `/` now redirects to the dashboard.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
