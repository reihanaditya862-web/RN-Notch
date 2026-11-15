import { Moon } from "lucide-react";
import type { MediaInfo } from "../lib/types";
import { ErrorBoundary } from "./ErrorBoundary";
import { BatteryIndicator } from "./widgets/BatteryIndicator";
import { ClockDisplay } from "./widgets/ClockDisplay";
import { MediaWaveform } from "./widgets/MediaWaveform";

interface IdleViewProps {
  /** Pass the playing media to get the wider "idle + media" layout. */
  media: MediaInfo | null;
  /** Do Not Disturb is on: show the purple dot and the moon. */
  isDndEnabled: boolean;
  /** The capsule is in its low, compact shape: use the smaller type. */
  isCompact: boolean;
}

/** Purple dot + moon: the capsule will not open or widen by itself. */
function DndIndicator({ isCompact }: { isCompact: boolean }) {
  return (
    <span
      role="img"
      aria-label="Do Not Disturb is on"
      title="Do Not Disturb"
      className="flex shrink-0 items-center gap-1 text-notch-dnd"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-notch-dnd" />
      <Moon size={isCompact ? 10 : 12} strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}

/**
 * Content of the collapsed capsule.
 *
 * - No media: clock on the left, battery on the right.
 * - Media playing: waveform and song title, then clock and battery.
 */
export function IdleView({ media, isDndEnabled, isCompact }: IdleViewProps) {
  const clock = (
    <ErrorBoundary label="Clock" fallback={null}>
      <ClockDisplay showSeconds={!media} isCompact={isCompact} />
    </ErrorBoundary>
  );
  const battery = (
    <ErrorBoundary label="Battery" fallback={null}>
      <BatteryIndicator isCompact={isCompact} />
    </ErrorBoundary>
  );

  if (!media) {
    return (
      <div className="flex h-full w-full items-center justify-between px-3">
        {clock}
        <span className="flex items-center gap-2">
          {isDndEnabled && <DndIndicator isCompact={isCompact} />}
          {battery}
        </span>
      </div>
    );
  }

  const label = media.artist ? `${media.title} - ${media.artist}` : media.title;

  return (
    <div className="flex h-full w-full items-center gap-2 px-3">
      <MediaWaveform isPlaying={media.is_playing} size={isCompact ? 10 : 14} />
      {/* No `title` tooltip here: hovering expands the capsule, and the tooltip would linger over it. */}
      <span
        aria-label={`Now playing: ${label}`}
        className={[
          "min-w-0 flex-1 truncate font-display font-bold text-notch-primary",
          isCompact ? "text-[10px] leading-3" : "text-[12px] leading-4",
        ].join(" ")}
      >
        {media.title}
      </span>
      {clock}
      {battery}
    </div>
  );
}
