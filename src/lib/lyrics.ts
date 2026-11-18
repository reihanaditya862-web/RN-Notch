import { invoke } from "@tauri-apps/api/core";

/**
 * Synced lyrics from LRCLIB (https://lrclib.net), a free lyrics database that
 * needs no key. A song is looked up by title, artist and length; songs not
 * found, instrumentals and lyrics without timestamps all give `null`, and
 * the capsule then simply keeps showing the title.
 */

export interface LyricLine {
  /** Start of the line in the track, in ms. */
  time: number;
  /** Empty for a pause between verses. */
  text: string;
}

const API = "https://lrclib.net/api";
/** LRCLIB's lengths are whole seconds; a few seconds either way still match. */
const DURATION_TOLERANCE_S = 4;
const CACHE_LIMIT = 30;

/** Track key -> its lines, or null when there are none. In memory only. */
const cache = new Map<string, LyricLine[] | null>();
const pending = new Map<string, Promise<LyricLine[] | null>>();

/** "[01:23.45] text" (several stamps per line allowed) into sorted lines. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const stamp of stamps) {
      const fraction = stamp[3] ?? "0";
      const ms = Number(fraction.padEnd(3, "0").slice(0, 3));
      lines.push({ time: (Number(stamp[1]) * 60 + Number(stamp[2])) * 1000 + ms, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** The line being sung at `positionMs`, and when the next one starts. */
export function lineAt(
  lines: LyricLine[],
  positionMs: number,
): { line: LyricLine | null; next: number | null } {
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].time <= positionMs; i += 1) index = i;
  return {
    line: index >= 0 ? lines[index] : null,
    next: index + 1 < lines.length ? lines[index + 1].time : null,
  };
}

interface LrclibRecord {
  syncedLyrics?: unknown;
  instrumental?: unknown;
  duration?: unknown;
}

function linesOf(record: LrclibRecord | null | undefined): LyricLine[] | null {
  if (!record || record.instrumental === true || typeof record.syncedLyrics !== "string") return null;
  const lines = parseLrc(record.syncedLyrics);
  return lines.some((line) => line.text) ? lines : null;
}

async function getJson(url: string): Promise<unknown> {
  return JSON.parse(await invoke<string>("http_get_text", { url }));
}

async function lookUp(title: string, artist: string, durationS: number): Promise<LyricLine[] | null> {
  const query = new URLSearchParams({ track_name: title, artist_name: artist });
  if (durationS > 0) {
    try {
      const exact = await getJson(`${API}/get?${query}&duration=${Math.round(durationS)}`);
      const lines = linesOf(exact as LrclibRecord);
      if (lines) return lines;
    } catch {
      // Not found by exact length: try a search below.
    }
  }
  try {
    const results = await getJson(`${API}/search?${query}`);
    if (!Array.isArray(results)) return null;
    const match = (results as LrclibRecord[]).find(
      (record) =>
        typeof record.syncedLyrics === "string" &&
        (durationS <= 0 ||
          (typeof record.duration === "number" &&
            Math.abs(record.duration - durationS) <= DURATION_TOLERANCE_S)),
    );
    return linesOf(match);
  } catch {
    return null;
  }
}

export function lyricsKey(title: string, artist: string, durationMs: number): string {
  return `${artist.toLowerCase()}|${title.toLowerCase()}|${Math.round(durationMs / 1000)}`;
}

export function cachedLyrics(key: string): LyricLine[] | null | undefined {
  return cache.get(key);
}

/** Synced lyrics for a track, fetched once and kept for the session. */
export function fetchLyrics(
  key: string,
  title: string,
  artist: string,
  durationMs: number,
): Promise<LyricLine[] | null> {
  const known = cache.get(key);
  if (known !== undefined) return Promise.resolve(known);
  const running = pending.get(key);
  if (running) return running;

  const request = lookUp(title, artist, durationMs / 1000)
    .catch(() => null)
    .then((lines) => {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, lines);
      pending.delete(key);
      return lines;
    });
  pending.set(key, request);
  return request;
}
