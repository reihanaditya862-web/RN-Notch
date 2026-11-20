import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import type { HudReading } from "../lib/alerts";
import { useNotchStore } from "../stores/notchStore";

/**
 * Shows the volume/brightness pill whenever Windows reports a change
 * (`system-hud` from `hud.rs`, which only sends while the module is on).
 */
export function useSystemHud(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void listen<HudReading>("system-hud", (event) => {
      useNotchStore.getState().showHud(event.payload);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
