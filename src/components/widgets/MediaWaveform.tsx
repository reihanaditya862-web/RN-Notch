import { useId } from "react";

interface MediaWaveformProps {
  /** Bars move while true; they rest at fixed heights otherwise. */
  isPlaying: boolean;
  /** Height and width in px. */
  size?: number;
}

/** Resting height of each bar, as a fraction of the icon's height. */
const BARS = [0.45, 0.9, 0.6, 0.75];
const BAR_WIDTH = 2;
const BAR_GAP = 2;

/**
 * Small music visualizer in the blue-to-purple accent.
 *
 * It is a looping decoration, not a reading of the actual audio. The loop is
 * pure CSS (transform only) and stops under battery saver and reduced motion.
 */
export function MediaWaveform({ isPlaying, size = 14 }: MediaWaveformProps) {
  const gradientId = useId();
  const width = BARS.length * BAR_WIDTH + (BARS.length - 1) * BAR_GAP;

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${width} ${size}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1={size} x2="0" y2="0">
          <stop offset="0" stopColor="var(--notch-gradient-deep-from)" />
          <stop offset="1" stopColor="var(--notch-gradient-to)" />
        </linearGradient>
      </defs>
      {BARS.map((height, index) => (
        <rect
          key={index}
          x={index * (BAR_WIDTH + BAR_GAP)}
          y={size * (1 - height)}
          width={BAR_WIDTH}
          height={size * height}
          rx={BAR_WIDTH / 2}
          fill={`url(#${gradientId})`}
          className={isPlaying ? "notch-wave-bar" : undefined}
          style={{ animationDelay: `${index * -0.27}s` }}
        />
      ))}
    </svg>
  );
}
