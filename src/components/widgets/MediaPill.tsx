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
  /** A toggle (shuffle, repeat): shown in the cover's colour with a dot while on. */
  pressed?: boolean;
  /** Narrower button for the secondary controls. */
  compact?: boolean;
  children: ReactNode;
}

function ControlButton({
  label,
  onClick,
  disabled,
  emphasized,
  pressed,
  compact,
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
      style={pressed ? { color: "var(--notch-accent-light, var(--notch-gradient-to))" } : undefined}
      className={[
        "relative flex h-6 items-center justify-center rounded-md",
        compact ? "w-5" : "w-6",
        "transition-[color,scale] duration-100 hover:scale-110 active:scale-95",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
        "disabled:pointer-events-none disabled:opacity-35",
        emphasized ? "text-notch-primary" : "text-notch-secondary hover:text-notch-primary",
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

const SEEK_STEP_MS = 5000;

const ACCENT_GRADIENT =
  "linear-gradient(90deg, var(--notch-accent, var(--notch-gradient-deep-from)), var(--notch-accent-light, var(--notch-gradient-deep-to)))";

interface SeekBarProps {
  media: MediaInfo | null;
  pollIntervalMs: number;
  onSeek: (positionMs: number) => void;
}

/**
 * Thin progress bar in the cover's colour. Where the app allows it, a click or
 * drag jumps to that point and the arrow keys step 5 seconds back or ahead.
 * The hit area is taller than the 3px line so it is easy to grab.
 */
function SeekBar({ media, pollIntervalMs, onSeek }: SeekBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const duration = media?.duration_ms ?? 0;
  const canSeek = Boolean(media?.can_seek) && duration > 0;
  const progress = duration > 0 ? Math.min(1, (media?.position_ms ?? 0) / duration) : 0;
  const shown = dragFraction ?? progress;
  const trackKey = media ? `${media.source}|${media.title}|${media.artist}` : "none";
  const glide =
    media?.is_playing && dragFraction === null ? `${pollIntervalMs}ms linear` : null;

  const fractionAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const dragTo = (fraction: number) => {
    dragRef.current = fraction;
    setDragFraction(fraction);
  };
  const finishDrag = () => {
    const fraction = dragRef.current;
    if (fraction === null) return;
    dragRef.current = null;
    setDragFraction(null);
    onSeek(fraction * duration);
  };

  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration / 1000)}
      aria-valuenow={Math.round((shown * duration) / 1000)}
      aria-valuetext={formatDuration(shown * duration)}
      aria-disabled={!canSeek}
      tabIndex={canSeek ? 0 : -1}
      onPointerDown={(event) => {
        if (!canSeek || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragTo(fractionAt(event.clientX));
      }}
      onPointerMove={(event) => {
        if (dragRef.current !== null) dragTo(fractionAt(event.clientX));
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowRight" ? SEEK_STEP_MS : event.key === "ArrowLeft" ? -SEEK_STEP_MS : 0;
        if (!canSeek || !media || step === 0) return;
        event.preventDefault();
        onSeek(media.position_ms + step);
      }}
      className={[
        "group relative -my-1.5 flex h-[15px] w-full touch-none items-center rounded-full",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
        canSeek ? "cursor-pointer" : "",
      ].join(" ")}
    >
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
        {/*
          The gradient lives on a full-width layer and is revealed by clipping
          rather than scaling, so its colours stay put while the bar grows.
        */}
        <div
          key={trackKey}
          className="h-full w-full"
          style={{
            background: ACCENT_GRADIENT,
            clipPath: `inset(0 ${(1 - shown) * 100}% 0 0)`,
            transition: glide ? `clip-path ${glide}` : "none",
          }}
        />
      </div>
      {canSeek && (
        <span
          aria-hidden="true"
          className={[
            "pointer-events-none absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full",
            "shadow-[0_0_6px_rgb(0_0_0/0.5)] transition-opacity duration-150",
            dragFraction !== null
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          ].join(" ")}
          style={{
            left: `${shown * 100}%`,
            background: "var(--notch-accent-light, #fff)",
            transition: glide ? `left ${glide}, opacity 150ms ease` : undefined,
          }}
        />
      )}
    </div>
  );
}

const REPEAT_LABELS: Record<RepeatMode, string> = {
  none: "Repeat: off",
  list: "Repeat: all",
  track: "Repeat: one",
};

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
  onSeek,
  onToggleShuffle,
  onCycleRepeat,
  trailing,
  className = "px-3 py-2.5",
}: MediaPillProps) {
  const hasMedia = media !== null;
  const hasTimeline = hasMedia && media.duration_ms > 0;
  const shuffle = media?.shuffle ?? null;
  const repeat = media?.repeat ?? null;
  const timeline = hasTimeline
    ? `${formatDuration(media.position_ms)} / ${formatDuration(media.duration_ms)}`
    : "";
  // "1:03:59 / 1:25:27" does not fit beside five buttons; long tracks show the position only.
  const shownTime =
    hasTimeline && media.duration_ms >= 3_600_000 ? formatDuration(media.position_ms) : timeline;

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

      <SeekBar media={media} pollIntervalMs={pollIntervalMs} onSeek={onSeek} />

      {/* Time, transport controls, trailing widgets */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
        <span
          aria-label={hasTimeline ? `Playback position ${timeline}` : undefined}
          title={shownTime !== timeline ? timeline : undefined}
          className="font-display text-[10px] leading-none font-bold whitespace-nowrap text-notch-tertiary"
        >
          {hasTimeline && <DigitText text={shownTime} />}
        </span>

        <div className="flex items-center justify-center gap-1">
          <ControlButton
            label={shuffle === null ? "Shuffle (not offered by this app)" : `Shuffle: ${shuffle ? "on" : "off"}`}
            onClick={onToggleShuffle}
            disabled={shuffle === null}
            pressed={shuffle === true}
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
            label={repeat === null ? "Repeat (not offered by this app)" : REPEAT_LABELS[repeat]}
            onClick={onCycleRepeat}
            disabled={repeat === null}
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

        <div className="flex items-center justify-end gap-2">{trailing}</div>
      </div>
    </div>
  );
}
