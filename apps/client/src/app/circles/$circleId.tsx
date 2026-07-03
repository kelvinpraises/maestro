// /circles/$circleId — legacy server-backed circle detail, now retired.
//
// The serverless family layer has a single family per device, managed at
// /circles (see src/app/circles/index.tsx). This route just bounces back there.
// NOTHING in this file talks to the old API server.

import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/circles/$circleId")({
  component: () => <Navigate to="/circles" replace />,
});
