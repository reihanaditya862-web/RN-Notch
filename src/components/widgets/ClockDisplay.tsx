import { useEffect, useState } from "react";

interface ClockDisplayProps {
  /** `true` shows HH:mm:ss, `false` shows HH:mm. */
  showSeconds?: boolean;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTime(date: Date, showSeconds: boolean): string {
  const base = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return showSeconds ? `${base}:${pad(date.getSeconds())}` : base;
}

/**
 * Real-time digital clock in JetBrains Mono.
 *
 * Each tick is scheduled for the next second (or minute) boundary instead of
 * a fixed interval, so the display never drifts or skips a value.
 */
export function ClockDisplay({ showSeconds = true }: ClockDisplayProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const unit = showSeconds ? 1000 : 60_000;
    let timer = 0;

    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, unit - (Date.now() % unit));
    };

    tick();
    return () => window.clearTimeout(timer);
  }, [showSeconds]);

  const text = formatTime(now, showSeconds);

  return (
    <time
      dateTime={now.toISOString()}
      aria-label={`Time ${text}`}
      className="shrink-0 font-mono text-[12px] leading-none font-medium tracking-[-0.02em] tabular-nums text-notch-primary"
    >
      {text}
    </time>
  );
}
