//! "Start with Windows", through `tauri-plugin-autostart`.
//!
//! The switch is not kept in settings.json: Windows' own startup entry is the
//! single source of truth, so it stays correct even if the user removes the
//! entry from Task Manager. The tray and the settings panel both read and
//! write it through this module, and hear about changes through the
//! `autostart-changed` event.

use tauri::{AppHandle, Emitter};
use tauri_plugin_autostart::ManagerExt;

use crate::tray;

/// Emitted with `true` / `false` whenever the startup entry is switched.
pub const AUTOSTART_EVENT: &str = "autostart-changed";

/// Whether the app is registered to start with Windows.
pub fn is_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Adds or removes the startup entry, then brings the tray and the frontend
/// in line. Returns the state actually in effect afterwards.
pub fn set_enabled(app: &AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };

    // Report what Windows really holds now, whether or not the change worked.
    let actual = is_enabled(app);
    tray::sync_autostart(app, actual);
    let _ = app.emit(AUTOSTART_EVENT, actual);

    result
        .map(|()| actual)
        .map_err(|error| format!("failed to change the startup entry: {error}"))
}

/// Returns whether the app starts with Windows.
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    is_enabled(&app)
}

/// Switches "Start with Windows" on or off. Returns the resulting state.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    set_enabled(&app, enabled)
}
