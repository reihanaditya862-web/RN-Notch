import { useEffect } from "react";
import { BATTERY_SAVER_POLL_FACTOR, BATTERY_SAVER_THRESHOLD } from "../lib/constants";
import { useNotchStore } from "../stores/notchStore";

interface BatterySaver {
  /** True while the laptop runs on battery below the threshold. */
  isBatterySaver: boolean;
  /** Stretches a polling interval while saving; passes `null` (paused) through. */
  scalePoll: (intervalMs: number | null) => number | null;
}

/**
 * Battery saver: active while the laptop is on battery (no charger) below
 * `BATTERY_SAVER_THRESHOLD` percent, and off again the moment it is plugged in.
 *
 * While active:
 * - springs are replaced by a short tween (the caller picks the transition),
 * - polling intervals are stretched by `BATTERY_SAVER_POLL_FACTOR`,
 * - `<html data-battery-saver>` is set, which switches off blur, glow and
 *   looping animations in CSS (see globals.css).
 */
export function useBatterySaver(): BatterySaver {
  const isBatterySaver = useNotchStore((store) => {
    const info = store.systemInfo;
    return (
      info !== null &&
      info.battery_percent !== null &&
      !info.is_ac_connected &&
      info.battery_percent < BATTERY_SAVER_THRESHOLD
    );
  });

  useEffect(() => {
    document.documentElement.toggleAttribute("data-battery-saver", isBatterySaver);
    return () => document.documentElement.removeAttribute("data-battery-saver");
  }, [isBatterySaver]);

  const scalePoll = (intervalMs: number | null) =>
    intervalMs === null || !isBatterySaver ? intervalMs : intervalMs * BATTERY_SAVER_POLL_FACTOR;

  return { isBatterySaver, scalePoll };
}
