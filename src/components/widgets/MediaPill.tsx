import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { MediaInfo, RepeatMode } from "../../lib/types";
import { DigitText } from "./DigitText";
import { LyricLine } from "./LyricLine";
import { MediaSeekbar, formatDuration } from "./MediaSeekbar";

interface MediaPillProps {
  /** The active session, or null to show the "nothing playing" state. */
  media: MediaInfo | null;
  /** Time between media polls; the progress bar glides over this duration. */
  pollIntervalMs: number;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (positionMs: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  /** Rendered at the right end of the control row (clock, battery). */
  trailing?: ReactNode;
  /** The lyric line being sung; replaces the artist line when not null. */
  lyric?: string | null;
  /** Padding classes; override when the pill is embedded in a padded layout. */
  className?: string;
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
  /** A toggle (shuffle, repeat): shown in the cover's colour with a dot while on. */
  pressed?: boolean;
  /** Narrower button for the secondary controls. */
  compact?: boolean;
  /** Shown faded: the app does not offer it (a click explains why). */
  muted?: boolean;
  children: ReactNode;
}

function ControlButton({
  label,
  onClick,
  disabled,
  emphasized,
  pressed,
  compact,
  muted,
  children,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      style={pressed ? { color: "var(--notch-accent-light, #ffffff)" } : undefined}
      className={[
        "relative flex h-6 items-center justify-center rounded-md",
        compact ? "w-5" : "w-6",
        "transition-[color,scale] duration-100 hover:scale-110 active:scale-95",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
        "disabled:pointer-events-none disabled:opacity-35",
        emphasized ? "text-notch-primary" : "text-notch-secondary hover:text-notch-primary",
        muted ? "opacity-40 hover:opacity-70" : "",
      ].join(" ")}
    >
      {children}
      {pressed && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-current"
        />
      )}
    </button>
  );
}

const REPEAT_LABELS: Record<RepeatMode, string> = {
  none: "Repeat: off",
  list: "Repeat: all",
  track: "Repeat: one",
};

/**
 * Expanded media player: cover art, title, artist, the seek bar (in the
 * style chosen in Settings) and the previous / play-pause / next controls.
 */
export function MediaPill({
  media,
  pollIntervalMs,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onToggleShuffle,
  onCycleRepeat,
  trailing,
  lyric = null,
  className = "px-3 py-2.5",
}: MediaPillProps) {
  const hasMedia = media !== null;
  const hasTimeline = hasMedia && media.duration_ms > 0;
  const shuffle = media?.shuffle ?? null;
  const repeat = media?.repeat ?? null;
  const timeline = hasTimeline
    ? `${formatDuration(media.position_ms)} / ${formatDuration(media.duration_ms)}`
    : "";

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
            className="font-display text-[13px] leading-[18px] font-bold text-notch-primary"
          />
          {lyric !== null ? (
            <LyricLine text={lyric} height={16} className="text-[12px] leading-4 font-medium text-notch-primary/85" />
          ) : (
            <TruncatedText
              text={
                hasMedia ? media.artist || media.source : "Play something in Spotify or your browser"
              }
              className="text-[12px] leading-4 text-notch-secondary"
            />
          )}
        </div>

        {hasMedia && media.artist && (
          <span className="shrink-0 self-start text-[10px] leading-[18px] font-medium text-notch-tertiary">
            {media.source}
          </span>
        )}
      </div>

      {/* Position, seek bar, length: the times live with the bar, so the
          control row keeps its room however long the track is. */}
      <div className="flex items-center gap-2">
        {hasTimeline && (
          <span
            aria-label={`Playback position ${timeline}`}
            className="shrink-0 font-display text-[9px] leading-none font-bold text-notch-tertiary"
          >
            <DigitText text={formatDuration(media.position_ms)} />
          </span>
        )}
        <MediaSeekbar media={media} pollIntervalMs={pollIntervalMs} onSeek={onSeek} />
        {hasTimeline && (
          <span aria-hidden="true" className="shrink-0 font-display text-[9px] leading-none font-bold text-notch-tertiary">
            <DigitText text={formatDuration(media.duration_ms)} />
          </span>
        )}
      </div>

      {/* Transport controls on the left, trailing widgets on the right */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <ControlButton
            label={
              shuffle === null
                ? `Shuffle (${media?.source ?? "this app"} keeps it to itself)`
                : `Shuffle: ${shuffle ? "on" : "off"}`
            }
            onClick={onToggleShuffle}
            disabled={!hasMedia}
            pressed={shuffle === true}
            muted={shuffle === null}
            compact
          >
            <Shuffle size={13} strokeWidth={1.75} aria-hidden="true" />
          </ControlButton>
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
          <ControlButton
            label={
              repeat === null
                ? "Repeat"
                : media?.repeat_local
                  ? repeat === "track"
                    ? "Repeat one (looped by RN Notch)"
                    : "Repeat: off (RN Notch can loop this track)"
                  : REPEAT_LABELS[repeat]
            }
            onClick={onCycleRepeat}
            disabled={!hasMedia}
            pressed={repeat !== null && repeat !== "none"}
            compact
          >
            {repeat === "track" ? (
              <Repeat1 size={13} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Repeat size={13} strokeWidth={1.75} aria-hidden="true" />
            )}
          </ControlButton>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">{trailing}</div>
      </div>
    </div>
  );
}
