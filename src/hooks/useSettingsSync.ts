import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SETTINGS_SAVE_DEBOUNCE_MS } from "../lib/constants";
import type { AppSettings } from "../lib/types";
import { useNotchStore } from "../stores/notchStore";

/**
 * Module state, shared with `saveSettingsNow`.
 * `isLoaded`: Rust has told us its settings, so differences are real changes.
 * `syncedJson`: the settings Rust is known to hold, as JSON ("" = unknown).
 */
let isLoaded = false;
let syncedJson = "";
let saveTimer = 0;

function save(settings: AppSettings): Promise<void> {
  const json = JSON.stringify(settings);
  syncedJson = json;
  return invoke<AppSettings>("save_settings", { settings }).then(
    () => undefined,
    (error: unknown) => {
      // Not stored after all: forget it, so the next change is saved again.
      if (syncedJson === json) syncedJson = "";
      console.warn("[useSettingsSync] save_settings failed:", error);
    },
  );
}

/**
 * Writes pending setting changes immediately instead of waiting for the
 * debounce. Call before quitting, so a change made a moment ago is not lost.
 */
export function saveSettingsNow(): Promise<void> {
  window.clearTimeout(saveTimer);
  if (!isTauri() || !isLoaded) return Promise.resolve();

  const settings = useNotchStore.getState().settings;
  if (JSON.stringify(settings) === syncedJson) return Promise.resolve();
  return save(settings);
}

/**
 * Keeps the store's settings and `%APPDATA%\rn-notch\settings.json` in step.
 * Mount it once.
 *
 * - On start the settings are loaded from Rust.
 * - A change made in the UI is saved after `SETTINGS_SAVE_DEBOUNCE_MS` of
 *   quiet, so dragging the opacity slider writes the file once, not per step.
 * - A change made in Rust (tray menu) arrives as `settings-changed` and is
 *   adopted without being written back.
 * - The tray's "Settings..." and Show/Hide arrive as events too.
 */
export function useSettingsSync(): void {
  useEffect(() => {
    if (!isTauri()) return;

    let disposed = false;
    const cleanups: Array<() => void> = [];

    const adopt = (settings: AppSettings) => {
      useNotchStore.getState().applySettings(settings);
      // Compare against what the store really holds (it normalizes values).
      syncedJson = JSON.stringify(useNotchStore.getState().settings);
      isLoaded = true;
    };

    invoke<AppSettings>("load_settings")
      .then((settings) => {
        if (!disposed) adopt(settings);
      })
      .catch((error: unknown) => {
        console.warn("[useSettingsSync] load_settings failed:", error);
        // Keep the built-in defaults; later changes are still saved.
        if (!disposed) adopt(useNotchStore.getState().settings);
      });

    const subscribe = <T,>(event: string, handler: (payload: T) => void) => {
      listen<T>(event, (message) => handler(message.payload))
        .then((stop) => {
          if (disposed) stop();
          else cleanups.push(stop);
        })
        .catch((error: unknown) => {
          console.warn(`[useSettingsSync] could not listen for ${event}:`, error);
        });
    };

    subscribe<AppSettings>("settings-changed", adopt);
    subscribe<null>("open-settings", () => useNotchStore.getState().openSettings());
    subscribe<boolean>("visibility-changed", (visible) =>
      useNotchStore.getState().setVisible(visible),
    );

    cleanups.push(
      useNotchStore.subscribe((store, previous) => {
        if (store.settings === previous.settings) return;
        // Nothing to save until the first load has told us what Rust holds,
        // and nothing to save when the change came from Rust in the first place.
        if (!isLoaded || JSON.stringify(store.settings) === syncedJson) return;

        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
          const latest = useNotchStore.getState().settings;
          if (JSON.stringify(latest) !== syncedJson) void save(latest);
        }, SETTINGS_SAVE_DEBOUNCE_MS);
      }),
    );

    return () => {
      disposed = true;
      window.clearTimeout(saveTimer);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);
}
