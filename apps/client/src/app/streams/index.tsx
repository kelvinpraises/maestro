import { createFileRoute, redirect } from "@tanstack/react-router";

// /streams → /allowance. Allowance became a first-class page of its own (owner:
// "I think allowance should be its own page") — the substance moved to
// /allowance. Kept as a permanent redirect so every existing entry point (the
// Family Bank "Set up allowance" on Home, the For-grown-ups entry in Me, and
// any old bookmark) keeps working without those screens changing.
export const Route = createFileRoute("/streams/")({
  beforeLoad: () => {
    throw redirect({ to: "/allowance", replace: true });
  },
});
