// /circles/join — legacy server-backed join flow, now retired.
//
// The serverless family invite flow lives at /join (see src/app/join.tsx). Any
// old QR/link that still points here is bounced to the family home. NOTHING in
// this file talks to the old API server.

import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/circles/join")({
  component: () => <Navigate to="/circles" replace />,
});
