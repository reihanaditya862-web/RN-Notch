import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hardwareAlert, notificationAlert, toastAlert } from "../lib/alerts";
import type { AppNotification, HardwareAlert } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";

/**
 * Routes what the Rust background loops report into the store: notifications
 * and hardware changes become pop-ups, copied text goes to the clipboard
 * history, a picked colour becomes a toast. Mount it once.
 *
 * Whether each one is wanted (module switched off, Do Not Disturb, capsule
 * off screen) is decided by the store, so nothing is filtered here.
 */
export function useNativeEvents(): void {
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    const cleanups: Array<() => void> = [];
    const subscribe = <T,>(event: string, handler: (payload: T) => void) => {
      listen<T>(event, (message) => handler(message.payload))
        .then((stop) => {
          if (disposed) stop();
          else cleanups.push(stop);
        })
        .catch((error: unknown) => {
          console.warn(`[useNativeEvents] could not listen for ${event}:`, error);
        });
    };

    subscribe<AppNotification>("app-notification", (notification) =>
      useNotchStore.getState().pushAlert(notificationAlert(notification)),
    );
    subscribe<HardwareAlert>("hardware-alert", (hardware) =>
      useNotchStore.getState().pushAlert(hardwareAlert(hardware)),
    );
    subscribe<string>("clipboard-text", (text) => {
      const store = useNotchStore.getState();
      if (store.settings.features.clipboard_history) store.addClip(text);
    });
    subscribe<string>("color-picked", (hex) =>
      useNotchStore
        .getState()
        .pushAlert(toastAlert(hex, "Colour copied to the clipboard", { type: "swatch", color: hex }, "success")),
    );

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);
}
