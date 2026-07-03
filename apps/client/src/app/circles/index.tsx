import { createFileRoute, redirect } from "@tanstack/react-router";

// /circles → /family. The screen moved to the "Family" tab (DESIGN-STORY §5,
// principle #7: route names become product names). Kept as a permanent redirect
// so any old link, bookmark, or in-app path never 404s.
export const Route = createFileRoute("/circles/")({
  beforeLoad: () => {
    throw redirect({ to: "/family", replace: true });
  },
});
