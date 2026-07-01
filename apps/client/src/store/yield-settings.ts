// yield-settings.ts — localStorage-backed yield mode toggle

import { useState, useCallback } from "react";

export type YieldMode = "agent" | "manual";

const YIELD_MODE_KEY = "xylkstream_yield_mode";

export function useYieldMode() {
  const [mode, setMode] = useState<YieldMode>(() => {
    try {
      const stored = localStorage.getItem(YIELD_MODE_KEY);
      if (stored === "agent" || stored === "manual") return stored;
      return "agent";
    } catch {
      return "agent";
    }
  });

  const set = useCallback((value: YieldMode) => {
    setMode(value);
    try {
      localStorage.setItem(YIELD_MODE_KEY, value);
    } catch {
      // storage unavailable — state still updates in memory
    }
  }, []);

  return { mode, set };
}
