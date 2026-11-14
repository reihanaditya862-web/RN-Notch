import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Music, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { MediaInfo } from "../../lib/types";

interface MediaPillProps {
  /** The active session, or null to show the "nothing playing" state. */
  media: MediaInfo | null;
  /** Time between media polls; the progress bar glides over this duration. */
  pollIntervalMs: number;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  /** Rendered at the right end of the control row (clock, battery). */
  trailing?: ReactNode;
  /** Padding classes; override when the pill is embedded in a padded layout. */
  className?: string;
}

/** Formats milliseconds as m:ss, or h:mm:ss for an hour and longer. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

interface TruncatedTextProps {
  text: string;
  className: string;
}

/** One line of text with an ellipsis; the full text is a tooltip only when it is actually cut off. */
function TruncatedText({ text, className }: TruncatedTextProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [isCut, setIsCut] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element) setIsCut(element.scrollWidth > element.clientWidth);
  }, [text]);

  return (
    <p ref={ref} title={isCut ? text : undefined} className={`truncate ${className}`}>
      {text}
    </p>
  );
}

interface ControlButtonProps {
  label: string;
  onClick: () => void;
  disabled: boolean;
  emphasized?: boolean;
  children: ReactNode;
}

function ControlButton({ label, onClick, disabled, emphasized, children }: ControlButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex h-6 w-6 items-center justify-center rounded-md",
        "transition-[color,scale] duration-100 hover:scale-110 active:scale-95",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
        "disabled:pointer-events-none disabled:opacity-35",
        emphasized ? "text-notch-primary" : "text-notch-secondary hover:text-notch-primary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Expanded media player: cover art, title, artist, a thin progress bar and
 * the previous / play-pause / next controls.
 */
export function MediaPill({
  media,
  pollIntervalMs,
  onPlayPause,
  onNext,
  onPrevious,
  trailing,
  className = "px-3 py-2.5",
}: MediaPillProps) {
  const hasMedia = media !== null;
  const hasTimeline = hasMedia && media.duration_ms > 0;
  const progress = hasTimeline ? Math.min(1, media.position_ms / media.duration_ms) : 0;
  const trackKey = hasMedia ? `${media.source}|${media.title}|${media.artist}` : "none";

  return (
    <div className={`flex h-full w-full flex-col justify-between ${className}`}>
      {/* Cover art, title and artist */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-notch-surface">
          <Music size={16} strokeWidth={1.5} aria-hidden="true" className="text-notch-tertiary" />
          <AnimatePresence initial={false}>
            {media?.album_art_url && (
              <motion.img
                key={media.album_art_id ?? media.album_art_url}
                src={media.album_art_url}
                alt=""
                draggable={false}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
          </AnimatePresence>
        </div>

        <div className="min-w-0 flex-1">
          <TruncatedText
            text={hasMedia ? media.title : "Nothing playing"}
            className="text-[13px] leading-[18px] font-medium text-notch-primary"
          />
          <TruncatedText
            text={
              hasMedia ? media.artist || media.source : "Play something in Spotify or your browser"
            }
            className="text-[12px] leading-4 text-notch-secondary"
          />
        </div>

        {hasMedia && media.artist && (
          <span className="shrink-0 self-start text-[10px] leading-[18px] font-medium text-notch-tertiary">
            {media.source}
          </span>
        )}
      </div>

      {/* Progress */}
      <div
        role="progressbar"
        aria-label="Playback progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="h-[3px] w-full overflow-hidden rounded-full bg-white/10"
      >
        <div
          key={trackKey}
          className="h-full w-full origin-left bg-notch-primary/80"
          style={{
            transform: `scaleX(${progress})`,
            transition: media?.is_playing ? `transform ${pollIntervalMs}ms linear` : "none",
          }}
        />
      </div>

      {/* Time, transport controls, trailing widgets */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <span className="font-mono text-[10px] leading-none font-medium tracking-[-0.02em] tabular-nums text-notch-tertiary">
          {hasTimeline
            ? `${formatDuration(media.position_ms)} / ${formatDuration(media.duration_ms)}`
            : ""}
        </span>

        <div className="flex items-center gap-2">
          <ControlButton label="Previous track" onClick={onPrevious} disabled={!hasMedia}>
            <SkipBack size={16} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
          </ControlButton>
          <ControlButton
            label={media?.is_playing ? "Pause" : "Play"}
            onClick={onPlayPause}
            disabled={!hasMedia}
            emphasized
          >
            {media?.is_playing ? (
              <Pause size={16} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={16} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
            )}
          </ControlButton>
          <ControlButton label="Next track" onClick={onNext} disabled={!hasMedia}>
            <SkipForward size={16} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
          </ControlButton>
        </div>

        <div className="flex items-center justify-end gap-2">{trailing}</div>
      </div>
    </div>
  );
}
