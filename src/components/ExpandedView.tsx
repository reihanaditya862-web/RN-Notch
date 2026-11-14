import { ChevronUp } from "lucide-react";
import type { MediaInfo } from "../lib/types";
import { ClockDisplay } from "./widgets/ClockDisplay";
import { FileShelf } from "./widgets/FileShelf";
import { MediaPill } from "./widgets/MediaPill";
import { QuickScratchpad } from "./widgets/QuickScratchpad";
import { SystemHUD } from "./widgets/SystemHUD";

interface ExpandedViewProps {
  media: MediaInfo | null;
  /** Time between media polls; passed on to the progress bar. */
  mediaPollIntervalMs: number;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  /** Closes the dashboard. */
  onCollapse: () => void;
}

/**
 * The dashboard shown after clicking the capsule (420x280): media player on
 * top, then the hardware monitor, the file shelf and the quick note.
 */
export function ExpandedView({
  media,
  mediaPollIntervalMs,
  onPlayPause,
  onNext,
  onPrevious,
  onCollapse,
}: ExpandedViewProps) {
  return (
    <div className="flex h-full w-full flex-col gap-2.5 p-3">
      <div className="h-[74px] shrink-0">
        <MediaPill
          media={media}
          pollIntervalMs={mediaPollIntervalMs}
          onPlayPause={onPlayPause}
          onNext={onNext}
          onPrevious={onPrevious}
          className="p-0"
          trailing={
            <>
              <ClockDisplay showSeconds={false} />
              <button
                type="button"
                onClick={onCollapse}
                aria-label="Collapse"
                title="Collapse (Esc)"
                className={[
                  "flex h-5 w-5 items-center justify-center rounded-md text-notch-secondary",
                  "transition-[color,scale] duration-100 hover:scale-110 hover:text-notch-primary active:scale-95",
                  "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
                ].join(" ")}
              >
                <ChevronUp size={16} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </>
          }
        />
      </div>

      <hr className="-mx-3 shrink-0 border-notch-border" />

      <SystemHUD />
      <FileShelf />
      <QuickScratchpad />
    </div>
  );
}
