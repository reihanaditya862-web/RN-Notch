import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/** Marquee speed, px per second, and the pause before it starts. */
const MARQUEE_SPEED = 42;
const MARQUEE_DELAY_S = 0.8;

/** The roll between lines: how far a line travels, and the curve. */
const ROLL_DISTANCE = 14;
const ROLL = { duration: 0.28, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * A line longer than its room slides across once, start to end, then stays
 * (a transform transition: compositor work). A new line starts over.
 */
function MarqueeText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    const room = element?.parentElement?.clientWidth ?? 0;
    setShift(element ? Math.max(0, element.scrollWidth - room) : 0);
  }, [text]);
  return (
    <span
      ref={ref}
      className="inline-block"
      style={{
        transform: `translate3d(${-shift}px, 0, 0)`,
        transition: shift
          ? `transform ${Math.max(1.2, shift / MARQUEE_SPEED)}s cubic-bezier(0.45, 0, 0.55, 1) ${MARQUEE_DELAY_S}s`
          : "none",
      }}
    >
      {text}
    </span>
  );
}

/**
 * One line of lyrics in a fixed-height window. A new line rolls in from
 * below like a slot machine while the old one rolls out the top (14 px,
 * scale 0.96, fading; 280 ms, transform and opacity only). Nothing moves
 * between lines, during a pause or while the song is paused. An empty line
 * is a pause between verses and shows as a note. With `marquee`, a line too
 * long for its room scrolls across once instead of ending in an ellipsis.
 */
export function LyricLine({
  text,
  className,
  marquee = false,
  height = 20,
}: {
  text: string;
  className: string;
  marquee?: boolean;
  /** Height of the window the line rolls through, in px. */
  height?: number;
}) {
  const reducedMotion = useReducedMotion();
  const shown = text || "\u266A";
  const scrolls = marquee && !reducedMotion;
  const distance = reducedMotion ? 0 : ROLL_DISTANCE;
  const scale = reducedMotion ? 1 : 0.96;
  return (
    <span
      className="relative inline-flex min-w-0 flex-1 items-center overflow-hidden"
      style={{ height }}
      aria-live="off"
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={shown}
          initial={{ opacity: 0, y: distance, scale }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -distance, scale }}
          transition={ROLL}
          style={{ transformOrigin: "0% 50%" }}
          className={`block min-w-0 ${scrolls ? "whitespace-nowrap" : "truncate"} ${className}`}
        >
          {scrolls ? <MarqueeText text={shown} /> : shown}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
