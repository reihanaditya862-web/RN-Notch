import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SystemInfo } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";

/**
 * Polls battery, CPU, RAM and volume through Rust and writes the snapshot to
 * the store. Mount it once.
 *
 * @param pollIntervalMs time between polls; pass a shorter value while the
 *   dashboard is open. Changing it polls immediately. `null` pauses polling
 *   (capsule hidden).
 */
export function useSystemInfo(pollIntervalMs: number | null): void {
  useEffect(() => {
    if (!isTauri() || pollIntervalMs === null) return;

    let disposed = false;
    let timer = 0;
    let lastError: string | null = null;

    const loop = async () => {
      try {
        const info = await invoke<SystemInfo>("get_system_info");
        if (disposed) return;
        lastError = null;
        useNotchStore.getState().setSystemInfo(info);
      } catch (error) {
        if (disposed) return;
        // Keep the last good snapshot on screen; log each distinct failure once.
        const message = String(error);
        if (message !== lastError) {
          lastError = message;
          console.warn("[useSystemInfo] get_system_info failed:", message);
        }
      }
      timer = window.setTimeout(loop, pollIntervalMs);
    };
    void loop();

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [pollIntervalMs]);
}
