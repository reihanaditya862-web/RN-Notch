import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Tells the Rust background loops (notifications, hardware, clipboard) to
 * slow down while the capsule is off screen or battery saver is on.
 */
export function useBackgroundPause(paused: boolean): void {
  useEffect(() => {
    if (!isTauri()) return;
    invoke("set_background_paused", { paused }).catch((error: unknown) => {
      console.warn("[useBackgroundPause] set_background_paused failed:", error);
    });
  }, [paused]);
}
