import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { type Lyrics, cachedLyrics, fetchLyrics, lineIndexAt, lyricsKey } from "../lib/lyrics";
import type { MediaInfo } from "../lib/types";

/**
 * - `off`: lyrics are switched off, or nothing is playing.
 * - `loading`: LRCLIB is being asked.
 * - `synced` / `plain` / `instrumental`: what LRCLIB has.
 * - `missing`: LRCLIB does not know the song.
 */
export type LyricsStatus = "off" | "loading" | "synced" | "plain" | "instrumental" | "missing";

export interface LyricsTrack {
  status: LyricsStatus;
  lyrics: Lyrics | null;
  /** The synced line being sung, -1 before the first one (or with none). */
  index: number;
}

/**
 * The lyrics of the playing track and the line being sung right now.
 *
 * No animation loop: the position is carried forward from the last media
 * poll, and one timer wakes the hook exactly when the next line starts.
 */
export function useLyricsTrack(media: MediaInfo | null, enabled: boolean): LyricsTrack {
  const title = media?.title ?? "";
  const artist = media?.artist ?? "";
  const duration = media?.duration_ms ?? 0;
  const key = enabled && media && title ? lyricsKey(title, artist, duration) : null;

  const [, setLoaded] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!key || !isTauri() || cachedLyrics(key) !== undefined) return;
    let current = true;
    void fetchLyrics(key, title, artist, duration).then(() => {
      if (current) setLoaded((count) => count + 1);
    });
    return () => {
      current = false;
    };
  }, [key, title, artist, duration]);

  // Where the song was at the last poll, and when that was. Updated while
  // rendering, so the very render that brings a new position already uses it.
  const anchor = useRef({ position: 0, at: 0, playing: false });
  const position = media?.position_ms ?? 0;
  const isPlaying = media?.is_playing ?? false;
  if (anchor.current.position !== position || anchor.current.playing !== isPlaying) {
    anchor.current = { position, at: Date.now(), playing: isPlaying };
  }

  const entry = key ? cachedLyrics(key) : undefined;
  const lines = entry?.synced ?? null;
  const now = isPlaying
    ? anchor.current.position + (Date.now() - anchor.current.at)
    : anchor.current.position;
  const { index, next } = lines ? lineIndexAt(lines, now) : { index: -1, next: null };

  useEffect(() => {
    if (!lines || !isPlaying || next === null) return;
    const timer = window.setTimeout(() => setTick((count) => count + 1), Math.max(30, next - now));
    return () => window.clearTimeout(timer);
  }, [lines, isPlaying, next, now]);

  let status: LyricsStatus = "missing";
  if (!key) status = "off";
  else if (entry === undefined) status = isTauri() ? "loading" : "missing";
  else if (entry?.synced) status = "synced";
  else if (entry?.plain) status = "plain";
  else if (entry?.instrumental) status = "instrumental";

  return { status, lyrics: entry ?? null, index };
}

/**
 * The synced line being sung right now, or null (lyrics off, nothing playing,
 * no synced lyrics for this song). An empty string is a pause between lines.
 */
export function useLyrics(media: MediaInfo | null, enabled: boolean): string | null {
  const { lyrics, index } = useLyricsTrack(media, enabled);
  const lines = lyrics?.synced;
  if (!lines) return null;
  return index >= 0 ? lines[index].text : null;
}
