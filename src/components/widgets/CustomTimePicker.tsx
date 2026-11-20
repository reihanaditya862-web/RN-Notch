import { type KeyboardEvent, type WheelEvent, useEffect, useId, useRef, useState } from "react";
import { Check } from "lucide-react";
import { FOCUS_RING } from "../pages/PageHeader";
import { DigitText } from "./DigitText";

/** Rows shown in each drum: the value in the middle, two either side. */
const DRUM_REACH = 2;
const ROW_HEIGHT = 22;

const QUICK_TIMES = ["08:00", "13:00", "20:00"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parse(time: string): { hours: number; minutes: number } {
  const [hours, minutes] = time.split(":").map(Number);
  return {
    hours: Number.isInteger(hours) ? Math.min(23, Math.max(0, hours)) : 0,
    minutes: Number.isInteger(minutes) ? Math.min(59, Math.max(0, minutes)) : 0,
  };
}

function format(hours: number, minutes: number): string {
  return `${pad(hours)}:${pad(minutes)}`;
}

/** "HH:MM" this many minutes from now. */
function fromNow(minutes: number): string {
  const at = new Date(Date.now() + minutes * 60_000);
  return format(at.getHours(), at.getMinutes());
}

/**
 * One wheel of the picker (hours or minutes). It does not scroll natively:
 * the mouse wheel and the arrow keys step the value, a click on a row picks
 * it, and the values wrap around (23 is next to 00).
 */
function Drum({
  label,
  value,
  count,
  onChange,
}: {
  label: string;
  value: number;
  count: number;
  onChange: (value: number) => void;
}) {
  const wheel = useRef(0);
  const step = (by: number) => onChange((((value + by) % count) + count) % count);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    // The dashboard turns pages on the wheel; inside the picker it turns the drum.
    event.stopPropagation();
    wheel.current += event.deltaY;
    if (Math.abs(wheel.current) < 40) return;
    step(Math.sign(wheel.current));
    wheel.current = 0;
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
    if (event.key in moves) {
      event.preventDefault();
      step(moves[event.key]);
    }
  };

  const rows = Array.from({ length: DRUM_REACH * 2 + 1 }, (_, index) => index - DRUM_REACH);

  return (
    <div
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={count - 1}
      aria-valuenow={value}
      aria-valuetext={pad(value)}
      onWheel={handleWheel}
      onKeyDown={handleKey}
      className={`relative w-11 rounded-[10px] ${FOCUS_RING}`}
      style={{ height: ROW_HEIGHT * rows.length }}
    >
      {/* The pill behind the chosen value. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 rounded-lg border border-white/20 bg-white/12 shadow-[0_0_10px_rgb(255_255_255/0.08)]"
        style={{ top: ROW_HEIGHT * DRUM_REACH, height: ROW_HEIGHT }}
      />
      {rows.map((offset) => {
        const row = (((value + offset) % count) + count) % count;
        const distance = Math.abs(offset);
        return (
          <button
            key={offset}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => onChange(row)}
            className="relative flex w-full items-center justify-center font-display leading-none font-bold text-notch-primary"
            style={{
              height: ROW_HEIGHT,
              fontSize: distance === 0 ? 14 : 12,
              opacity: distance === 0 ? 1 : distance === 1 ? 0.45 : 0.2,
            }}
          >
            <DigitText text={pad(row)} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Time field for the daily schedule, replacing the browser's `<input
 * type="time">` and its light, system-styled pop-up that the window cut off.
 *
 * The button shows the time in Formula1; it opens a dark glass popover above
 * itself, inside the panel, with an hours drum and a minutes drum and quick
 * picks (now, in 15 or 30 minutes, morning, midday, evening). Every change
 * applies at once; the tick, Escape or a click elsewhere closes it.
 */
export function CustomTimePicker({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const { hours, minutes } = parse(value);

  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setIsOpen(false);
    };
    window.addEventListener("pointerdown", closeOutside);
    return () => window.removeEventListener("pointerdown", closeOutside);
  }, [isOpen]);

  const chips: Array<{ label: string; time: () => string }> = [
    { label: "Now", time: () => fromNow(0) },
    { label: "+15m", time: () => fromNow(15) },
    { label: "+30m", time: () => fromNow(30) },
    ...QUICK_TIMES.map((time) => ({ label: time, time: () => time })),
  ];

  return (
    <div
      ref={root}
      className="relative shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          event.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={`Time ${value}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        className={[
          "flex h-7 w-[68px] items-center justify-center rounded-lg font-display text-[12px] leading-none font-bold text-notch-primary transition-colors duration-100",
          FOCUS_RING,
          isOpen ? "bg-notch-surface-hover" : "bg-notch-surface hover:bg-notch-surface-hover",
        ].join(" ")}
      >
        <DigitText text={format(hours, minutes)} />
      </button>

      {isOpen && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Choose a time"
          className="notch-blur absolute bottom-full left-0 z-30 mb-2 flex gap-3 rounded-[14px] border border-white/14 bg-[rgb(14_14_18/0.96)] p-2.5 shadow-[0_10px_28px_rgb(0_0_0/0.55)] backdrop-blur-[16px]"
        >
          <div className="flex items-center gap-1">
            <Drum label="Hours" value={hours} count={24} onChange={(next) => onChange(format(next, minutes))} />
            <span
              aria-hidden="true"
              className="font-mono text-[15px] leading-none font-bold text-notch-primary [text-shadow:0_0_8px_rgb(255_255_255/0.65)]"
            >
              :
            </span>
            <Drum label="Minutes" value={minutes} count={60} onChange={(next) => onChange(format(hours, next))} />
          </div>

          <div className="flex w-[104px] flex-col justify-between">
            <div role="group" aria-label="Quick times" className="grid grid-cols-2 gap-1.5">
              {chips.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => onChange(chip.time())}
                  className={`h-[22px] rounded-md bg-notch-surface font-display text-[10px] leading-none font-bold text-notch-secondary transition-colors duration-100 hover:bg-notch-surface-hover hover:text-notch-primary ${FOCUS_RING}`}
                >
                  <DigitText text={chip.label} />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Done"
              title="Done"
              className={`flex h-[26px] w-full items-center justify-center rounded-md bg-notch-primary text-black ${FOCUS_RING}`}
            >
              <Check size={14} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
