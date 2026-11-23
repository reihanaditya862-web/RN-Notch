import { useEffect, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MediaInfo } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";

/** The collapse animation has finished by then. */
const COLLAPSE_SETTLE_MS = 400;

/**
 * While the capsule sits collapsed (or off screen), RN Notch asks for its
 * memory to be trimmed: WebView2 drops to its low memory target and this
 * process's working set is handed back to Windows (see `memory.rs`). The
 * moment the capsule opens, WebView2 goes back to its normal target.
 */
export function useCollapsedMemory(isCollapsed: boolean): void {
  const isLow = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    if (!isCollapsed) {
      if (isLow.current) {
        isLow.current = false;
        invoke("set_memory_mode", { low: false }).catch(() => undefined);
      }
      return;
    }
    const timer = window.setTimeout(() => {
      isLow.current = true;
      invoke("set_memory_mode", { low: true }).catch(() => undefined);
    }, COLLAPSE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [isCollapsed]);
}

/**
 * The file magnet: a file dragged from Explorer toward the capsule pulls it
 * open as a drop zone (Rust watches for it, see `check_cursor`). Needs the
 * shelf, and smart context, to be on.
 */
export function useFileMagnet(enabled: boolean): void {
  useEffect(() => {
    if (!isTauri()) return;
    invoke("set_magnet_enabled", { enabled }).catch(() => undefined);
  }, [enabled]);
}

/**
 * Smart context for media: when a song starts after nothing was playing,
 * the media page is the one the dashboard opens on next.
 */
export function useMediaFocus(media: MediaInfo | null, enabled: boolean): void {
  const isPlaying = media?.is_playing ?? false;
  const wasPlaying = useRef(isPlaying);
  useEffect(() => {
    const started = isPlaying && !wasPlaying.current;
    wasPlaying.current = isPlaying;
    if (!started || !enabled) return;
    const store = useNotchStore.getState();
    if (store.state !== "expanded" && store.state !== "settings") store.setDashboardPage("media");
  }, [isPlaying, enabled]);
}
