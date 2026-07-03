import { createFileRoute, redirect } from "@tanstack/react-router";

// /settings → /me. The screen moved to the "Me" tab (DESIGN-STORY §5). Kept as a
// permanent redirect so any old link, bookmark, or in-app path never 404s.
export const Route = createFileRoute("/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/me", replace: true });
  },
});
