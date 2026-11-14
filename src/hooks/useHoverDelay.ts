import { useCallback, useEffect, useRef, useState } from "react";

interface HoverDelayOptions {
  /** How long the cursor must stay before the hover counts, in ms. */
  enterDelay?: number;
  /** How long after the cursor leaves the hover is kept, in ms. */
  leaveDelay?: number;
}

interface HoverDelay {
  /** The debounced hover state: true once the enter delay has passed. */
  isActive: boolean;
  /** Call when the cursor enters. Safe to call repeatedly. */
  enter: () => void;
  /** Call when the cursor leaves. Safe to call repeatedly. */
  leave: () => void;
  /**
   * Activates at once, skipping the enter delay (a click, a file drop).
   * If the cursor is not over the target, the leave countdown starts right away.
   */
  open: () => void;
}

/**
 * Anti-flicker hover.
 *
 * - `enter()` turns `isActive` on only after `enterDelay`, so a cursor that
 *   merely passes over the capsule does not expand it.
 * - `leave()` turns it off only after `leaveDelay`, which gives the user time
 *   to come back.
 * - Re-entering before the leave delay ends cancels the collapse; leaving
 *   before the enter delay ends cancels the expansion.
 */
export function useHoverDelay({
  enterDelay = 150,
  leaveDelay = 600,
}: HoverDelayOptions = {}): HoverDelay {
  const [isActive, setIsActive] = useState(false);

  // Mirrors of the state for the callbacks, so they never go stale.
  const activeRef = useRef(false);
  const wantedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const settle = useCallback((next: boolean) => {
    activeRef.current = next;
    setIsActive(next);
  }, []);

  const schedule = useCallback(
    (next: boolean, delay: number) => {
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        settle(next);
      }, delay);
    },
    [settle],
  );

  const enter = useCallback(() => {
    if (wantedRef.current) return;
    wantedRef.current = true;
    clearTimer();
    if (!activeRef.current) schedule(true, enterDelay);
  }, [clearTimer, schedule, enterDelay]);

  const leave = useCallback(() => {
    if (!wantedRef.current) return;
    wantedRef.current = false;
    clearTimer();
    if (activeRef.current) schedule(false, leaveDelay);
  }, [clearTimer, schedule, leaveDelay]);

  const open = useCallback(() => {
    clearTimer();
    if (!activeRef.current) settle(true);
    if (!wantedRef.current) schedule(false, leaveDelay);
  }, [clearTimer, settle, schedule, leaveDelay]);

  useEffect(() => clearTimer, [clearTimer]);

  return { isActive, enter, leave, open };
}
