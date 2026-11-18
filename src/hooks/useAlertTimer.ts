import { useEffect, useRef } from "react";
import type { Alert } from "../lib/alerts";
import { useNotchStore } from "../stores/notchStore";

/** After the cursor leaves a paused pop-up, it stays at least this long. */
const MIN_REMAINING_MS = 1500;

/**
 * Removes the pop-up on screen once its time is up. While the cursor rests on
 * it the countdown stands still, so a message can be read to the end.
 */
export function useAlertTimer(alert: Alert | null, isPaused: boolean): void {
  const remaining = useRef<{ id: string; ms: number } | null>(null);

  useEffect(() => {
    if (!alert) return;
    if (remaining.current?.id !== alert.id) remaining.current = { id: alert.id, ms: alert.durationMs };
    if (isPaused) return;

    const started = Date.now();
    const left = Math.max(MIN_REMAINING_MS, remaining.current.ms);
    const timer = window.setTimeout(() => useNotchStore.getState().dismissAlert(alert.id), left);
    return () => {
      window.clearTimeout(timer);
      if (remaining.current?.id === alert.id) remaining.current.ms = left - (Date.now() - started);
    };
  }, [alert, isPaused]);
}
