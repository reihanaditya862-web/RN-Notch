import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { resolveScale } from "../lib/scale";
import { useNotchStore } from "../stores/notchStore";

/**
 * Resolves the user's size choice to a factor, keeps the store and the Tauri
 * window in step with it, and returns it. Mount it once, at the root.
 *
 * The factor is applied as CSS `zoom` on the root element (see `App`), so
 * width, height, type, padding and the notch's ears all grow together. The
 * transparent window is resized to match, because at 175% the dashboard
 * would not fit the base window.
 */
export function useUiScale(): number {
  const option = useNotchStore((store) => store.settings.scale);
  const [screenWidth, setScreenWidth] = useState(() => window.screen.width);

  // "Auto" follows the screen; re-read it when the display setup changes.
  useEffect(() => {
    const update = () => setScreenWidth(window.screen.width);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const scale = resolveScale(option, screenWidth);

  useEffect(() => {
    useNotchStore.getState().setUiScale(scale);
    if (!isTauri()) return;

    invoke("set_window_scale", { scale }).catch((error: unknown) => {
      console.warn("[useUiScale] set_window_scale failed:", error);
    });
  }, [scale]);

  return scale;
}
