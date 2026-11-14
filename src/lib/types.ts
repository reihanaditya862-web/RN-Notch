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
}

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

/** Visual states of the capsule implemented so far. */
export type NotchState = "idle" | "idleMedia" | "hover" | "expanded" | "dragOver";
