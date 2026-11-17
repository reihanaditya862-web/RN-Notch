import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_SETTINGS,
  GLOW_END_DEFAULT,
  GLOW_START_DEFAULT,
  OPACITY_MAX,
  OPACITY_MIN,
  SHELF_FILE_TTL_MS,
  SHELF_MAX_FILES,
} from "../lib/constants";
import { isHexColor, normalizeHex } from "../lib/color";
import { normalizeScale } from "../lib/scale";
import type {
  ActiveWidgets,
  AppSettings,
  ForegroundState,
  NotchState,
  ScaleOption,
  ShelfFile,
  SystemInfo,
} from "../lib/types";

/** How long a volume change made in the UI outranks what the polls report, in ms. */
const VOLUME_HOLD_MS = 1000;

/** Everything the visual state is derived from. */
interface StateInputs {
  isHoverOpen: boolean;
  isExpanded: boolean;
  isSettingsOpen: boolean;
  isDragOver: boolean;
  isMediaPlaying: boolean;
  settings: AppSettings;
}

interface NotchStore extends StateInputs {
  /** Current visual state of the capsule. Derived from the inputs above. */
  state: NotchState;
  previousState: NotchState;

  /**
   * The saved settings have arrived. Until then nothing is drawn, so the
   * capsule never flashes in the default mode or size before taking the
   * user's.
   */
  isReady: boolean;

  /** False while the capsule is hidden from the tray; polling pauses then. */
  isVisible: boolean;

  /** What is in front of the capsule: a fullscreen app, a maximized window. */
  foreground: ForegroundState;

  /**
   * The size factor in effect (1 = 100%), resolved from `settings.scale` by
   * `useUiScale`. Everything is drawn at this zoom.
   */
  uiScale: number;

  /** Latest hardware snapshot from Rust; null until the first poll lands. */
  systemInfo: SystemInfo | null;
  volumeHoldUntil: number;

  /** Persisted to localStorage. */
  shelfFiles: ShelfFile[];
  scratchpadText: string;

  /** The cursor has settled on the capsule (after the hover delay). Closing also closes the dashboard. */
  setHoverOpen: (open: boolean) => void;
  setMediaPlaying: (playing: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  setDragOver: (over: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  setVisible: (visible: boolean) => void;
  markReady: () => void;
  setForeground: (foreground: ForegroundState) => void;
  setUiScale: (scale: number) => void;

  /**
   * Replaces the settings. Used for values coming from Rust (startup, tray);
   * UI changes go through the setters below. `useSettingsSync` saves whatever
   * differs from what Rust already has.
   */
  applySettings: (settings: AppSettings) => void;
  /** Switches between Dynamic Island and Notch. */
  toggleDisplayMode: () => void;
  setDisplayMode: (mode: AppSettings["display_mode"]) => void;
  setOpacity: (opacity: number) => void;
  /** Picks the capsule size: "auto" or a fixed percentage. */
  setScale: (scale: ScaleOption) => void;
  /** Sets one colour of the inner glow ("#RRGGBB"); other values are ignored. */
  setGlowColor: (which: "start" | "end", color: string) => void;
  /** Puts both glow colours back to the default blue and purple. */
  resetGlowColors: () => void;
  setWidgetActive: (widget: keyof ActiveWidgets, active: boolean) => void;
  toggleDnd: () => void;

  setSystemInfo: (info: SystemInfo) => void;
  /** Show a volume change at once, before Windows confirms it. */
  setVolumeOptimistic: (percent: number) => void;
  setMutedOptimistic: (muted: boolean) => void;

  /** Adds dropped files up to the shelf limit. Returns how many were added and how many did not fit. */
  addShelfFiles: (paths: string[]) => { added: number; rejected: number };
  removeShelfFile: (id: string) => void;
  /** Drops files that have been on the shelf longer than the time limit. */
  pruneExpiredShelfFiles: () => void;

  setScratchpadText: (text: string) => void;
}

/**
 * Priority: a file drag beats the settings panel, which beats the dashboard,
 * which beats hover, which beats idle.
 *
 * Do Not Disturb keeps the capsule from changing by itself: it neither widens
 * for music nor opens on hover. A click still opens the dashboard.
 */
function resolveState(inputs: StateInputs): NotchState {
  const { active_widgets: widgets, dnd_enabled: isQuiet } = inputs.settings;

  if (inputs.isDragOver && widgets.file_shelf) return "dragOver";
  if (inputs.isSettingsOpen) return "settings";
  if (inputs.isExpanded) return "expanded";
  if (widgets.media && !isQuiet) {
    if (inputs.isHoverOpen) return "hover";
    if (inputs.isMediaPlaying) return "idleMedia";
  }
  return "idle";
}

function fileName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || path;
}

function isFresh(file: ShelfFile, now: number): boolean {
  return now - file.added_at < SHELF_FILE_TTL_MS;
}

function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return DEFAULT_SETTINGS.opacity;
  // Two decimals: the slider works in whole percents.
  return Math.round(Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, opacity)) * 100) / 100;
}

export const useNotchStore = create<NotchStore>()(
  persist(
    (set, get) => {
      /** Applies input changes and re-derives `state` in one update. */
      const applyInputs = (patch: Partial<StateInputs>) => {
        const current = get();
        const inputs: StateInputs = {
          isHoverOpen: current.isHoverOpen,
          isExpanded: current.isExpanded,
          isSettingsOpen: current.isSettingsOpen,
          isDragOver: current.isDragOver,
          isMediaPlaying: current.isMediaPlaying,
          settings: current.settings,
          ...patch,
        };
        const state = resolveState(inputs);
        set({
          ...inputs,
          state,
          previousState: state === current.state ? current.previousState : current.state,
        });
      };

      const patchSettings = (patch: Partial<AppSettings>) =>
        applyInputs({ settings: { ...get().settings, ...patch } });

      return {
        state: "idle",
        previousState: "idle",
        isHoverOpen: false,
        isExpanded: false,
        isSettingsOpen: false,
        isDragOver: false,
        isMediaPlaying: false,
        settings: DEFAULT_SETTINGS,

        isReady: false,
        isVisible: true,
        foreground: { is_fullscreen: false, is_window_maximized: false },
        uiScale: 1,

        systemInfo: null,
        volumeHoldUntil: 0,

        shelfFiles: [],
        scratchpadText: "",

        setHoverOpen: (open) => {
          if (open === get().isHoverOpen) return;
          applyInputs(open ? { isHoverOpen: true } : { isHoverOpen: false, isExpanded: false });
        },
        setMediaPlaying: (playing) => {
          if (playing !== get().isMediaPlaying) applyInputs({ isMediaPlaying: playing });
        },
        setExpanded: (expanded) => {
          if (expanded !== get().isExpanded) applyInputs({ isExpanded: expanded });
        },
        setDragOver: (over) => {
          if (over !== get().isDragOver) applyInputs({ isDragOver: over });
        },
        openSettings: () => {
          if (!get().isSettingsOpen) applyInputs({ isSettingsOpen: true, isExpanded: false });
        },
        closeSettings: () => {
          if (get().isSettingsOpen) applyInputs({ isSettingsOpen: false });
        },
        setVisible: (visible) => set({ isVisible: visible }),
        markReady: () => {
          if (!get().isReady) set({ isReady: true });
        },
        setForeground: (foreground) => {
          const current = get().foreground;
          if (
            current.is_fullscreen !== foreground.is_fullscreen ||
            current.is_window_maximized !== foreground.is_window_maximized
          ) {
            set({ foreground });
          }
        },
        setUiScale: (scale) => {
          if (scale !== get().uiScale) set({ uiScale: scale });
        },

        applySettings: (settings) =>
          applyInputs({
            // Rust already migrates and validates; normalizing again here
            // keeps the UI safe whatever arrives (and costs nothing when the
            // values are fine).
            settings: {
              ...settings,
              opacity: clampOpacity(settings.opacity),
              scale: normalizeScale(settings.scale, DEFAULT_SETTINGS.scale),
              glow_start: normalizeHex(settings.glow_start, GLOW_START_DEFAULT),
              glow_end: normalizeHex(settings.glow_end, GLOW_END_DEFAULT),
            },
          }),
        toggleDisplayMode: () =>
          patchSettings({
            display_mode: get().settings.display_mode === "island" ? "notch" : "island",
          }),
        setDisplayMode: (mode) => {
          if (mode !== get().settings.display_mode) patchSettings({ display_mode: mode });
        },
        setOpacity: (opacity) => {
          const next = clampOpacity(opacity);
          if (next !== get().settings.opacity) patchSettings({ opacity: next });
        },
        setScale: (scale) => {
          if (scale !== get().settings.scale) patchSettings({ scale });
        },
        setGlowColor: (which, color) => {
          if (!isHexColor(color)) return;
          const key = which === "start" ? "glow_start" : "glow_end";
          const next = color.toUpperCase();
          if (next !== get().settings[key]) patchSettings({ [key]: next });
        },
        resetGlowColors: () => {
          const { glow_start, glow_end } = get().settings;
          if (glow_start !== GLOW_START_DEFAULT || glow_end !== GLOW_END_DEFAULT) {
            patchSettings({ glow_start: GLOW_START_DEFAULT, glow_end: GLOW_END_DEFAULT });
          }
        },
        setWidgetActive: (widget, active) => {
          const widgets = get().settings.active_widgets;
          if (widgets[widget] !== active) {
            patchSettings({ active_widgets: { ...widgets, [widget]: active } });
          }
        },
        toggleDnd: () => patchSettings({ dnd_enabled: !get().settings.dnd_enabled }),

        setSystemInfo: (info) => {
          const { systemInfo, volumeHoldUntil } = get();
          if (systemInfo && Date.now() < volumeHoldUntil) {
            set({
              systemInfo: {
                ...info,
                volume_percent: systemInfo.volume_percent,
                is_muted: systemInfo.is_muted,
              },
            });
          } else {
            set({ systemInfo: info });
          }
        },
        setVolumeOptimistic: (percent) => {
          const { systemInfo } = get();
          if (!systemInfo) return;
          const volume = Math.min(100, Math.max(0, Math.round(percent)));
          set({
            systemInfo: {
              ...systemInfo,
              volume_percent: volume,
              is_muted: volume > 0 ? false : systemInfo.is_muted,
            },
            volumeHoldUntil: Date.now() + VOLUME_HOLD_MS,
          });
        },
        setMutedOptimistic: (muted) => {
          const { systemInfo } = get();
          if (!systemInfo) return;
          set({
            systemInfo: { ...systemInfo, is_muted: muted },
            volumeHoldUntil: Date.now() + VOLUME_HOLD_MS,
          });
        },

        addShelfFiles: (paths) => {
          const now = Date.now();
          const files = get().shelfFiles.filter((file) => isFresh(file, now));
          const known = new Set(files.map((file) => file.path.toLowerCase()));

          let added = 0;
          let rejected = 0;
          for (const path of paths) {
            const key = path.toLowerCase();
            if (known.has(key)) continue; // already on the shelf
            if (files.length >= SHELF_MAX_FILES) {
              rejected += 1;
              continue;
            }
            known.add(key);
            files.push({ id: crypto.randomUUID(), name: fileName(path), path, added_at: now });
            added += 1;
          }

          set({ shelfFiles: files });
          return { added, rejected };
        },
        removeShelfFile: (id) =>
          set({ shelfFiles: get().shelfFiles.filter((file) => file.id !== id) }),
        pruneExpiredShelfFiles: () => {
          const now = Date.now();
          const files = get().shelfFiles;
          const fresh = files.filter((file) => isFresh(file, now));
          if (fresh.length !== files.length) set({ shelfFiles: fresh });
        },

        setScratchpadText: (text) => set({ scratchpadText: text }),
      };
    },
    {
      name: "dynamic-island",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only user content lives in localStorage. Settings belong to Rust
      // (%APPDATA%\rn-notch\settings.json); everything else is live data.
      partialize: (store) => ({
        shelfFiles: store.shelfFiles,
        scratchpadText: store.scratchpadText,
      }),
      onRehydrateStorage: () => (store) => store?.pruneExpiredShelfFiles(),
    },
  ),
);
