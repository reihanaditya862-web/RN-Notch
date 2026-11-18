import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toastAlert } from "../lib/alerts";
import type { MediaInfo, RepeatMode } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";

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

/** Several media events in a row become one refresh after this pause. */
const MEDIA_EVENT_SETTLE_MS = 150;

/** How long a button press outranks what the polls report, in ms. */
const OPTIMISTIC_HOLD_MS = 800;

/** Seeking and mode changes take apps longer to report back. */
const OPTIMISTIC_SLOW_HOLD_MS = 1500;

/** A reported position this close to where the seek should be counts as confirmed. */
const SEEK_TOLERANCE_MS = 1500;

/** RN Notch's own repeat jumps back this long before the track would end. */
const LOOP_LEAD_MS = 700;

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

  // Track and playback changes are pushed by Rust (`media-changed`), so the
  // capsule shows them at once even between slow polls. A burst of events
  // turns into one refresh.
  const isPolling = pollIntervalMs !== null;
  useEffect(() => {
    if (!isTauri() || !isPolling) return;
    let disposed = false;
    let timer = 0;
    let stop: (() => void) | undefined;
    listen("media-changed", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), MEDIA_EVENT_SETTLE_MS);
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch((error: unknown) => console.warn("[useMediaSession] media events unavailable:", error));
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      stop?.();
    };
  }, [isPolling, refresh]);

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
    const current = mediaRef.current;
    if (!current) return;
    if (current.shuffle === null) {
      // The app keeps shuffle to itself (browsers do); say so instead of
      // a button that silently does nothing.
      useNotchStore
        .getState()
        .pushAlert(
          toastAlert(
            `${current.source} has no shuffle for other apps`,
            "Turn shuffle on in the player itself",
            { type: "symbol", name: "error" },
            "warning",
          ),
        );
      return;
    }
    changeMode({ shuffle: !current.shuffle });
  }, [changeMode]);

  // Repeat for apps that do not offer it (a browser): RN Notch loops the
  // track itself by jumping back to the start just before it ends.
  const [localRepeat, setLocalRepeat] = useState(false);
  const source = media?.source ?? null;
  useEffect(() => setLocalRepeat(false), [source]);

  const cycleRepeat = useCallback(() => {
    const current = mediaRef.current;
    if (!current) return;
    if (current.repeat !== null) {
      changeMode({ repeat: NEXT_REPEAT[current.repeat] });
    } else if (current.can_seek && current.duration_ms > 0) {
      setLocalRepeat((on) => !on);
    } else {
      useNotchStore
        .getState()
        .pushAlert(
          toastAlert(
            `${current.source} cannot be repeated from here`,
            "It does not let other apps move its playback",
            { type: "symbol", name: "error" },
            "warning",
          ),
        );
    }
  }, [changeMode]);

  const canLoop =
    localRepeat &&
    media !== null &&
    media.repeat === null &&
    media.is_playing &&
    media.can_seek &&
    media.duration_ms > 0;
  const loopIn = canLoop ? media.duration_ms - media.position_ms - LOOP_LEAD_MS : null;
  useEffect(() => {
    if (loopIn === null) return;
    const timer = window.setTimeout(() => seek(0), Math.max(0, loopIn));
    return () => window.clearTimeout(timer);
  }, [loopIn, seek]);

  // What the buttons show: the app's own modes, or RN Notch's loop.
  const shownMedia = useMemo(
    () =>
      media && media.repeat === null && media.can_seek && media.duration_ms > 0
        ? { ...media, repeat: localRepeat ? ("track" as const) : ("none" as const), repeat_local: true }
        : media,
    [media, localRepeat],
  );

  return { media: shownMedia, playPause, next, previous, seek, toggleShuffle, cycleRepeat };
}
