/** Mirrors the Rust `MediaInfo` struct in `src-tauri/src/commands/media.rs`. */
export interface MediaInfo {
  title: string;
  artist: string;
  album: string;
  /** `data:` URL of the cover art, or null when the track has none. */
  album_art_url: string | null;
  /** Identifies the current cover art; changes when the art changes. */
  album_art_id: string | null;
  is_playing: boolean;
  position_ms: number;
  duration_ms: number;
  /** Friendly name of the app that owns the session, e.g. "Spotify". */
  source: string;
  /** Whether the app accepts a new playback position. */
  can_seek: boolean;
  /** Shuffle on or off; null when the app does not offer shuffle. */
  shuffle: boolean | null;
  /** Repeat mode; null when the app does not offer repeat. */
  repeat: RepeatMode | null;
}

export type RepeatMode = "none" | "track" | "list";

/** Mirrors the Rust `SystemInfo` struct in `src-tauri/src/commands/system.rs`. */
export interface SystemInfo {
  /** 0-100, or null on a machine without a battery. */
  battery_percent: number | null;
  is_charging: boolean;
  is_ac_connected: boolean;
  /** 0-100, averaged over all cores. */
  cpu_usage_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  /** 0-100, or null when there is no audio output device. */
  volume_percent: number | null;
  is_muted: boolean;
}

/** A file parked on the shelf. Only its path is kept, never its contents. */
export interface ShelfFile {
  id: string;
  name: string;
  path: string;
  /** Unix timestamp (ms) of when the file was dropped. */
  added_at: number;
}

/**
 * How the capsule sits on the screen.
 * - `island`: floats 8px below the top edge, a full pill (iPhone style).
 * - `notch`: flush with the top edge, flat on top, rounded below (MacBook style).
 */
export type DisplayMode = "island" | "notch";

/**
 * Size of the capsule: "auto" follows the monitor, the others are fixed
 * percentages of the base size. Matches the Rust `SizeScale` enum.
 */
export type ScaleOption = "auto" | "100" | "115" | "130" | "150";

/** Which widgets are shown. Keys match the Rust `ActiveWidgets` struct. */
export interface ActiveWidgets {
  media: boolean;
  system: boolean;
  file_shelf: boolean;
  scratchpad: boolean;
}

/**
 * Mirrors the Rust `AppSettings` struct in `src-tauri/src/commands/settings.rs`.
 * Stored at `%APPDATA%\rn-notch\settings.json`.
 */
export interface AppSettings {
  display_mode: DisplayMode;
  /** Opacity of the capsule background, 0.7-1.0. */
  opacity: number;
  /** Size of the capsule. */
  scale: ScaleOption;
  /** The two colours of the glow inside the capsule, as "#RRGGBB". */
  glow_start: string;
  glow_end: string;
  active_widgets: ActiveWidgets;
  dnd_enabled: boolean;
  /** Optional modules; each one's background work stops when it is off. */
  features: Features;
}

/** Keys match the Rust `Features` struct. */
export interface Features {
  notifications: boolean;
  hardware_alerts: boolean;
  clipboard_history: boolean;
  audio_mixer: boolean;
  f1_hub: boolean;
}

/** Mirrors the Rust `ForegroundState` struct in `src-tauri/src/commands/window_detector.rs`. */
export interface ForegroundState {
  /** A fullscreen app (game, fullscreen video, slide show) is in front. */
  is_fullscreen: boolean;
  /**
   * An app window's title bar is under the capsule: the window is maximized,
   * or snapped along the top edge beneath it (typically a browser).
   */
  is_window_maximized: boolean;
  /** The lock screen is up. */
  is_locked: boolean;
}

/**
 * Visual states of the capsule. `alert` shows the pop-up at the head of the
 * alert queue (a notification, a hardware change, an F1 card, a toast).
 */
export type NotchState =
  | "idle"
  | "idleMedia"
  | "hover"
  | "expanded"
  | "settings"
  | "dragOver"
  | "alert";

/** Mirrors the Rust `AppNotification` (commands/notifications.rs). */
export interface AppNotification {
  id: number;
  app: string;
  app_id: string | null;
  title: string;
  body: string;
  icon: string | null;
}

/** Mirrors the Rust `HardwareAlert` (commands/hardware.rs). */
export interface HardwareAlert {
  kind: "wifi" | "bluetooth" | "display" | "battery" | "charging";
  title: string;
  detail: string;
  tone: "info" | "success" | "warning";
  percent: number | null;
}

/** Mirrors the Rust `ScheduleItem` (commands/schedules.rs). */
export interface ScheduleItem {
  id: string;
  title: string;
  /** "HH:MM", 24-hour. */
  time: string;
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** The last day it was ticked off, "YYYY-MM-DD". */
  done_on: string | null;
}

/** Mirrors the Rust `OutputDevice` (commands/mixer.rs). */
export interface OutputDevice {
  id: string;
  name: string;
  is_default: boolean;
}

/** Mirrors the Rust `AudioApp` (commands/mixer.rs). */
export interface AudioApp {
  pid: number;
  name: string;
  volume: number;
  muted: boolean;
  icon: string | null;
}

/** Mirrors the Rust `AiShortcut` (commands/apps.rs). */
export interface AiShortcut {
  id: "claude" | "chatgpt" | "gemini";
  name: string;
  installed: boolean;
  icon: string | null;
}

/** A text or colour code copied anywhere in Windows (kept in memory only). */
export interface ClipItem {
  id: string;
  text: string;
  /** "#RRGGBB" when the text is a colour code. */
  color: string | null;
  copied_at: number;
}
