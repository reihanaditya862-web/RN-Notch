import { useLayoutEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Moon } from "lucide-react";
import type { LiveActivity } from "../hooks/useLiveActivity";
import type { MediaInfo } from "../lib/types";
import { ErrorBoundary } from "./ErrorBoundary";
import { BatteryIndicator } from "./widgets/BatteryIndicator";
import { ClockDisplay } from "./widgets/ClockDisplay";
import { LiveActivityPill } from "./widgets/LiveActivityPill";
import { LyricLine } from "./widgets/LyricLine";
import { MediaWaveform } from "./widgets/MediaWaveform";

interface IdleViewProps {
  /** Pass the playing media to get the wider "idle + media" layout. */
  media: MediaInfo | null;
  /** Do Not Disturb is on: show the purple dot and the moon. */
  isDndEnabled: boolean;
  /** The lyric line being sung; shown instead of the title when not null. */
  lyric?: string | null;
  /** A recording, the focus timer or a routine due soon, shown before the clock. */
  activity?: LiveActivity | null;
  /**
   * Told how much of the capsule's width is not the lyric line while one is
   * sung (padding, the waveform, a live activity), so the capsule can be
   * sized to the line.
   */
  onLyricChrome?: (px: number) => void;
  /** The line is longer than the capsule may grow: it scrolls across once. */
  isLyricMarquee?: boolean;
}

/** The row's side padding and gap (`px-3`, `gap-2`), for the width sums. */
const ROW_PADDING = 12;
const ROW_GAP = 8;

/** Purple dot + moon: the capsule will not open or widen by itself. */
function DndIndicator() {
  return (
    <span
      role="img"
      aria-label="Do Not Disturb is on"
      title="Do Not Disturb"
      className="flex shrink-0 items-center gap-1 text-notch-dnd"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-notch-dnd" />
      <Moon size={12} strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}

/**
 * Content of the collapsed capsule.
 *
 * - No media: clock on the left, battery on the right.
 * - Media playing: waveform and song title, then clock and battery.
 * - A synced lyric line being sung: only the waveform and the line; the
 *   clock and battery fade out and come back for a pause or when it stops.
 * A live activity sits just before the clock; the capsule widens for it.
 */
export function IdleView({
  media,
  isDndEnabled,
  lyric = null,
  activity = null,
  onLyricChrome,
  isLyricMarquee = false,
}: IdleViewProps) {
  const pill = activity ? <LiveActivityPill activity={activity} /> : null;
  const slotRef = useRef<HTMLSpanElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  // A line being sung (not a pause between verses): the capsule focuses on
  // the waveform and the line, and the clock and battery step aside.
  const isLyricFocus = media !== null && Boolean(lyric);

  // Measured when the layout around the line can change, not per frame:
  // the room before the line, the right padding, and a live activity.
  useLayoutEffect(() => {
    if (!isLyricFocus || !onLyricChrome || !slotRef.current) return;
    const pill = pillRef.current ? pillRef.current.offsetWidth + ROW_GAP : 0;
    onLyricChrome(slotRef.current.offsetLeft + ROW_PADDING + pill);
  }, [isLyricFocus, activity?.kind, onLyricChrome]);
  const clock = (
    <ErrorBoundary label="Clock" fallback={null}>
      <ClockDisplay />
    </ErrorBoundary>
  );
  const battery = (
    <ErrorBoundary label="Battery" fallback={null}>
      <BatteryIndicator />
    </ErrorBoundary>
  );

  if (!media) {
    return (
      <div className="flex h-full w-full items-center justify-between px-3">
        <span className="flex items-center gap-2">
          {pill}
          {clock}
        </span>
        <span className="flex items-center gap-2">
          {isDndEnabled && <DndIndicator />}
          {battery}
        </span>
      </div>
    );
  }

  const label = media.artist ? `${media.title} - ${media.artist}` : media.title;

  return (
    <div className="relative flex h-full w-full items-center gap-2 px-3">
      <MediaWaveform isPlaying={media.is_playing} />
      {/* No `title` tooltip here: hovering expands the capsule, and the tooltip would linger over it. */}
      {lyric !== null ? (
        <span ref={slotRef} className="flex min-w-0 flex-1">
          <LyricLine
            text={lyric}
            marquee={isLyricMarquee}
            className="text-[12px] leading-4 font-semibold text-notch-primary"
          />
        </span>
      ) : (
        <span
          aria-label={`Now playing: ${label}`}
          className="min-w-0 flex-1 truncate font-display text-[12px] leading-4 font-bold text-notch-primary"
        >
          {media.title}
        </span>
      )}
      {pill && <span ref={pillRef} className="flex shrink-0">{pill}</span>}
      <AnimatePresence initial={false}>
        {!isLyricFocus && (
          <motion.span
            key="status"
            initial={{ opacity: 0, scale: 0.9, width: 0 }}
            animate={{ opacity: 1, scale: 1, width: "auto" }}
            exit={{ opacity: 0, scale: 0.9, width: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex shrink-0 items-center gap-2 overflow-hidden"
          >
            {clock}
            {battery}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
