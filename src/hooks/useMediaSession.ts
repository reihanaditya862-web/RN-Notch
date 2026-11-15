import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MediaInfo } from "../lib/types";

interface MediaSession {
  /** The active media session, or null when nothing is available. */
  media: MediaInfo | null;
  playPause: () => void;
  next: () => void;
  previous: () => void;
}

/** After a transport command, give the media app this long to update Windows. */
const COMMAND_SETTLE_MS = 250;

/** How long a button press outranks what the polls report, in ms. */
const OPTIMISTIC_HOLD_MS = 800;

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
    a.source === b.source
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
    async (command: "media_play_pause" | "media_next" | "media_previous") => {
      if (!isTauri()) return;
      try {
        await invoke(command);
      } catch (error) {
        optimisticPlay.current = null;
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

  return { media, playPause, next, previous };
}
