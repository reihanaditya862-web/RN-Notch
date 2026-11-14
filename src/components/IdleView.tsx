import { Music } from "lucide-react";
import type { MediaInfo } from "../lib/types";
import { BatteryIndicator } from "./widgets/BatteryIndicator";
import { ClockDisplay } from "./widgets/ClockDisplay";

interface IdleViewProps {
  /** Pass the playing media to get the wider "idle + media" layout. */
  media: MediaInfo | null;
}

/**
 * Content of the collapsed capsule.
 *
 * - No media: clock on the left, battery on the right (180px).
 * - Media playing: music icon and song title, then clock and battery (280px).
 */
export function IdleView({ media }: IdleViewProps) {
  if (!media) {
    return (
      <div className="flex h-full w-full items-center justify-between px-3">
        <ClockDisplay />
        <BatteryIndicator />
      </div>
    );
  }

  const label = media.artist ? `${media.title} - ${media.artist}` : media.title;

  return (
    <div className="flex h-full w-full items-center gap-2 px-3">
      <Music
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
        className="shrink-0 text-notch-playing"
      />
      {/* No `title` tooltip here: hovering expands the capsule, and the tooltip would linger over it. */}
      <span
        aria-label={`Now playing: ${label}`}
        className="min-w-0 flex-1 truncate text-[12px] leading-4 font-medium text-notch-primary"
      >
        {media.title}
      </span>
      <ClockDisplay showSeconds={false} />
      <BatteryIndicator />
    </div>
  );
}
