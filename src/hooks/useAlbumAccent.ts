import { useEffect, useState } from "react";
import { cachedAccent, extractAccent } from "../lib/albumAccent";
import type { MediaInfo } from "../lib/types";

/**
 * Colour of the playing track's cover, or null when nothing is playing, the
 * track has no cover, or the cover is grey. Each cover is sampled once.
 */
export function useAlbumAccent(media: MediaInfo | null): string | null {
  const art = media?.is_playing ? media.album_art_url : null;
  const key = art ? (media?.album_art_id ?? art) : null;
  const [, setSampled] = useState(0);

  useEffect(() => {
    if (!key || !art || cachedAccent(key) !== undefined) return;
    let isCurrent = true;
    extractAccent(key, art)
      .catch(() => null)
      .then(() => {
        if (isCurrent) setSampled((count) => count + 1);
      });
    return () => {
      isCurrent = false;
    };
  }, [key, art]);

  return key ? (cachedAccent(key) ?? null) : null;
}
