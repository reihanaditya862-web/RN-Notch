import { useEffect, useState } from "react";
import { cachedPalette, extractPalette } from "../lib/albumAccent";
import type { MediaInfo } from "../lib/types";

/**
 * The current track's cover colours (one to three, strongest first), or null
 * when there is no track, no cover, or the cover is grey. Each cover is
 * sampled once.
 */
export function useAlbumPalette(media: MediaInfo | null): string[] | null {
  const art = media?.album_art_url ?? null;
  const key = art ? (media?.album_art_id ?? art) : null;
  const [, setSampled] = useState(0);

  useEffect(() => {
    if (!key || !art || cachedPalette(key) !== undefined) return;
    let isCurrent = true;
    extractPalette(key, art)
      .catch(() => null)
      .then(() => {
        if (isCurrent) setSampled((count) => count + 1);
      });
    return () => {
      isCurrent = false;
    };
  }, [key, art]);

  return key ? (cachedPalette(key) ?? null) : null;
}
