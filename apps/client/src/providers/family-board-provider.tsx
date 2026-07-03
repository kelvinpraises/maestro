// FamilyBoardProvider — mounts the family-board sync loop once, app-wide.
//
// The hook itself (use-family-board) holds no rendered state the tree needs; it
// just runs the poll/push loop for the current family and reacts to the
// "maestro:board-push" event that mutation sites fire (via requestBoardPush).
// Mounting it here — inside the wallet provider, so the device keypair is ready —
// keeps a single sync loop alive for the whole session.

import type { ReactNode } from "react";
import { useFamilyBoard } from "@/hooks/use-family-board";

export function FamilyBoardProvider({ children }: { children: ReactNode }) {
  useFamilyBoard();
  return <>{children}</>;
}
