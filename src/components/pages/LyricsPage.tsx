import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader, MicVocal, Music, Pause, Play } from "lucide-react";
import { type LyricsStatus, useLyricsTrack } from "../../hooks/useLyrics";
import type { LyricLine } from "../../lib/lyrics";
import type { MediaInfo } from "../../lib/types";
import { useNotchStore } from "../../stores/notchStore";
import type { MediaControls } from "./MediaPage";
import { FOCUS_RING, PageHeader } from "./PageHeader";

/** After the user scrolls the lyrics, they stay where they were put this long. */
const MANUAL_SCROLL_HOLD_MS = 4000;
/** Lyrics fade out toward the top and bottom edges of their column. */
const EDGE_FADE = "linear-gradient(180deg, transparent 0%, #000 16%, #000 84%, transparent 100%)";

/** The cover, title and artist, and a small play/pause button. */
function CoverColumn({
  media,
  onPlayPause,
  hasGlow,
}: {
  media: MediaInfo | null;
  onPlayPause: () => void;
  hasGlow: boolean;
}) {
  return (
    <aside className="flex w-[34%] shrink-0 flex-col items-center gap-2 pt-1">
      <div className="relative">
        {/* A soft light in the cover's colours behind it (off with the inner glow). */}
        {hasGlow && media?.album_art_url && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-4 rounded-[28px]"
            style={{
              background:
                "radial-gradient(closest-side, var(--notch-accent-1, transparent), var(--notch-accent-2, transparent) 55%, transparent)",
              opacity: 0.45,
            }}
          />
        )}
        <div className="relative flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-xl bg-notch-surface shadow-[0_8px_20px_rgb(0_0_0/0.55)]">
          <Music size={28} strokeWidth={1.25} aria-hidden="true" className="text-notch-tertiary" />
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
      </div>

      <div className="w-full min-w-0 text-center">
        <p
          title={media?.title}
          className="truncate font-display text-[12px] leading-4 font-bold text-notch-primary"
        >
          {media?.title ?? "Nothing playing"}
        </p>
        <p className="truncate text-[11px] leading-[14px] text-notch-secondary">
          {media ? media.artist || media.source : "Play something to see its lyrics"}
        </p>
      </div>

      <button
        type="button"
        onClick={onPlayPause}
        disabled={!media}
        aria-label={media?.is_playing ? "Pause" : "Play"}
        title={media?.is_playing ? "Pause" : "Play"}
        className={[
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-notch-primary text-black",
          "transition-[scale,opacity] duration-100 hover:scale-105 active:scale-95 disabled:opacity-30",
          FOCUS_RING,
        ].join(" ")}
      >
        {media?.is_playing ? (
          <Pause size={13} strokeWidth={2} fill="currentColor" aria-hidden="true" />
        ) : (
          <Play size={13} strokeWidth={2} fill="currentColor" aria-hidden="true" className="translate-x-px" />
        )}
      </button>
    </aside>
  );
}

/**
 * Synced lyrics: the line being sung is centred, bright and bold, a touch
 * larger; the others are dimmed. Clicking a line jumps there (when the app
 * allows seeking). After the user scrolls the list, it stays put for a few
 * seconds before following the song again.
 */
function SyncedLyrics({
  lines,
  index,
  canSeek,
  onSeek,
}: {
  lines: LyricLine[];
  index: number;
  canSeek: boolean;
  onSeek: (positionMs: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLElement | null>>([]);
  const manualUntil = useRef(0);
  const hasScrolled = useRef(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const list = listRef.current;
    const line = lineRefs.current[Math.max(0, index)];
    if (!list || !line || Date.now() < manualUntil.current) return;
    const top = line.offsetTop - list.clientHeight / 2 + line.offsetHeight / 2;
    // The first time the page opens it lands on the line at once.
    list.scrollTo({ top, behavior: hasScrolled.current && !reducedMotion ? "smooth" : "auto" });
    hasScrolled.current = true;
  }, [index, lines, reducedMotion]);

  const holdPosition = () => {
    manualUntil.current = Date.now() + MANUAL_SCROLL_HOLD_MS;
  };

  return (
    <div
      ref={listRef}
      data-scroll=""
      onWheel={holdPosition}
      onKeyDown={(event) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) holdPosition();
      }}
      className="notch-scroll relative min-h-0 flex-1 overflow-y-auto pr-1"
      style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
    >
      {/* Room above the first line and below the last, so either can sit in the middle. */}
      <div aria-hidden="true" className="h-[42%]" />
      {lines.map((line, lineIndex) => {
        const isActive = lineIndex === index;
        const className = [
          "block w-full origin-left py-[3px] text-left text-[13px] leading-[18px] text-white",
          "transition-[opacity,scale] duration-300 ease-out",
          isActive ? "scale-[1.03] font-bold opacity-100" : "scale-100 font-medium opacity-35",
        ].join(" ");
        const text = line.text || "♪";
        return canSeek ? (
          <button
            key={lineIndex}
            ref={(element) => {
              lineRefs.current[lineIndex] = element;
            }}
            type="button"
            aria-current={isActive ? "true" : undefined}
            title="Jump here"
            onClick={() => {
              manualUntil.current = 0;
              onSeek(line.time);
            }}
            className={`${className} cursor-pointer rounded-md ${isActive ? "" : "hover:opacity-70"} ${FOCUS_RING}`}
          >
            {text}
          </button>
        ) : (
          <p
            key={lineIndex}
            ref={(element) => {
              lineRefs.current[lineIndex] = element;
            }}
            aria-current={isActive ? "true" : undefined}
            className={className}
          >
            {text}
          </p>
        );
      })}
      <div aria-hidden="true" className="h-[48%]" />
    </div>
  );
}

/** Words without timing: shown as they are, scrollable, nothing highlighted. */
function PlainLyrics({ text }: { text: string }) {
  return (
    <div
      data-scroll=""
      className="notch-scroll min-h-0 flex-1 overflow-y-auto pr-1"
      style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
    >
      <div aria-hidden="true" className="h-4" />
      {text.split(/\r?\n/).map((line, index) => (
        <p key={index} className="min-h-[17px] text-[12px] leading-[17px] text-notch-secondary">
          {line}
        </p>
      ))}
      <div aria-hidden="true" className="h-6" />
    </div>
  );
}

const STATUS_TEXT: Partial<Record<LyricsStatus, string>> = {
  loading: "Looking for lyrics...",
  instrumental: "Instrumental",
  missing: "Lyrics not available",
  off: "Play something to see its lyrics",
};

function StatusMessage({ status }: { status: LyricsStatus }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-notch-tertiary">
      {status === "loading" ? (
        <Loader size={16} strokeWidth={1.75} aria-hidden="true" className="animate-spin" />
      ) : (
        <MicVocal size={16} strokeWidth={1.5} aria-hidden="true" />
      )}
      <p role="status" className="text-[12px] leading-4">
        {STATUS_TEXT[status]}
      </p>
    </div>
  );
}

/**
 * The lyrics page: the cover on the left, the song's lyrics (LRCLIB) on the
 * right. Synced lyrics follow the song; plain lyrics are shown when that is
 * all there is; an instrumental or an unknown song gets a short note, and
 * the cover stays in place throughout.
 */
export function LyricsPage({ controls, onCollapse }: { controls: MediaControls; onCollapse: () => void }) {
  const isEnabled = useNotchStore((store) => store.settings.features.lyrics);
  const hasGlow = useNotchStore((store) => store.settings.inner_gradient_enabled);
  const { media } = controls;
  const { status, lyrics, index } = useLyricsTrack(media, isEnabled);

  const detail =
    status === "synced" ? "Synced" : status === "plain" ? "Not synced" : media ? media.source : undefined;

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader title="Lyrics" detail={detail} onCollapse={onCollapse} />
      <div className="flex min-h-0 flex-1 gap-3">
        <CoverColumn media={media} onPlayPause={controls.onPlayPause} hasGlow={hasGlow} />
        {status === "synced" && lyrics?.synced ? (
          <SyncedLyrics
            lines={lyrics.synced}
            index={index}
            canSeek={Boolean(media?.can_seek)}
            onSeek={controls.onSeek}
          />
        ) : status === "plain" && lyrics?.plain ? (
          <PlainLyrics text={lyrics.plain} />
        ) : (
          <StatusMessage status={status} />
        )}
      </div>
    </div>
  );
}
