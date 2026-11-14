import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  Plug,
  type LucideIcon,
} from "lucide-react";
import { useNotchStore } from "../../stores/notchStore";

const LOW_THRESHOLD = 10;
const CRITICAL_THRESHOLD = 5;

function pickIcon(percent: number, onAc: boolean): LucideIcon {
  if (onAc) return BatteryCharging;
  if (percent < LOW_THRESHOLD) return BatteryWarning;
  if (percent < 35) return BatteryLow;
  if (percent < 75) return BatteryMedium;
  return BatteryFull;
}

const TEXT_CLASS = "font-mono text-[12px] leading-none font-medium tracking-[-0.02em] tabular-nums";

/**
 * Compact battery status: icon + percentage.
 *
 * Shows the real Windows battery state from the system info polls
 * (`useSystemInfo`), so it always agrees with the dashboard.
 */
export function BatteryIndicator() {
  const isLoaded = useNotchStore((store) => store.systemInfo !== null);
  const percent = useNotchStore((store) => store.systemInfo?.battery_percent ?? null);
  const isCharging = useNotchStore((store) => store.systemInfo?.is_charging ?? false);
  const onAc = useNotchStore((store) => store.systemInfo?.is_ac_connected ?? false);

  if (!isLoaded) {
    return (
      <span
        aria-label="Battery status unavailable"
        className="flex shrink-0 items-center gap-1 text-notch-tertiary"
      >
        <Battery size={14} strokeWidth={1.5} aria-hidden="true" />
        <span className={TEXT_CLASS}>--</span>
      </span>
    );
  }

  // A desktop PC: no battery to report, only mains power.
  if (percent === null) {
    return (
      <span
        aria-label="Running on mains power"
        className="flex shrink-0 items-center gap-1 text-notch-secondary"
      >
        <Plug size={14} strokeWidth={1.5} aria-hidden="true" />
        <span className={TEXT_CLASS}>AC</span>
      </span>
    );
  }

  const isLow = !onAc && percent < LOW_THRESHOLD;
  const isCritical = !onAc && percent < CRITICAL_THRESHOLD;
  const Icon = pickIcon(percent, onAc);

  const tone = onAc ? "text-notch-charging" : isLow ? "text-notch-error" : "text-notch-secondary";
  const motion = isCharging ? "notch-pulse" : isLow ? "notch-blink" : "";

  const label = `Battery ${percent}%${
    isCharging ? ", charging" : onAc ? ", plugged in" : isLow ? ", low" : ""
  }`;

  return (
    <span aria-label={label} className={`flex shrink-0 items-center gap-1 ${tone}`}>
      <Icon size={14} strokeWidth={1.5} aria-hidden="true" className={motion} />
      <span className={TEXT_CLASS}>
        {isCritical ? "Low! " : ""}
        {percent}%
      </span>
    </span>
  );
}
