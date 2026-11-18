import { useState } from "react";
import { DASHBOARD } from "../../lib/layout";
import type { ActiveWidgets, MediaInfo } from "../../lib/types";
import { ErrorBoundary } from "../ErrorBoundary";
import { AiShortcutRow } from "../widgets/AiDrawer";
import { ClockDisplay } from "../widgets/ClockDisplay";
import { MediaPill } from "../widgets/MediaPill";
import { SystemHUD } from "../widgets/SystemHUD";
import { CollapseButton, PageHeader } from "./PageHeader";

export interface MediaControls {
  media: MediaInfo | null;
  mediaPollIntervalMs: number;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (positionMs: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
}

/**
 * The AI shortcuts under the media controls. Folded to a thin handle until
 * the cursor comes to rest on it, the same gesture as in the pop-up.
 */
function InlineAiDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div
      className="relative h-[30px] shrink-0"
      onPointerEnter={() => setIsOpen(true)}
      onPointerLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false);
      }}
    >
      <span
        aria-hidden="true"
        className={[
          "absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5",
          "text-[10px] leading-3 text-notch-tertiary transition-opacity duration-150",
          isOpen ? "opacity-0" : "opacity-100",
        ].join(" ")}
      >
        <span className="h-[3px] w-6 rounded-full bg-white/15" />
        AI apps
        <span className="h-[3px] w-6 rounded-full bg-white/15" />
      </span>
      <div
        className={[
          "absolute inset-0 flex items-center transition-opacity duration-150",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
      >
        <div className="w-full">
          <AiShortcutRow />
        </div>
      </div>
    </div>
  );
}

/** Page one: the media player with the AI drawer, then the system monitor. */
export function MediaPage({
  widgets,
  controls,
  onCollapse,
}: {
  widgets: ActiveWidgets;
  controls: MediaControls;
  onCollapse: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-1.5">
      {widgets.media ? (
        <>
          <div className="shrink-0" style={{ height: DASHBOARD.media }}>
            <ErrorBoundary label="Media player">
              <MediaPill
                media={controls.media}
                pollIntervalMs={controls.mediaPollIntervalMs}
                onPlayPause={controls.onPlayPause}
                onNext={controls.onNext}
                onPrevious={controls.onPrevious}
                onSeek={controls.onSeek}
                onToggleShuffle={controls.onToggleShuffle}
                onCycleRepeat={controls.onCycleRepeat}
                className="p-0"
                trailing={
                  <>
                    <ClockDisplay />
                    <CollapseButton onCollapse={onCollapse} />
                  </>
                }
              />
            </ErrorBoundary>
          </div>
          <InlineAiDrawer />
        </>
      ) : (
        <PageHeader title="System" onCollapse={onCollapse} />
      )}
      {widgets.system && (
        <>
          <hr className="-mx-3 shrink-0 border-notch-border" />
          <div className="shrink-0 pt-0.5">
            <ErrorBoundary label="System monitor">
              <SystemHUD />
            </ErrorBoundary>
          </div>
        </>
      )}
    </div>
  );
}
