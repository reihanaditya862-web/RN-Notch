import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MediaInfo, RepeatMode } from "../lib/types";

interface MediaSession {
  /** The active media session, or null when nothing is available. */
  media: MediaInfo | null;
  playPause: () => void;
  next: () => void;
  previous: () => void;
  /** Jumps to a position in ms from the start of the track. */
  seek: (positionMs: number) => void;
  toggleShuffle: () => void;
  /** Off -> repeat all -> repeat one -> off. */
  cycleRepeat: () => void;
}

/** After a transport command, give the media app this long to update Windows. */
const COMMAND_SETTLE_MS = 250;

/** How long a button press outranks what the polls report, in ms. */
const OPTIMISTIC_HOLD_MS = 800;

/** Seeking and mode changes take apps longer to report back. */
const OPTIMISTIC_SLOW_HOLD_MS = 1500;

/** A reported position this close to where the seek should be counts as confirmed. */
const SEEK_TOLERANCE_MS = 1500;

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { none: "list", list: "track", track: "none" };

type MediaCommand =
  | "media_play_pause"
  | "media_next"
  | "media_previous"
  | "media_seek"
  | "media_set_shuffle"
  | "media_set_repeat";

/**
 * Rust sends the cover art only when it changed (see `known_art_id`).
 * When the art is unchanged, carry the URL over from the previous snapshot.
 */
function withCarriedArt(previous: MediaInfo | null, next: MediaInfo | null): MediaInfo | null {
  if (!next || next.album_art_id === null || next.album_art_url !== null) return next;

  if (previous && previous.album_art_id === next.album_art_id && previous.album_art_url) {
    return { ...next, album_art_url: previous.album_art_url };
  }

  // We do not hold this image: forget the id so the next poll asks for it.
  return { ...next, album_art_id: null };
}

function isSameMedia(a: MediaInfo | null, b: MediaInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.album_art_id === b.album_art_id &&
    a.album_art_url === b.album_art_url &&
    a.is_playing === b.is_playing &&
    a.position_ms === b.position_ms &&
    a.duration_ms === b.duration_ms &&
    a.source === b.source &&
    a.can_seek === b.can_seek &&
    a.shuffle === b.shuffle &&
    a.repeat === b.repeat
  );
}

/**
 * Polls the Windows media session through Rust and exposes transport controls.
 *
 * @param pollIntervalMs time between polls; pass a shorter value while the
 *   capsule is expanded so the progress bar stays accurate. `null` pauses
 *   polling (media widget switched off, capsule hidden).
 */
export function useMediaSession(pollIntervalMs: number | null): MediaSession {
  const [media, setMedia] = useState<MediaInfo | null>(null);

  const mediaRef = useRef<MediaInfo | null>(null);
  const requestSeq = useRef(0);
  const lastError = useRef<string | null>(null);
  const optimisticPlay = useRef<{ value: boolean; until: number } | null>(null);
  const optimisticModes = useRef<{
    shuffle?: boolean;
    repeat?: RepeatMode;
    until: number;
  } | null>(null);
  const optimisticSeek = useRef<{ positionMs: number; at: number; until: number } | null>(null);

  const commit = useCallback((next: MediaInfo | null) => {
    mediaRef.current = next;
    setMedia((current) => (isSameMedia(current, next) ? current : next));
  }, []);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;

    const seq = ++requestSeq.current;
    const previous = mediaRef.current;

    try {
      const result = await invoke<MediaInfo | null>("get_media_info", {
        knownArtId: previous?.album_art_id ?? null,
      });
      if (seq !== requestSeq.current) return; // a newer request superseded this one

      let next = withCarriedArt(previous, result);

      // Right after a play/pause press the app may still report the old state.
      const hold = optimisticPlay.current;
      if (hold && next) {
        if (Date.now() < hold.until && next.is_playing !== hold.value) {
          next = { ...next, is_playing: hold.value };
        } else {
          optimisticPlay.current = null;
        }
      }

      const modes = optimisticModes.current;
      if (modes && next) {
        if (Date.now() < modes.until) {
          next = {
            ...next,
            ...(modes.shuffle !== undefined && { shuffle: modes.shuffle }),
            ...(modes.repeat !== undefined && { repeat: modes.repeat }),
          };
        } else {
          optimisticModes.current = null;
        }
      }

      // Until the app reports the new position, keep the bar where it was dropped.
      const seek = optimisticSeek.current;
      if (seek && next) {
        const expected = seek.positionMs + (next.is_playing ? Date.now() - seek.at : 0);
        if (Date.now() < seek.until && Math.abs(next.position_ms - expected) > SEEK_TOLERANCE_MS) {
          next = { ...next, position_ms: Math.min(expected, next.duration_ms || expected) };
        } else {
          optimisticSeek.current = null;
        }
      }

      lastError.current = null;
      commit(next);
    } catch (error) {
      if (seq !== requestSeq.current) return;

      // Fall back to the idle capsule; log each distinct failure once.
      const message = String(error);
      if (message !== lastError.current) {
        lastError.current = message;
        console.warn("[useMediaSession] get_media_info failed:", message);
      }
      commit(null);
    }
  }, [commit]);

  // Poll loop. Each poll is scheduled after the previous one finished, so
  // slow responses never pile up. Changing the interval polls immediately.
  useEffect(() => {
    if (!isTauri()) return;

    if (pollIntervalMs === null) {
      // Paused: drop the snapshot, it would only go stale.
      requestSeq.current += 1;
      commit(null);
      return;
    }

    let disposed = false;
    let timer = 0;

    const loop = async () => {
      await refresh();
      if (!disposed) timer = window.setTimeout(loop, pollIntervalMs);
    };
    void loop();

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [pollIntervalMs, refresh, commit]);

  const runCommand = useCallback(
    async (command: MediaCommand, args?: Record<string, unknown>) => {
      if (!isTauri()) return;
      try {
        await invoke(command, args);
      } catch (error) {
        optimisticPlay.current = null;
        optimisticModes.current = null;
        optimisticSeek.current = null;
        console.warn(`[useMediaSession] ${command} failed:`, error);
      }
      window.setTimeout(() => void refresh(), COMMAND_SETTLE_MS);
    },
    [refresh],
  );

  const playPause = useCallback(() => {
    const current = mediaRef.current;
    if (!current) return;

    // Flip the icon at once; the next polls confirm the real state.
    const value = !current.is_playing;
    optimisticPlay.current = { value, until: Date.now() + OPTIMISTIC_HOLD_MS };
    requestSeq.current += 1; // discard polls that started before the press
    commit({ ...current, is_playing: value });

    void runCommand("media_play_pause");
  }, [commit, runCommand]);

  const next = useCallback(() => void runCommand("media_next"), [runCommand]);
  const previous = useCallback(() => void runCommand("media_previous"), [runCommand]);

  const seek = useCallback(
    (positionMs: number) => {
      const current = mediaRef.current;
      if (!current?.can_seek || current.duration_ms <= 0) return;

      const target = Math.round(Math.min(Math.max(0, positionMs), current.duration_ms));
      const now = Date.now();
      optimisticSeek.current = { positionMs: target, at: now, until: now + OPTIMISTIC_SLOW_HOLD_MS };
      requestSeq.current += 1;
      commit({ ...current, position_ms: target });

      void runCommand("media_seek", { positionMs: target });
    },
    [commit, runCommand],
  );

  /** Shows a shuffle/repeat change at once and asks the app to make it. */
  const changeMode = useCallback(
    (change: { shuffle: boolean } | { repeat: RepeatMode }) => {
      const current = mediaRef.current;
      if (!current) return;

      const held = optimisticModes.current;
      const kept = held && Date.now() < held.until ? held : {};
      optimisticModes.current = { ...kept, ...change, until: Date.now() + OPTIMISTIC_SLOW_HOLD_MS };
      requestSeq.current += 1;
      commit({ ...current, ...change });

      if ("shuffle" in change) void runCommand("media_set_shuffle", { active: change.shuffle });
      else void runCommand("media_set_repeat", { mode: change.repeat });
    },
    [commit, runCommand],
  );

  const toggleShuffle = useCallback(() => {
    const shuffle = mediaRef.current?.shuffle;
    if (shuffle === null || shuffle === undefined) return;
    changeMode({ shuffle: !shuffle });
  }, [changeMode]);

  const cycleRepeat = useCallback(() => {
    const repeat = mediaRef.current?.repeat;
    if (!repeat) return;
    changeMode({ repeat: NEXT_REPEAT[repeat] });
  }, [changeMode]);

  return { media, playPause, next, previous, seek, toggleShuffle, cycleRepeat };
}
