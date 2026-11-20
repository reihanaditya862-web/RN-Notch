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
}

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
 * A live activity sits just before the clock; the capsule widens for it.
 */
export function IdleView({ media, isDndEnabled, lyric = null, activity = null }: IdleViewProps) {
  const pill = activity ? <LiveActivityPill activity={activity} /> : null;
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
    <div className="flex h-full w-full items-center gap-2 px-3">
      <MediaWaveform isPlaying={media.is_playing} />
      {/* No `title` tooltip here: hovering expands the capsule, and the tooltip would linger over it. */}
      {lyric !== null ? (
        <LyricLine text={lyric} className="text-[12px] leading-4 font-semibold text-notch-primary" />
      ) : (
        <span
          aria-label={`Now playing: ${label}`}
          className="min-w-0 flex-1 truncate font-display text-[12px] leading-4 font-bold text-notch-primary"
        >
          {media.title}
        </span>
      )}
      {pill}
      {clock}
      {battery}
    </div>
  );
}
