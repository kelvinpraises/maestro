import { createFileRoute, redirect } from "@tanstack/react-router";

// /history → /family. The treasury feed folded into the "Family" tab as its
// "Family treasury" section — no orphan tab (DESIGN-STORY §5). Kept as a
// permanent redirect so any old link, bookmark, or in-app path never 404s.
export const Route = createFileRoute("/history")({
  beforeLoad: () => {
    throw redirect({ to: "/family", replace: true });
  },
});
