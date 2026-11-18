import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/**
 * One line of lyrics. A new line slides up while the old one fades out
 * (transform and opacity only). An empty line is a pause between verses
 * and shows as a note.
 */
export function LyricLine({ text, className }: { text: string; className: string }) {
  const reducedMotion = useReducedMotion();
  const shown = text || "♪";
  return (
    <span className="relative block min-w-0 flex-1 overflow-hidden" aria-live="off">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={shown}
          initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className={`block truncate ${className}`}
        >
          {shown}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
