import { useId } from "react";
import { Plug } from "lucide-react";
import { BATTERY_LOW_THRESHOLD } from "../../lib/constants";
import { useNotchStore } from "../../stores/notchStore";

/** Below this level the percentage is prefixed with "Low!". */
const CRITICAL_THRESHOLD = 5;

/** Geometry of the icon, in px. */
const ICON_WIDTH = 25;
const ICON_HEIGHT = 12;
const BODY_WIDTH = 22;
const BODY_RADIUS = 3.5;
/** Gap between the body's outline and the fill bar. */
const FILL_INSET = 2;
const FILL_MAX_WIDTH = BODY_WIDTH - FILL_INSET * 2;
const FILL_HEIGHT = ICON_HEIGHT - FILL_INSET * 2;

type Tone = "charging" | "normal" | "low";

interface BatteryIconProps {
  /** 0-100. */
  percent: number;
  tone: Tone;
  /** Draws the charging bolt over the body. */
  hasBolt: boolean;
  className?: string;
}

/**
 * Slim horizontal battery: a rounded body with a small terminal cap on the
 * right, a fill bar that follows the level, and a sharp bolt while plugged in.
 */
function BatteryIcon({ percent, tone, hasBolt, className }: BatteryIconProps) {
  const gradientId = useId();
  const level = Math.min(100, Math.max(0, percent)) / 100;
  // Keep a sliver visible above 0%, so the bar never disappears entirely.
  const fillWidth = level === 0 ? 0 : Math.max(2, FILL_MAX_WIDTH * level);

  const fill =
    tone === "charging"
      ? "var(--notch-accent-emerald)"
      : tone === "low"
        ? "var(--notch-accent-red)"
        : `url(#${gradientId})`;

  return (
    <svg
      width={ICON_WIDTH}
      height={ICON_HEIGHT}
      viewBox={`0 0 ${ICON_WIDTH} ${ICON_HEIGHT}`}
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        {/* Spans the whole body, so the colour at a given spot does not shift as the level changes. */}
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={FILL_INSET}
          y1="0"
          x2={BODY_WIDTH - FILL_INSET}
          y2="0"
        >
          <stop offset="0" stopColor="var(--notch-gradient-deep-from)" />
          <stop offset="1" stopColor="var(--notch-gradient-to)" />
        </linearGradient>
      </defs>

      {/* Body */}
      <rect
        x="0.5"
        y="0.5"
        width={BODY_WIDTH - 1}
        height={ICON_HEIGHT - 1}
        rx={BODY_RADIUS}
        stroke="currentColor"
        strokeOpacity="0.55"
      />
      {/* Terminal cap */}
      <path
        d={`M${BODY_WIDTH + 1} 4v4a2 2 0 0 0 1.5-2 2 2 0 0 0-1.5-2Z`}
        fill="currentColor"
        fillOpacity="0.55"
      />
      {/* Level */}
      <rect
        x={FILL_INSET}
        y={FILL_INSET}
        width={fillWidth}
        height={FILL_HEIGHT}
        rx={BODY_RADIUS - FILL_INSET + 0.5}
        fill={fill}
        style={{ transition: "width 400ms ease-out" }}
      />
      {/* Charging bolt, with a dark edge so it reads on top of any fill. */}
      {hasBolt && (
        <path
          d="M12.6 1.2 8 6.7h2.7l-1.3 4.1 4.6-5.5h-2.7l1.3-4.1Z"
          fill="var(--notch-text-primary)"
          stroke="var(--notch-bg)"
          strokeWidth="0.6"
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      )}
    </svg>
  );
}

/**
 * Compact battery status: icon + percentage.
 *
 * Shows the real Windows battery state from the system info polls
 * (`useSystemInfo`), so it always agrees with the dashboard.
 *
 * Fill colour: green while plugged in, the blue-to-purple accent on battery,
 * red below 15%.
 */
export function BatteryIndicator() {
  const isLoaded = useNotchStore((store) => store.systemInfo !== null);
  const percent = useNotchStore((store) => store.systemInfo?.battery_percent ?? null);
  const isCharging = useNotchStore((store) => store.systemInfo?.is_charging ?? false);
  const onAc = useNotchStore((store) => store.systemInfo?.is_ac_connected ?? false);

  const textClass = "font-display text-[12px] leading-none font-bold tracking-[-0.01em]";

  if (!isLoaded) {
    return (
      <span
        aria-label="Battery status unavailable"
        className="flex shrink-0 items-center gap-1 text-notch-tertiary"
      >
        <BatteryIcon percent={0} tone="normal" hasBolt={false} />
        <span className={textClass}>--</span>
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
        <span className={textClass}>AC</span>
      </span>
    );
  }

  const isLow = !onAc && percent < BATTERY_LOW_THRESHOLD;
  const isCritical = !onAc && percent < CRITICAL_THRESHOLD;
  const tone: Tone = onAc ? "charging" : isLow ? "low" : "normal";

  const label = `Battery ${percent}%${
    isCharging ? ", charging" : onAc ? ", plugged in" : isLow ? ", low" : ""
  }`;

  return (
    <span
      aria-label={label}
      className={[
        "flex shrink-0 items-center gap-1",
        isLow ? "text-notch-error" : "text-notch-primary",
      ].join(" ")}
    >
      <BatteryIcon
        percent={percent}
        tone={tone}
        hasBolt={onAc}
        className={isCharging ? "notch-pulse" : isLow ? "notch-blink" : undefined}
      />
      <span className={textClass}>
        {isCritical ? "Low! " : ""}
        {percent}%
      </span>
    </span>
  );
}
