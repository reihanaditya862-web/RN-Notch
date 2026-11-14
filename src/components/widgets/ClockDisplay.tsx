import { useEffect, useState } from "react";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Real-time digital clock (HH:mm:ss) in JetBrains Mono.
 *
 * Each tick is scheduled for the next second boundary instead of a fixed
 * 1000ms interval, so the display never drifts or skips a second.
 */
export function ClockDisplay() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer = 0;

    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000));
    };

    tick();
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <time
      dateTime={now.toISOString()}
      aria-label={`Time ${formatTime(now)}`}
      className="font-mono text-[12px] leading-none font-medium tracking-[-0.02em] tabular-nums text-notch-primary"
    >
      {formatTime(now)}
    </time>
  );
}
