import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type Alert, type HudReading, compareAlerts, hudAlert, isDuplicate } from "../lib/alerts";
import {
  ALERT_QUEUE_LIMIT,
  CLIPBOARD_MAX_CHARS,
  CLIPBOARD_MAX_ITEMS,
  DEFAULT_SETTINGS,
  GLOW_END_DEFAULT,
  GLOW_START_DEFAULT,
  OPACITY_MAX,
  OPACITY_MIN,
  POMODORO_BREAK_OPTIONS,
  POMODORO_FOCUS_OPTIONS,
  SHELF_FILE_TTL_MS,
  SHELF_MAX_FILES,
} from "../lib/constants";
import { colorFromText, isHexColor, normalizeHex } from "../lib/color";
import type { F1Race, F1Result } from "../lib/f1";
import { normalizeScale } from "../lib/scale";
import type {
  ActiveWidgets,
  AppSettings,
  ClipItem,
  Features,
  ForegroundState,
  NotchState,
  ScaleOption,
  ScheduleItem,
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
  /** A pop-up waits in the alert queue. */
  hasAlert: boolean;
  settings: AppSettings;
}

export type PomodoroPhase = "idle" | "focus" | "break";

export interface PomodoroState {
  phase: PomodoroPhase;
  /** When the running phase ends (epoch ms); null while paused or idle. */
  endsAt: number | null;
  /** Time left while paused, in ms. */
  pausedRemaining: number | null;
  /** Length of the current phase, in ms. */
  totalMs: number;
}

/** The latest race winner, with the portrait once it is fetched. */
export interface F1Winner extends F1Result {
  photo: string | null;
  teamLogo: string | null;
  /** The logo has had its background removed (see lib/logo.ts). */
  logoTransparent?: boolean;
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
  pomodoroFocusMin: number;
  pomodoroBreakMin: number;

  /** Pop-ups waiting, most important first; the first one is on screen. */
  alerts: Alert[];
  /** The AI shortcuts below the media controls are showing. */
  isDrawerOpen: boolean;
  /** The dashboard page shown (see `dashboardPages`). */
  dashboardPage: string;
  /** A screenshot or recording is being set up: the capsule steps aside. */
  isCapturing: boolean;
  /** A shelf file is being dragged out; our own window must not take it back. */
  isDraggingOut: boolean;
  /** Copied texts and colour codes, newest first. Memory only. */
  clipItems: ClipItem[];
  pomodoro: PomodoroState;
  /** The daily schedule, once loaded from Rust. */
  schedules: ScheduleItem[] | null;
  f1Schedule: F1Race[] | null;
  f1Status: "idle" | "loading" | "ready" | "error";
  f1Winner: F1Winner | null;
  /** A Snipping Tool recording RN Notch started, while it runs. */
  recording: { startedAt: number } | null;

  /**
   * Queues a pop-up. Dropped while the capsule is off screen, and under Do
   * Not Disturb unless it is a hardware warning or the user's own action.
   */
  pushAlert: (alert: Alert) => void;
  dismissAlert: (id: string) => void;
  /**
   * Shows the volume/brightness pill at once, ahead of anything waiting. A
   * pill already on screen for the same reading is updated in place (its
   * timer starts again), so holding a volume key never stacks pop-ups.
   */
  showHud: (hud: HudReading) => void;
  setRecording: (recording: { startedAt: number } | null) => void;
  /** Switches the neon border or the inner gradient (Settings). */
  setVisualEffect: (effect: "neon_border_enabled" | "inner_gradient_enabled", on: boolean) => void;
  /** Drops every pop-up (the capsule went off screen; they would be stale later). */
  clearAlerts: () => void;
  setDrawerOpen: (open: boolean) => void;
  setDashboardPage: (page: string) => void;
  setCapturing: (capturing: boolean) => void;
  setDraggingOut: (dragging: boolean) => void;
  setFeature: (feature: keyof Features, on: boolean) => void;
  addClip: (text: string) => void;
  removeClip: (id: string) => void;
  clearClips: () => void;
  startPomodoro: (phase?: Exclude<PomodoroPhase, "idle">) => void;
  pausePomodoro: () => void;
  resumePomodoro: () => void;
  resetPomodoro: () => void;
  setPomodoroMinutes: (which: "focus" | "break", minutes: number) => void;
  setSchedules: (items: ScheduleItem[]) => void;
  setF1: (patch: Partial<Pick<NotchStore, "f1Schedule" | "f1Status" | "f1Winner">>) => void;

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
 * which beats a pop-up, which beats hover, which beats idle. (Over the
 * settings panel and the dashboard a pop-up shows as a banner instead.)
 *
 * Do Not Disturb keeps the capsule from changing by itself: it neither widens
 * for music nor opens on hover. A click still opens the dashboard.
 */
function resolveState(inputs: StateInputs): NotchState {
  const { active_widgets: widgets, dnd_enabled: isQuiet } = inputs.settings;

  if (inputs.isDragOver && widgets.file_shelf) return "dragOver";
  if (inputs.isSettingsOpen) return "settings";
  if (inputs.isExpanded) return "expanded";
  if (inputs.hasAlert) return "alert";
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

function pickMinutes(value: unknown, options: readonly number[], fallback: number): number {
  return typeof value === "number" && options.includes(value) ? value : fallback;
}

/** Whether a pop-up may be shown now (see `pushAlert`). */
function admitsAlert(alert: Alert, store: NotchStore): boolean {
  const { foreground, isVisible, settings } = store;
  if (!isVisible || foreground.is_fullscreen || foreground.is_locked || store.isCapturing) {
    return false;
  }
  if (alert.kind === "notification" && !settings.features.notifications) return false;
  if (alert.kind === "hardware" && !settings.features.hardware_alerts) return false;
  if (alert.kind === "f1" && !settings.features.f1_hub) return false;
  // The user's own key press: shown under Do Not Disturb too.
  if (alert.kind === "hud") return settings.features.system_hud;
  if (settings.dnd_enabled) {
    return alert.kind === "toast" || (alert.kind === "hardware" && alert.tone === "warning");
  }
  return true;
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
          hasAlert: current.hasAlert,
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
        hasAlert: false,
        settings: DEFAULT_SETTINGS,

        isReady: false,
        isVisible: true,
        foreground: { is_fullscreen: false, is_window_maximized: false, is_locked: false },
        uiScale: 1,

        systemInfo: null,
        volumeHoldUntil: 0,

        shelfFiles: [],
        scratchpadText: "",
        pomodoroFocusMin: 25,
        pomodoroBreakMin: 5,

        alerts: [],
        isDrawerOpen: false,
        dashboardPage: "media",
        isCapturing: false,
        isDraggingOut: false,
        clipItems: [],
        pomodoro: { phase: "idle", endsAt: null, pausedRemaining: null, totalMs: 0 },
        schedules: null,
        f1Schedule: null,
        f1Status: "idle",
        f1Winner: null,
        recording: null,

        pushAlert: (alert) => {
          const store = get();
          if (!admitsAlert(alert, store)) return;
          const waiting = store.alerts;
          if (waiting.some((queued) => isDuplicate(queued, alert))) return;

          // The one on screen stays on screen; the rest are re-ordered, and
          // past the limit the least important waiting pop-ups are dropped.
          const [showing, ...rest] = waiting;
          const queue = [...rest, alert].sort(compareAlerts);
          const room = ALERT_QUEUE_LIMIT - (showing ? 1 : 0);
          const alerts = showing ? [showing, ...queue.slice(0, room)] : queue.slice(0, room);
          set({ alerts });
          applyInputs({ hasAlert: true });
        },
        showHud: (hud) => {
          const store = get();
          const alert = hudAlert(hud);
          if (!admitsAlert(alert, store)) return;
          const [showing, ...rest] = store.alerts;
          if (showing?.hud && alert.hud && showing.hud.kind === hud.kind) {
            const revision = showing.hud.revision + 1;
            set({ alerts: [{ ...showing, hud: { ...alert.hud, revision } }, ...rest] });
            return;
          }
          // Ahead of everything; a pop-up on screen goes back to waiting.
          const others = store.alerts.filter((queued) => queued.kind !== "hud");
          set({ alerts: [alert, ...others].slice(0, ALERT_QUEUE_LIMIT) });
          applyInputs({ hasAlert: true });
        },
        setRecording: (recording) => set({ recording }),
        setVisualEffect: (effect, on) => {
          if (get().settings[effect] !== on) patchSettings({ [effect]: on });
        },
        dismissAlert: (id) => {
          const alerts = get().alerts.filter((alert) => alert.id !== id);
          if (alerts.length === get().alerts.length) return;
          set({ alerts });
          applyInputs({ hasAlert: alerts.length > 0 });
        },
        clearAlerts: () => {
          if (get().alerts.length === 0) return;
          set({ alerts: [] });
          applyInputs({ hasAlert: false });
        },
        setDrawerOpen: (open) => {
          if (open !== get().isDrawerOpen) set({ isDrawerOpen: open });
        },
        setDashboardPage: (page) => {
          if (page !== get().dashboardPage) set({ dashboardPage: page });
        },
        setCapturing: (capturing) => {
          if (capturing !== get().isCapturing) set({ isCapturing: capturing });
        },
        setDraggingOut: (dragging) => {
          if (dragging !== get().isDraggingOut) set({ isDraggingOut: dragging });
        },
        setFeature: (feature, on) => {
          const features = get().settings.features;
          if (features[feature] !== on) patchSettings({ features: { ...features, [feature]: on } });
        },
        addClip: (text) => {
          // Entries are kept short: a whole copied document stays out of memory.
          const trimmed = text.trim().slice(0, CLIPBOARD_MAX_CHARS);
          if (!trimmed) return;
          // Copying something already in the list moves it to the top.
          const others = get().clipItems.filter((item) => item.text !== trimmed);
          const item: ClipItem = {
            id: crypto.randomUUID(),
            text: trimmed,
            color: colorFromText(trimmed),
            copied_at: Date.now(),
          };
          set({ clipItems: [item, ...others].slice(0, CLIPBOARD_MAX_ITEMS) });
        },
        removeClip: (id) => set({ clipItems: get().clipItems.filter((item) => item.id !== id) }),
        clearClips: () => set({ clipItems: [] }),
        startPomodoro: (phase = "focus") => {
          const minutes =
            phase === "focus"
              ? pickMinutes(get().pomodoroFocusMin, POMODORO_FOCUS_OPTIONS, 25)
              : pickMinutes(get().pomodoroBreakMin, POMODORO_BREAK_OPTIONS, 5);
          const totalMs = minutes * 60_000;
          set({ pomodoro: { phase, endsAt: Date.now() + totalMs, pausedRemaining: null, totalMs } });
        },
        pausePomodoro: () => {
          const { pomodoro } = get();
          if (pomodoro.phase === "idle" || pomodoro.endsAt === null) return;
          set({
            pomodoro: {
              ...pomodoro,
              endsAt: null,
              pausedRemaining: Math.max(0, pomodoro.endsAt - Date.now()),
            },
          });
        },
        resumePomodoro: () => {
          const { pomodoro } = get();
          if (pomodoro.phase === "idle" || pomodoro.pausedRemaining === null) return;
          set({
            pomodoro: {
              ...pomodoro,
              endsAt: Date.now() + pomodoro.pausedRemaining,
              pausedRemaining: null,
            },
          });
        },
        resetPomodoro: () =>
          set({ pomodoro: { phase: "idle", endsAt: null, pausedRemaining: null, totalMs: 0 } }),
        setPomodoroMinutes: (which, minutes) => {
          if (which === "focus") {
            set({ pomodoroFocusMin: pickMinutes(minutes, POMODORO_FOCUS_OPTIONS, 25) });
          } else {
            set({ pomodoroBreakMin: pickMinutes(minutes, POMODORO_BREAK_OPTIONS, 5) });
          }
        },
        setSchedules: (items) => set({ schedules: items }),
        setF1: (patch) => set(patch),

        setHoverOpen: (open) => {
          if (open === get().isHoverOpen) return;
          if (!open) set({ isDrawerOpen: false });
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
          const next = { ...foreground, is_locked: foreground.is_locked ?? false };
          if (
            current.is_fullscreen !== next.is_fullscreen ||
            current.is_window_maximized !== next.is_window_maximized ||
            current.is_locked !== next.is_locked
          ) {
            set({ foreground: next });
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
              neon_border_enabled: settings.neon_border_enabled ?? DEFAULT_SETTINGS.neon_border_enabled,
              inner_gradient_enabled: settings.inner_gradient_enabled ?? DEFAULT_SETTINGS.inner_gradient_enabled,
              features: { ...DEFAULT_SETTINGS.features, ...settings.features },
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
        pomodoroFocusMin: store.pomodoroFocusMin,
        pomodoroBreakMin: store.pomodoroBreakMin,
      }),
      onRehydrateStorage: () => (store) => store?.pruneExpiredShelfFiles(),
    },
  ),
);
