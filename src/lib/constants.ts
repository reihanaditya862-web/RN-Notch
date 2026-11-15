import type { Transition } from "framer-motion";
import type { AppSettings, NotchState } from "./types";

/** Name shown to the user. */
export const APP_NAME = "RN Notch";

/** Island mode: gap between the top edge of the screen and the capsule, in px. */
export const ISLAND_TOP_OFFSET = 8;

/** Notch mode: radius of the two bottom corners, in px (the top is flat). */
export const NOTCH_BOTTOM_RADIUS = 16;

/**
 * Base capsule geometry per state, in px. `radius` is the island-mode radius;
 * the final shape for a mode comes from `getNotchShape` in `lib/layout.ts`.
 *
 * The collapsed states are kept slim (28px) so the capsule covers as little
 * as possible of a maximized window's tab strip or title bar.
 * The Tauri window (see tauri.conf.json) must stay large enough for the
 * biggest state plus its shadow.
 */
export const NOTCH_SIZES: Record<NotchState, { width: number; height: number; radius: number }> = {
  idle: { width: 180, height: 28, radius: 14 },
  idleMedia: { width: 280, height: 28, radius: 14 },
  hover: { width: 360, height: 100, radius: 16 },
  expanded: { width: 420, height: 280, radius: 24 },
  settings: { width: 420, height: 276, radius: 24 },
  dragOver: { width: 340, height: 100, radius: 24 },
};

/** Settings used until the real ones arrive from Rust; same values as its defaults. */
export const DEFAULT_SETTINGS: AppSettings = {
  display_mode: "island",
  opacity: 0.95,
  active_widgets: { media: true, system: true, file_shelf: true, scratchpad: true },
  dnd_enabled: false,
};

export const OPACITY_MIN = 0.7;
export const OPACITY_MAX = 1;

/** A burst of setting changes is written to disk once, this long after the last one. */
export const SETTINGS_SAVE_DEBOUNCE_MS = 300;

/** Growing: a touch of overshoot, settles quickly. */
export const SPRING_EXPAND: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 30,
  mass: 0.8,
};

/** Opening the dashboard: slightly softer, it travels further. */
export const SPRING_EXPANDED: Transition = {
  type: "spring",
  stiffness: 350,
  damping: 28,
  mass: 0.8,
};

/** Shrinking: lighter mass, so collapsing is faster than expanding. */
export const SPRING_COLLAPSE: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 35,
  mass: 0.6,
};

/** Used instead of the springs when the OS asks for reduced motion. */
export const TWEEN_REDUCED: Transition = {
  type: "tween",
  duration: 0.15,
  ease: "easeOut",
};

/** Anti-flicker hover delays, in ms. */
export const HOVER_ENTER_DELAY_MS = 150;
export const HOVER_LEAVE_DELAY_MS = 600;

/** Media polling intervals, in ms. */
export const MEDIA_POLL_IDLE_MS = 1000;
export const MEDIA_POLL_HOVER_MS = 500;

/** System info (battery, CPU, RAM, volume) polling intervals, in ms. */
export const SYSTEM_POLL_IDLE_MS = 5000;
export const SYSTEM_POLL_EXPANDED_MS = 2000;

/** File shelf limits. */
export const SHELF_MAX_FILES = 5;
export const SHELF_FILE_TTL_MS = 30 * 60 * 1000;

/** Shadow under the expanded capsule; the idle capsule has none. */
export const SHADOW_NONE = "0px 8px 32px rgba(0, 0, 0, 0), 0px 2px 8px rgba(0, 0, 0, 0)";
export const SHADOW_RAISED = "0px 8px 32px rgba(0, 0, 0, 0.5), 0px 2px 8px rgba(0, 0, 0, 0.3)";
