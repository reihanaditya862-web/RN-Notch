//! User settings, kept in memory and persisted as JSON at
//! `%APPDATA%\rn-notch\settings.json`.
//!
//! Rust owns the settings: the frontend loads them once, sends every change
//! back through `save_settings`, and is told about changes made elsewhere
//! (the tray menu) through the `settings-changed` event.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::tray;

/// Emitted with the full settings whenever Rust changes them by itself.
pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

/// Folder (inside `%APPDATA%`) and file the settings are stored in.
pub const SETTINGS_DIR: &str = "rn-notch";
pub const SETTINGS_FILE: &str = "settings.json";

pub const OPACITY_MIN: f32 = 0.7;
pub const OPACITY_MAX: f32 = 1.0;
pub const OPACITY_DEFAULT: f32 = 0.95;

/// How the capsule sits on the screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DisplayMode {
    /// Floating pill with a gap above it, like the iPhone's Dynamic Island.
    #[default]
    Island,
    /// Flush with the top edge, flat on top, like a MacBook notch.
    Notch,
}

impl DisplayMode {
    pub fn toggled(self) -> Self {
        match self {
            Self::Island => Self::Notch,
            Self::Notch => Self::Island,
        }
    }
}

/// Size of the capsule. `Auto` follows the monitor (decided by the frontend);
/// the others are fixed percentages of the base size.
///
/// Stored as text: "auto", "100", "115", "130" or "150".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub enum SizeScale {
    #[default]
    Auto,
    Percent100,
    Percent115,
    Percent130,
    Percent150,
}

impl SizeScale {
    /// Reads a stored value, including the two sizes offered before 1.1:
    /// "125" is now "130" and "175" is now "150". Mapping them here, on every
    /// read, means an old settings file keeps working however often it is
    /// loaded, and is rewritten with the new value on the next save.
    pub fn parse(text: &str) -> Option<Self> {
        match text.trim() {
            "auto" => Some(Self::Auto),
            "100" => Some(Self::Percent100),
            "115" => Some(Self::Percent115),
            "130" | "125" => Some(Self::Percent130),
            "150" | "175" => Some(Self::Percent150),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Percent100 => "100",
            Self::Percent115 => "115",
            Self::Percent130 => "130",
            Self::Percent150 => "150",
        }
    }
}

impl TryFrom<String> for SizeScale {
    type Error = String;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        Self::parse(&text).ok_or_else(|| format!("unknown scale: {text}"))
    }
}

impl From<SizeScale> for String {
    fn from(scale: SizeScale) -> Self {
        scale.as_str().to_string()
    }
}

/// An opaque colour, stored as "#RRGGBB".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct HexColor {
    red: u8,
    green: u8,
    blue: u8,
}

impl HexColor {
    pub const fn new(red: u8, green: u8, blue: u8) -> Self {
        Self { red, green, blue }
    }

    /// Accepts exactly "#RRGGBB" (either case).
    pub fn parse(text: &str) -> Option<Self> {
        let digits = text.trim().strip_prefix('#')?;
        if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let channel = |start: usize| u8::from_str_radix(&digits[start..start + 2], 16).ok();
        Some(Self::new(channel(0)?, channel(2)?, channel(4)?))
    }
}

impl TryFrom<String> for HexColor {
    type Error = String;

    fn try_from(text: String) -> Result<Self, Self::Error> {
        Self::parse(&text).ok_or_else(|| format!("not a #RRGGBB colour: {text}"))
    }
}

impl From<HexColor> for String {
    fn from(color: HexColor) -> Self {
        format!("#{:02X}{:02X}{:02X}", color.red, color.green, color.blue)
    }
}

/// Default inner glow: Google blue to purple.
pub const GLOW_START_DEFAULT: HexColor = HexColor::new(0x42, 0x85, 0xF4);
pub const GLOW_END_DEFAULT: HexColor = HexColor::new(0x9B, 0x51, 0xE0);

/// Which widgets are shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveWidgets {
    pub media: bool,
    pub system: bool,
    pub file_shelf: bool,
    pub scratchpad: bool,
}

impl Default for ActiveWidgets {
    fn default() -> Self {
        Self {
            media: true,
            system: true,
            file_shelf: true,
            scratchpad: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AppSettings {
    pub display_mode: DisplayMode,
    /// Opacity of the capsule background, 0.7-1.0.
    pub opacity: f32,
    /// Size of the capsule: "auto", "100", "115", "130" or "150".
    pub scale: SizeScale,
    /// The two colours of the glow inside the capsule, as "#RRGGBB".
    pub glow_start: HexColor,
    pub glow_end: HexColor,
    pub active_widgets: ActiveWidgets,
    pub dnd_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            display_mode: DisplayMode::default(),
            opacity: OPACITY_DEFAULT,
            scale: SizeScale::default(),
            glow_start: GLOW_START_DEFAULT,
            glow_end: GLOW_END_DEFAULT,
            active_widgets: ActiveWidgets::default(),
            dnd_enabled: false,
        }
    }
}

impl AppSettings {
    /// Forces every value into its valid range.
    pub fn sanitized(mut self) -> Self {
        self.opacity = if self.opacity.is_finite() {
            self.opacity.clamp(OPACITY_MIN, OPACITY_MAX)
        } else {
            OPACITY_DEFAULT
        };
        self
    }

    /// Reads settings from JSON text, field by field.
    ///
    /// A missing or invalid field falls back to its default without throwing
    /// away the rest, and text that is not JSON at all yields the defaults.
    /// A hand-edited or half-written file can therefore never stop the app.
    pub fn from_json(text: &str) -> Self {
        let defaults = Self::default();
        let Ok(root) = serde_json::from_str::<Value>(text) else {
            return defaults;
        };

        let widgets = root.get("active_widgets");
        let widget = |key: &str, fallback: bool| {
            widgets
                .and_then(|w| w.get(key))
                .and_then(Value::as_bool)
                .unwrap_or(fallback)
        };
        // A settings file from before the colours existed simply has no such
        // keys, and gets the default blue-to-purple.
        let color = |key: &str, fallback: HexColor| {
            root.get(key)
                .and_then(Value::as_str)
                .and_then(HexColor::parse)
                .unwrap_or(fallback)
        };

        Self {
            display_mode: root
                .get("display_mode")
                .and_then(|value| serde_json::from_value(value.clone()).ok())
                .unwrap_or(defaults.display_mode),
            opacity: root
                .get("opacity")
                .and_then(Value::as_f64)
                .map(|value| value as f32)
                .unwrap_or(defaults.opacity),
            scale: root
                .get("scale")
                .and_then(Value::as_str)
                .and_then(SizeScale::parse)
                .unwrap_or(defaults.scale),
            glow_start: color("glow_start", defaults.glow_start),
            glow_end: color("glow_end", defaults.glow_end),
            active_widgets: ActiveWidgets {
                media: widget("media", defaults.active_widgets.media),
                system: widget("system", defaults.active_widgets.system),
                file_shelf: widget("file_shelf", defaults.active_widgets.file_shelf),
                scratchpad: widget("scratchpad", defaults.active_widgets.scratchpad),
            },
            dnd_enabled: root
                .get("dnd_enabled")
                .and_then(Value::as_bool)
                .unwrap_or(defaults.dnd_enabled),
        }
        .sanitized()
    }
}

/// Loads the settings file; any problem (no file yet, unreadable, corrupt)
/// results in defaults.
fn read_file(path: &Path) -> AppSettings {
    match fs::read_to_string(path) {
        Ok(text) => AppSettings::from_json(&text),
        Err(_) => AppSettings::default(),
    }
}

/// Writes the settings file, creating its folder when needed.
///
/// The JSON goes to a temporary file first and is then renamed over the real
/// one, so a crash mid-write cannot leave a truncated settings file behind.
fn write_file(path: &Path, settings: &AppSettings) -> io::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }

    let json = serde_json::to_string_pretty(settings).map_err(io::Error::other)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, json)?;
    fs::rename(&temporary, path)
}

/// The settings shared by commands, the tray and the frontend.
pub struct SettingsState {
    path: PathBuf,
    current: Mutex<AppSettings>,
}

impl SettingsState {
    /// Reads the settings stored at `path`.
    pub fn load(path: PathBuf) -> Self {
        let current = Mutex::new(read_file(&path));
        Self { path, current }
    }

    pub fn get(&self) -> AppSettings {
        *self.current.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Replaces the settings and writes them to disk. Returns what was
    /// actually stored (after sanitizing).
    ///
    /// The new values apply in memory even when the file cannot be written.
    fn replace(&self, settings: AppSettings) -> Result<AppSettings, String> {
        let settings = settings.sanitized();
        *self.current.lock().unwrap_or_else(PoisonError::into_inner) = settings;

        write_file(&self.path, &settings).map_err(|error| {
            format!(
                "failed to save settings to {}: {error}",
                self.path.display()
            )
        })?;
        Ok(settings)
    }
}

/// Changes the settings from the Rust side (tray menu), saves them and tells
/// the frontend.
pub fn update<F>(app: &AppHandle, change: F)
where
    F: FnOnce(&mut AppSettings),
{
    let state = app.state::<SettingsState>();
    let mut settings = state.get();
    change(&mut settings);

    let settings = match state.replace(settings) {
        Ok(saved) => saved,
        Err(error) => {
            eprintln!("{error}");
            state.get()
        }
    };

    tray::sync(app, &settings);
    let _ = app.emit(SETTINGS_CHANGED_EVENT, settings);
}

/// Returns the current settings.
#[tauri::command]
pub fn load_settings(state: State<'_, SettingsState>) -> AppSettings {
    state.get()
}

/// Stores new settings and writes `%APPDATA%\rn-notch\settings.json`.
/// Returns the settings as stored.
#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let result = state.replace(settings);
    // The in-memory settings changed either way; keep the tray in step.
    tray::sync(&app, &state.get());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_survive_a_json_round_trip() {
        let settings = AppSettings::default();
        let json = serde_json::to_string(&settings).unwrap();
        assert_eq!(AppSettings::from_json(&json), settings);
    }

    #[test]
    fn display_mode_is_stored_as_lowercase_text() {
        let json = serde_json::to_value(AppSettings {
            display_mode: DisplayMode::Notch,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(json["display_mode"], "notch");
        assert_eq!(DisplayMode::Notch.toggled(), DisplayMode::Island);
        assert_eq!(DisplayMode::Island.toggled(), DisplayMode::Notch);
    }

    #[test]
    fn scale_is_stored_as_auto_or_a_percentage() {
        let json = serde_json::to_value(AppSettings {
            scale: SizeScale::Percent130,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(json["scale"], "130");
        assert_eq!(serde_json::to_value(SizeScale::Auto).unwrap(), "auto");

        for (text, scale) in [
            ("auto", SizeScale::Auto),
            ("100", SizeScale::Percent100),
            ("115", SizeScale::Percent115),
            ("130", SizeScale::Percent130),
            ("150", SizeScale::Percent150),
        ] {
            let settings = AppSettings::from_json(&format!(r#"{{ "scale": "{text}" }}"#));
            assert_eq!(settings.scale, scale, "reading {text}");
            assert_eq!(scale.as_str(), text);
        }

        // Unknown or malformed values fall back to Auto.
        assert_eq!(AppSettings::from_json(r#"{ "scale": "300" }"#).scale, SizeScale::Auto);
        assert_eq!(AppSettings::from_json(r#"{ "scale": 130 }"#).scale, SizeScale::Auto);
        // A settings file written before the option existed.
        assert_eq!(
            AppSettings::from_json(r#"{ "display_mode": "notch", "opacity": 1.0 }"#).scale,
            SizeScale::Auto
        );
    }

    #[test]
    fn retired_scales_are_migrated_without_touching_other_choices() {
        let old = r##"{
            "display_mode": "notch",
            "opacity": 0.8,
            "scale": "125",
            "active_widgets": { "media": true, "system": false, "file_shelf": true, "scratchpad": true },
            "dnd_enabled": true
        }"##;

        let migrated = AppSettings::from_json(old);
        assert_eq!(migrated.scale, SizeScale::Percent130);
        assert_eq!(
            AppSettings::from_json(r#"{ "scale": "175" }"#).scale,
            SizeScale::Percent150
        );

        // Everything else the user had chosen is still there.
        assert_eq!(migrated.display_mode, DisplayMode::Notch);
        assert_eq!(migrated.opacity, 0.8);
        assert!(!migrated.active_widgets.system);
        assert!(migrated.dnd_enabled);

        // Reading the migrated settings again changes nothing more.
        let saved = serde_json::to_string(&migrated).unwrap();
        assert!(saved.contains(r#""scale":"130""#));
        assert_eq!(AppSettings::from_json(&saved), migrated);
        // The frontend may also still send a retired value; it maps the same way.
        assert_eq!(
            serde_json::from_str::<SizeScale>(r#""175""#).unwrap(),
            SizeScale::Percent150
        );
    }

    #[test]
    fn glow_colours_are_stored_as_hex_and_default_to_blue_and_purple() {
        // Settings written before the colours existed.
        let old = AppSettings::from_json(r#"{ "display_mode": "notch", "scale": "100" }"#);
        assert_eq!(old.glow_start, GLOW_START_DEFAULT);
        assert_eq!(old.glow_end, GLOW_END_DEFAULT);

        let json = serde_json::to_value(AppSettings::default()).unwrap();
        assert_eq!(json["glow_start"], "#4285F4");
        assert_eq!(json["glow_end"], "#9B51E0");

        let custom = AppSettings::from_json(r##"{ "glow_start": "#ff8800", "glow_end": "#00C2A8" }"##);
        assert_eq!(custom.glow_start, HexColor::new(0xFF, 0x88, 0x00));
        assert_eq!(custom.glow_end, HexColor::new(0x00, 0xC2, 0xA8));
        assert_eq!(String::from(custom.glow_start), "#FF8800");

        // One bad colour falls back alone; the other one is kept.
        let partly = AppSettings::from_json(r##"{ "glow_start": "red", "glow_end": "#123456" }"##);
        assert_eq!(partly.glow_start, GLOW_START_DEFAULT);
        assert_eq!(partly.glow_end, HexColor::new(0x12, 0x34, 0x56));
    }

    #[test]
    fn hex_colours_must_be_exactly_six_digits() {
        assert_eq!(HexColor::parse("#000000"), Some(HexColor::new(0, 0, 0)));
        assert_eq!(HexColor::parse(" #AbCdEf "), Some(HexColor::new(0xAB, 0xCD, 0xEF)));
        for bad in ["", "#fff", "4285F4", "#4285F", "#4285F4AA", "#GGGGGG", "#12 456"] {
            assert_eq!(HexColor::parse(bad), None, "{bad:?} must be rejected");
        }
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings = AppSettings::from_json(r#"{ "display_mode": "notch" }"#);
        assert_eq!(settings.display_mode, DisplayMode::Notch);
        assert_eq!(settings.opacity, OPACITY_DEFAULT);
        assert_eq!(settings.active_widgets, ActiveWidgets::default());
        assert!(!settings.dnd_enabled);
    }

    #[test]
    fn one_invalid_field_does_not_discard_the_others() {
        let settings = AppSettings::from_json(
            r#"{
                "display_mode": "sideways",
                "opacity": "very",
                "active_widgets": { "media": false, "system": "yes" },
                "dnd_enabled": true
            }"#,
        );
        assert_eq!(settings.display_mode, DisplayMode::Island);
        assert_eq!(settings.opacity, OPACITY_DEFAULT);
        assert!(!settings.active_widgets.media);
        assert!(settings.active_widgets.system);
        assert!(settings.dnd_enabled);
    }

    #[test]
    fn corrupt_text_yields_defaults() {
        assert_eq!(AppSettings::from_json(""), AppSettings::default());
        assert_eq!(AppSettings::from_json("{ not json"), AppSettings::default());
        assert_eq!(AppSettings::from_json("[1, 2, 3]"), AppSettings::default());
    }

    #[test]
    fn opacity_is_clamped() {
        assert_eq!(AppSettings::from_json(r#"{ "opacity": 0.1 }"#).opacity, OPACITY_MIN);
        assert_eq!(AppSettings::from_json(r#"{ "opacity": 7 }"#).opacity, OPACITY_MAX);
        assert_eq!(AppSettings::from_json(r#"{ "opacity": 0.8 }"#).opacity, 0.8);

        let weird = AppSettings {
            opacity: f32::NAN,
            ..Default::default()
        };
        assert_eq!(weird.sanitized().opacity, OPACITY_DEFAULT);
    }

    #[test]
    fn saving_creates_the_folder_and_loading_reads_it_back() {
        let folder = std::env::temp_dir().join(format!("rn-notch-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        let path = folder.join("nested").join(SETTINGS_FILE);

        // No file yet: defaults.
        let state = SettingsState::load(path.clone());
        assert_eq!(state.get(), AppSettings::default());

        let wanted = AppSettings {
            display_mode: DisplayMode::Notch,
            opacity: 0.8,
            scale: SizeScale::Percent150,
            glow_start: HexColor::new(0xFF, 0x88, 0x00),
            glow_end: HexColor::new(0x00, 0xC2, 0xA8),
            active_widgets: ActiveWidgets {
                file_shelf: false,
                ..Default::default()
            },
            dnd_enabled: true,
        };
        assert_eq!(state.replace(wanted), Ok(wanted));
        assert!(path.exists());
        assert!(!path.with_extension("json.tmp").exists());

        // A fresh state reads the same values back from disk.
        assert_eq!(SettingsState::load(path).get(), wanted);

        let _ = fs::remove_dir_all(&folder);
    }
}
