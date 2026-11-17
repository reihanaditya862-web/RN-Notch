import type { Transition } from "framer-motion";
import type { AppSettings, NotchState, ScaleOption } from "./types";

/** Name shown to the user. */
export const APP_NAME = "RN Notch";

/** Island mode: gap between the top edge of the screen and the capsule, in px. */
export const ISLAND_TOP_OFFSET = 8;

/**
 * Retracted: while an app window (a maximized browser) is under the capsule
 * and the cursor is elsewhere, the capsule pulls up into the top edge until
 * only a lip of this height is left. In real screen pixels - it does not grow
 * with the user's size setting.
 */
export const LIP_HEIGHT_PX = 5;

/** Notch mode: radius of the two bottom corners, in px. */
export const NOTCH_BOTTOM_RADIUS = 16;

/**
 * Notch mode: radius of the two "ears", the concave curves that flare out
 * from the top corners into the screen edge, like a MacBook's hardware notch.
 */
export const NOTCH_EAR_RADIUS = 12;

/**
 * Sizes the user can pick, in the order they are offered. Settings and the
 * context menu both render this list.
 */
export const SCALE_OPTIONS: ReadonlyArray<{ value: ScaleOption; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "100", label: "100%" },
  { value: "115", label: "115%" },
  { value: "130", label: "130%" },
  { value: "150", label: "150%" },
];

/**
 * Sizes offered by earlier versions and what they become. Rust applies the
 * same mapping when it reads settings.json.
 */
export const RETIRED_SCALES: Readonly<Record<string, ScaleOption>> = {
  "125": "130",
  "175": "150",
};

/** Default inner glow: Google blue to purple. */
export const GLOW_START_DEFAULT = "#4285F4";
export const GLOW_END_DEFAULT = "#9B51E0";

/** Neon outline colour while nothing with a cover is playing (see useAlbumAccent). */
export const NEON_IDLE_COLOR = "#FFFFFF";

/**
 * "Auto" scales with the screen: 1.0 on a 1920px-wide desktop, never smaller
 * than `min` or larger than `max`.
 */
export const AUTO_SCALE = { referenceWidth: 1920, min: 0.85, max: 1.5 } as const;

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
  idle: { width: 196, height: 28, radius: 14 },
  idleMedia: { width: 280, height: 28, radius: 14 },
  hover: { width: 360, height: 100, radius: 16 },
  expanded: { width: 420, height: 280, radius: 24 },
  settings: { width: 420, height: 380, radius: 24 },
  dragOver: { width: 340, height: 100, radius: 24 },
};

/** Settings used until the real ones arrive from Rust; same values as its defaults. */
export const DEFAULT_SETTINGS: AppSettings = {
  display_mode: "island",
  opacity: 0.95,
  scale: "auto",
  glow_start: GLOW_START_DEFAULT,
  glow_end: GLOW_END_DEFAULT,
  active_widgets: { media: true, system: true, file_shelf: true, scratchpad: true },
  dnd_enabled: false,
};

export const OPACITY_MIN = 0.7;
export const OPACITY_MAX = 1;

/** A burst of setting changes is written to disk once, this long after the last one. */
export const SETTINGS_SAVE_DEBOUNCE_MS = 300;

/** Battery saver starts below this level while running on battery. */
export const BATTERY_SAVER_THRESHOLD = 20;

/** Below this level (on battery) the battery is shown in red. */
export const BATTERY_LOW_THRESHOLD = 15;

/** Battery saver stretches every polling interval by this factor. */
export const BATTERY_SAVER_POLL_FACTOR = 2;

/** How long the capsule takes to fade out when a fullscreen app takes over, in s. */
export const VISIBILITY_FADE_S = 0.3;

/**
 * Pop-in when the capsule returns (the game was minimized, the fullscreen
 * video ended): a lively spring that overshoots and settles.
 */
export const SPRING_ENTRANCE: Transition = {
  type: "spring",
  stiffness: 450,
  damping: 22,
};

/** Island mode pop-in: the capsule drops in from this far above, at this scale. */
export const ENTRANCE_OFFSET_Y = -30;
export const ENTRANCE_SCALE_KEYFRAMES = [0.85, 1.05, 1];

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

/**
 * Enter delay for the retracted lip. A little longer, because the lip lies
 * along the top edge of another app's tab strip: a deliberate rest of the
 * cursor opens the pop-up, a pass on the way to a tab does not.
 */
export const HOVER_ENTER_DELAY_LIP_MS = 250;

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
