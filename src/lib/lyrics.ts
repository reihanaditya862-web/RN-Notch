import { invoke } from "@tauri-apps/api/core";

/**
 * Lyrics from LRCLIB (https://lrclib.net), a free lyrics database that needs
 * no key. A song is looked up by title, artist and length. Synced lyrics
 * (with timestamps) drive the line in the capsule and the lyrics page; when
 * only plain words exist the lyrics page shows those, and an instrumental is
 * marked as such. A song LRCLIB does not know gives `null`.
 */

export interface LyricLine {
  /** Start of the line in the track, in ms. */
  time: number;
  /** Empty for a pause between verses. */
  text: string;
}

/** What LRCLIB has for a song. */
export interface Lyrics {
  /** Timed lines, when there are synced lyrics. */
  synced: LyricLine[] | null;
  /** The words without timing, when LRCLIB has them. */
  plain: string | null;
  instrumental: boolean;
}

const API = "https://lrclib.net/api";
/** LRCLIB's lengths are whole seconds; a few seconds either way still match. */
const DURATION_TOLERANCE_S = 4;
const CACHE_LIMIT = 30;

/** Track key -> its lyrics, or null when LRCLIB has none. In memory only. */
const cache = new Map<string, Lyrics | null>();
const pending = new Map<string, Promise<Lyrics | null>>();

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

/**
 * The index of the line being sung at `positionMs` (-1 before the first),
 * and when the next one starts.
 */
export function lineIndexAt(lines: LyricLine[], positionMs: number): { index: number; next: number | null } {
  let index = -1;
  for (let i = 0; i < lines.length && lines[i].time <= positionMs; i += 1) index = i;
  return { index, next: index + 1 < lines.length ? lines[index + 1].time : null };
}

interface LrclibRecord {
  syncedLyrics?: unknown;
  plainLyrics?: unknown;
  instrumental?: unknown;
  duration?: unknown;
}

function lyricsOf(record: LrclibRecord | null | undefined): Lyrics | null {
  if (!record) return null;
  if (record.instrumental === true) return { synced: null, plain: null, instrumental: true };
  const lines = typeof record.syncedLyrics === "string" ? parseLrc(record.syncedLyrics) : [];
  const synced = lines.some((line) => line.text) ? lines : null;
  const plain =
    typeof record.plainLyrics === "string" && record.plainLyrics.trim() ? record.plainLyrics.trim() : null;
  return synced || plain ? { synced, plain, instrumental: false } : null;
}

async function getJson(url: string): Promise<unknown> {
  return JSON.parse(await invoke<string>("http_get_text", { url }));
}

/**
 * Synced lyrics are preferred: the exact match first, then a search among
 * versions of about the same length. Plain words or an instrumental mark are
 * the answer only when no synced version turns up.
 */
async function lookUp(title: string, artist: string, durationS: number): Promise<Lyrics | null> {
  const query = new URLSearchParams({ track_name: title, artist_name: artist });
  let fallback: Lyrics | null = null;
  if (durationS > 0) {
    try {
      const exact = lyricsOf(
        (await getJson(`${API}/get?${query}&duration=${Math.round(durationS)}`)) as LrclibRecord,
      );
      if (exact?.synced || exact?.instrumental) return exact;
      fallback = exact;
    } catch {
      // Not found by exact length: try a search below.
    }
  }
  try {
    const results = await getJson(`${API}/search?${query}`);
    if (!Array.isArray(results)) return fallback;
    const versions = (results as LrclibRecord[])
      .filter(
        (record) =>
          durationS <= 0 ||
          (typeof record.duration === "number" && Math.abs(record.duration - durationS) <= DURATION_TOLERANCE_S),
      )
      .map(lyricsOf)
      .filter((lyrics): lyrics is Lyrics => lyrics !== null);
    return versions.find((lyrics) => lyrics.synced) ?? fallback ?? versions[0] ?? null;
  } catch {
    return fallback;
  }
}

export function lyricsKey(title: string, artist: string, durationMs: number): string {
  return `${artist.toLowerCase()}|${title.toLowerCase()}|${Math.round(durationMs / 1000)}`;
}

/** The lyrics already fetched for a key; `undefined` when not asked yet. */
export function cachedLyrics(key: string): Lyrics | null | undefined {
  return cache.get(key);
}

/** Lyrics for a track, fetched once and kept for the session. */
export function fetchLyrics(
  key: string,
  title: string,
  artist: string,
  durationMs: number,
): Promise<Lyrics | null> {
  const known = cache.get(key);
  if (known !== undefined) return Promise.resolve(known);
  const running = pending.get(key);
  if (running) return running;

  const request = lookUp(title, artist, durationMs / 1000)
    .catch(() => null)
    .then((lyrics) => {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      cache.set(key, lyrics);
      pending.delete(key);
      return lyrics;
    });
  pending.set(key, request);
  return request;
}
