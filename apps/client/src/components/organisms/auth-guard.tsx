// Maestro no longer gates the app behind Privy login. The in-app Stellar wallet
// is generated/restored on boot, so every route is reachable immediately. This
// guard is now a pass-through — kept as a seam so a future real gate (e.g. a
// PIN/password on the local key) can slot back in without touching every route.
export function AuthGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
