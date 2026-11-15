import type { ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { DASHBOARD } from "../lib/layout";
import type { ActiveWidgets, MediaInfo } from "../lib/types";
import { ClockDisplay } from "./widgets/ClockDisplay";
import { FileShelf } from "./widgets/FileShelf";
import { MediaPill } from "./widgets/MediaPill";
import { QuickScratchpad } from "./widgets/QuickScratchpad";
import { SystemHUD } from "./widgets/SystemHUD";

interface ExpandedViewProps {
  /** Which sections to show; switched in Settings. */
  widgets: ActiveWidgets;
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
 * The dashboard shown after clicking the capsule: media player on top, then
 * the hardware monitor, the file shelf and the quick note.
 *
 * Only the active widgets are rendered. The capsule's height follows them
 * (`getDashboardHeight`), and the row heights here come from the same
 * `DASHBOARD` table, so the two cannot drift apart.
 */
export function ExpandedView({
  widgets,
  media,
  mediaPollIntervalMs,
  onPlayPause,
  onNext,
  onPrevious,
  onCollapse,
}: ExpandedViewProps) {
  const hasBody = widgets.system || widgets.file_shelf || widgets.scratchpad;

  // Clock and collapse button: at the end of the media controls, or in a row
  // of their own when the media player is switched off.
  const corner: ReactNode = (
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
  );

  return (
    <div
      className="flex h-full w-full flex-col *:shrink-0"
      style={{ padding: DASHBOARD.padding, gap: DASHBOARD.gap }}
    >
      {widgets.media ? (
        <>
          <div style={{ height: DASHBOARD.media }}>
            <MediaPill
              media={media}
              pollIntervalMs={mediaPollIntervalMs}
              onPlayPause={onPlayPause}
              onNext={onNext}
              onPrevious={onPrevious}
              className="p-0"
              trailing={corner}
            />
          </div>
          <hr className="-mx-3 border-notch-border" />
        </>
      ) : (
        <div className="flex items-center justify-end gap-2" style={{ height: DASHBOARD.header }}>
          {corner}
        </div>
      )}

      {widgets.system && <SystemHUD />}
      {widgets.file_shelf && <FileShelf />}
      {widgets.scratchpad && <QuickScratchpad />}

      {!widgets.media && !hasBody && (
        <p
          className="flex items-center justify-center text-[12px] leading-4 text-notch-tertiary"
          style={{ height: DASHBOARD.empty }}
        >
          All widgets are off. Right-click the capsule and open Settings.
        </p>
      )}
    </div>
  );
}
