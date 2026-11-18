import { useEffect, useState } from "react";
import { DigitText } from "./DigitText";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The time as 24-hour "HH:mm" (no seconds, no AM/PM) in the Formula1 display
 * face. Shown in every state of the capsule, music or not. `DigitText` gives
 * every digit the same width, so the time does not shift when it changes.
 *
 * Each tick is scheduled for the next minute boundary instead of a fixed
 * interval, so the display never drifts or skips a minute.
 */
export function ClockDisplay() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  const text = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  return (
    <time
      dateTime={now.toISOString()}
      aria-label={`Time ${text}`}
      className="flex shrink-0 font-display text-[12px] leading-none font-bold text-notch-primary"
    >
      <DigitText text={text} />
    </time>
  );
}
