import { type CSSProperties, type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import type { MediaInfo, SeekbarStyle } from "../../lib/types";
import { useNotchStore } from "../../stores/notchStore";

const SEEK_STEP_MS = 5000;
/** Height of the bar's box (the hit area); everything is centred in it. */
const HEIGHT = 16;
const MID = HEIGHT / 2;

const ACCENT_GRADIENT =
  "linear-gradient(90deg, var(--notch-accent-1, #ffffff), var(--notch-accent-2, #ffffff), var(--notch-accent-3, #ffffff))";

interface StyleSpec {
  /** Thickness of the part already played, in px. */
  played: number;
  /** Thickness of the part still to play. */
  rest: number;
  /** Room left between the played part, the thumb and the rest. */
  gap: number;
  /** The played part as a sine wave: wavelength and height in px, seconds per wavelength. */
  wave: { length: number; amplitude: number; periodS: number } | null;
  thumb: { width: number; height: number } | null;
  /** A small dot marking the end of the track. */
  endDot: boolean;
}

/** Exported for the previews in Settings. */
export const SEEKBAR_STYLES: Record<SeekbarStyle, StyleSpec> = {
  // A thick capsule, a thin upright divider at the position, a thin rest.
  standard: { played: 8, rest: 4, gap: 3, wave: null, thumb: { width: 2.5, height: 16 }, endDot: true },
  // Material You's squiggle up to a round thumb.
  wave: {
    played: 3,
    rest: 3,
    gap: 3,
    wave: { length: 14, amplitude: 2.6, periodS: 1.1 },
    thumb: { width: 10, height: 10 },
    endDot: true,
  },
  // One thin line and no thumb.
  slim: { played: 4, rest: 4, gap: 0, wave: null, thumb: null, endDot: false },
  // A wide, gentle wave up to a short upright bar.
  wavy: {
    played: 2.5,
    rest: 2.5,
    gap: 3,
    wave: { length: 26, amplitude: 4, periodS: 2 },
    thumb: { width: 3.5, height: 14 },
    endDot: false,
  },
};

/** A sine wave as quadratic arcs, from x = 0 to past `length`, centred on MID. */
export function squigglePath(length: number, wavelength: number, amplitude: number, mid = MID): string {
  const half = wavelength / 2;
  const round = (value: number) => Math.round(value * 100) / 100;
  let path = `M0 ${round(mid)} Q${round(half / 2)} ${round(mid - 2 * amplitude)} ${round(half)} ${round(mid)}`;
  for (let x = wavelength; x <= length + half; x += half) path += ` T${round(x)} ${round(mid)}`;
  return path;
}

/** Formats milliseconds as m:ss, or h:mm:ss for an hour and longer. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Width of an element in px, kept current with a ResizeObserver. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The played part as a moving wave. The SVG is one wavelength wider than the
 * bar and slides right by exactly one wavelength on a loop, so the wave flows
 * toward the thumb; that slide is a `translate3d` on the SVG element itself
 * (`notch-squiggle-*` in globals.css), which the compositor runs without
 * repainting. Paused, the wave flattens
 * into a straight line (its group scales to nothing vertically, while
 * `non-scaling-stroke` keeps the line's thickness) and the slide holds still.
 */
function PlayedWave({
  name,
  width,
  spec,
  isPlaying,
  fill,
}: {
  name: SeekbarStyle;
  width: number;
  spec: StyleSpec;
  isPlaying: boolean;
  fill: string;
}) {
  const gradientId = useId();
  const wave = spec.wave;
  if (!wave) return null;
  // Only "paused" is set here: while playing, the stylesheet's own pause rules
  // (capsule hidden or retracted) must still be able to hold it.
  const svgStyle: CSSProperties = {
    left: -wave.length,
    animationPlayState: isPlaying ? undefined : "paused",
  };
  return (
    <svg
      width={width + wave.length}
      height={HEIGHT}
      aria-hidden="true"
      className={`notch-squiggle notch-squiggle-${name} absolute top-0 overflow-visible`}
      style={svgStyle}
    >
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={wave.length} x2={width + wave.length}>
          {fill === "accent" ? (
            <>
              <stop offset="0" style={{ stopColor: "var(--notch-accent-1, #ffffff)" }} />
              <stop offset="0.5" style={{ stopColor: "var(--notch-accent-2, #ffffff)" }} />
              <stop offset="1" style={{ stopColor: "var(--notch-accent-3, #ffffff)" }} />
            </>
          ) : (
            <stop offset="0" stopColor={fill} />
          )}
        </linearGradient>
      </defs>
      <g
        style={{
          transform: `scaleY(${isPlaying ? 1 : 0.001})`,
          transformOrigin: `0px ${MID}px`,
          transition: "transform 450ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <path
          d={squigglePath(width + wave.length, wave.length, wave.amplitude)}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={spec.played}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </g>
    </svg>
  );
}

interface MediaSeekbarProps {
  media: MediaInfo | null;
  /** Time between media polls; the bar glides over this duration. */
  pollIntervalMs: number;
  onSeek: (positionMs: number) => void;
}

/**
 * The media player's seek bar, in the style chosen in Settings (standard,
 * wave, slim or wavy). The played part takes the cover's colours, or plain
 * white when the inner glow is switched off.
 *
 * Where the app allows it, a click or a drag anywhere on the bar jumps to
 * that point and the arrow keys step 5 seconds back or ahead. The bar glides
 * between media polls; only the wave styles have a looping animation, and it
 * stops while the song is paused (and with the rest of the capsule's loops,
 * see globals.css).
 */
export function MediaSeekbar({ media, pollIntervalMs, onSeek }: MediaSeekbarProps) {
  const style = useNotchStore((store) => store.settings.seekbar_style);
  const isColourful = useNotchStore((store) => store.settings.inner_gradient_enabled);
  const spec = SEEKBAR_STYLES[style] ?? SEEKBAR_STYLES.wave;

  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const width = useWidth(barRef);

  const duration = media?.duration_ms ?? 0;
  const canSeek = Boolean(media?.can_seek) && duration > 0;
  const isPlaying = media?.is_playing ?? false;
  const progress = duration > 0 ? Math.min(1, (media?.position_ms ?? 0) / duration) : 0;
  const shown = dragFraction ?? progress;
  const trackKey = media ? `${media.source}|${media.title}|${media.artist}` : "none";
  const glide = isPlaying && dragFraction === null ? `${pollIntervalMs}ms linear` : null;

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

  // Geometry in px. The played part stops short of the thumb, and the rest
  // starts a little after it, so the thumb stands free (Material style).
  const x = shown * width;
  const thumbHalf = spec.thumb ? spec.thumb.width / 2 : 0;
  const playedEnd = Math.max(0, x - (spec.thumb ? thumbHalf + spec.gap : 0));
  const restStart = Math.min(width, x + (spec.thumb ? thumbHalf + spec.gap : 0));
  const playedFill = isColourful ? ACCENT_GRADIENT : "#ffffff";
  const thumbColour = isColourful ? "var(--notch-accent-light, #ffffff)" : "#ffffff";
  const transition = (property: string) => (glide ? `${property} ${glide}` : "none");

  const playedClip = `inset(0 ${Math.max(0, width - playedEnd)}px 0 0 round ${spec.played / 2}px)`;
  const restClip = `inset(0 0 0 ${restStart}px round ${spec.rest / 2}px)`;

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
      data-seekbar-style={style}
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
        const step = event.key === "ArrowRight" ? SEEK_STEP_MS : event.key === "ArrowLeft" ? -SEEK_STEP_MS : 0;
        if (!canSeek || !media || step === 0) return;
        event.preventDefault();
        onSeek(media.position_ms + step);
      }}
      className={[
        "group relative -my-1.5 min-w-0 flex-1 touch-none rounded-full",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-notch-focus",
        canSeek ? "cursor-pointer" : "",
      ].join(" ")}
      style={{ height: HEIGHT }}
    >
      {width > 0 && (
        // Keyed by track, so a new song starts at its place instead of gliding back.
        <div key={trackKey} aria-hidden="true" className="pointer-events-none absolute inset-0">
          {/* The rest of the track, then its end dot. */}
          <div
            className="absolute left-0 w-full rounded-full bg-white/15"
            style={{
              top: MID - spec.rest / 2,
              height: spec.rest,
              clipPath: restClip,
              transition: transition("clip-path"),
            }}
          />
          {spec.endDot && restStart < width - spec.rest * 2 && (
            <span
              className="absolute rounded-full bg-white/45"
              style={{ right: 0, top: MID - spec.rest / 2, width: spec.rest, height: spec.rest }}
            />
          )}

          {/* The part already played: a capsule, or a wave clipped to its length. */}
          {spec.wave ? (
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                clipPath: `inset(-2px ${Math.max(0, width - playedEnd)}px -2px 0)`,
                transition: transition("clip-path"),
              }}
            >
              <PlayedWave
                name={style}
                width={width}
                spec={spec}
                isPlaying={isPlaying}
                fill={isColourful ? "accent" : "#ffffff"}
              />
            </div>
          ) : (
            <div
              className="absolute left-0 w-full rounded-full"
              style={{
                top: MID - spec.played / 2,
                height: spec.played,
                background: playedFill,
                clipPath: playedClip,
                transition: transition("clip-path"),
              }}
            />
          )}

          {/* The thumb; the slim style shows a small one only while it is touched. */}
          {spec.thumb ? (
            <span
              className="absolute top-0 left-0 rounded-full shadow-[0_0_6px_rgb(0_0_0/0.45)]"
              style={{
                width: spec.thumb.width,
                height: spec.thumb.height,
                background: thumbColour,
                transform: `translate3d(${x - thumbHalf}px, ${MID - spec.thumb.height / 2}px, 0)`,
                transition: transition("transform"),
              }}
            />
          ) : (
            canSeek && (
              <span
                className={[
                  "absolute top-0 left-0 h-2 w-2 rounded-full transition-opacity duration-150",
                  dragFraction !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                ].join(" ")}
                style={{
                  background: thumbColour,
                  transform: `translate3d(${x - 4}px, ${MID - 4}px, 0)`,
                  transition: glide ? `transform ${glide}, opacity 150ms ease` : undefined,
                }}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
