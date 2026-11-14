import { useEffect, useState } from "react";
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  type LucideIcon,
} from "lucide-react";

/** Battery Status API. Available in WebView2, but not part of TypeScript's DOM typings. */
interface BatteryManager extends EventTarget {
  readonly charging: boolean;
  readonly level: number;
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManager>;
};

interface BatteryStatus {
  percent: number;
  charging: boolean;
}

const LOW_THRESHOLD = 10;
const CRITICAL_THRESHOLD = 5;

function readStatus(battery: BatteryManager): BatteryStatus {
  return {
    percent: Math.round(battery.level * 100),
    charging: battery.charging,
  };
}

function pickIcon(status: BatteryStatus): LucideIcon {
  if (status.charging) return BatteryCharging;
  if (status.percent < LOW_THRESHOLD) return BatteryWarning;
  if (status.percent < 35) return BatteryLow;
  if (status.percent < 75) return BatteryMedium;
  return BatteryFull;
}

/**
 * Compact battery status: icon + percentage.
 *
 * Reads the level from the webview's Battery Status API and updates on
 * `levelchange` / `chargingchange` events, so there is no polling.
 */
export function BatteryIndicator() {
  const [status, setStatus] = useState<BatteryStatus | null>(null);

  useEffect(() => {
    const getBattery = (navigator as NavigatorWithBattery).getBattery;
    if (typeof getBattery !== "function") return;

    let disposed = false;
    let battery: BatteryManager | null = null;

    const update = () => {
      if (battery && !disposed) setStatus(readStatus(battery));
    };

    getBattery
      .call(navigator)
      .then((manager) => {
        if (disposed) return;
        battery = manager;
        update();
        manager.addEventListener("levelchange", update);
        manager.addEventListener("chargingchange", update);
      })
      .catch((error: unknown) => {
        console.warn("[BatteryIndicator] battery status unavailable:", error);
      });

    return () => {
      disposed = true;
      battery?.removeEventListener("levelchange", update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, []);

  if (!status) {
    return (
      <span
        aria-label="Battery status unavailable"
        className="flex items-center gap-1 text-notch-tertiary"
      >
        <Battery size={14} strokeWidth={1.5} aria-hidden="true" />
        <span className="font-mono text-[12px] leading-none font-medium tracking-[-0.02em]">
          --
        </span>
      </span>
    );
  }

  const isLow = !status.charging && status.percent < LOW_THRESHOLD;
  const isCritical = !status.charging && status.percent < CRITICAL_THRESHOLD;
  const Icon = pickIcon(status);

  const tone = status.charging
    ? "text-notch-charging"
    : isLow
      ? "text-notch-error"
      : "text-notch-secondary";
  const motion = status.charging ? "notch-pulse" : isLow ? "notch-blink" : "";

  const label = `Battery ${status.percent}%${status.charging ? ", charging" : ""}${
    isLow ? ", low" : ""
  }`;

  return (
    <span aria-label={label} className={`flex items-center gap-1 ${tone}`}>
      <Icon size={14} strokeWidth={1.5} aria-hidden="true" className={motion} />
      <span className="font-mono text-[12px] leading-none font-medium tracking-[-0.02em] tabular-nums">
        {isCritical ? "Low! " : ""}
        {status.percent}%
      </span>
    </span>
  );
}
