import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ForegroundState } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";

/**
 * Follows what is in front of the capsule - a fullscreen app or a maximized
 * window - as reported by the Rust foreground watcher, and writes it to the
 * store. Mount it once.
 */
export function useForegroundState(): void {
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const apply = (state: ForegroundState) => useNotchStore.getState().setForeground(state);

    listen<ForegroundState>("foreground-state", (event) => apply(event.payload))
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        // Changes are only announced when they happen; ask for the state
        // that was already in place before we started listening.
        return invoke<ForegroundState>("get_foreground_state").then((state) => {
          if (!disposed) apply(state);
        });
      })
      .catch((error: unknown) => {
        console.warn("[useForegroundState] foreground state unavailable:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
