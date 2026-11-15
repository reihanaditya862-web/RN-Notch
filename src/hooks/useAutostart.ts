import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Autostart {
  /** Whether the app starts with Windows; null until that is known. */
  isEnabled: boolean | null;
  setEnabled: (enabled: boolean) => void;
}

/**
 * "Start with Windows". The switch lives in Windows' own startup entry, not
 * in settings.json: this hook reads it through Rust, changes it through
 * Rust, and follows changes made from the tray (`autostart-changed`).
 */
export function useAutostart(): Autostart {
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    invoke<boolean>("get_autostart")
      .then((enabled) => {
        if (!disposed) setIsEnabled(enabled);
      })
      .catch((error: unknown) => {
        console.warn("[useAutostart] get_autostart failed:", error);
      });

    listen<boolean>("autostart-changed", (event) => setIsEnabled(event.payload))
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        console.warn("[useAutostart] could not listen for changes:", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setIsEnabled(enabled); // show it at once; Rust answers with the real state
    if (!isTauri()) return;

    invoke<boolean>("set_autostart", { enabled })
      .then(setIsEnabled)
      .catch((error: unknown) => {
        console.warn("[useAutostart] set_autostart failed:", error);
        // The failed change also emits `autostart-changed` with the real
        // state, but do not rely on the event alone.
        setIsEnabled(!enabled);
      });
  }, []);

  return { isEnabled, setEnabled };
}
