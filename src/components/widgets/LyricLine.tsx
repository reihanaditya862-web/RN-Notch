import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/** Marquee speed, px per second, and the pause before it starts. */
const MARQUEE_SPEED = 42;
const MARQUEE_DELAY_S = 0.8;

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
 * One line of lyrics. A new line slides up 6px while the old one fades out
 * (220 ms, transform and opacity only), in step with the capsule's width. An empty line is a pause between verses
 * and shows as a note. With `marquee`, a line too long for its room scrolls
 * across once instead of ending in an ellipsis.
 */
export function LyricLine({
  text,
  className,
  marquee = false,
}: {
  text: string;
  className: string;
  marquee?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const shown = text || "\u266A";
  const scrolls = marquee && !reducedMotion;
  return (
    <span className="relative block min-w-0 flex-1 overflow-hidden" aria-live="off">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={shown}
          initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className={`block ${scrolls ? "whitespace-nowrap" : "truncate"} ${className}`}
        >
          {scrolls ? <MarqueeText text={shown} /> : shown}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
