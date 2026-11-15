//! System tray icon and its menu.
//!
//! Left click on the icon shows or hides the capsule. Right click opens the
//! menu: Show/Hide, Switch Mode, Settings, Reset Position, Quit.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::commands::settings::{self, AppSettings, DisplayMode};
use crate::{APP_NAME, NOTCH_LABEL, center_top};

const TRAY_ID: &str = "main";

const ID_TOGGLE_VISIBILITY: &str = "toggle_visibility";
const ID_SWITCH_MODE: &str = "switch_mode";
const ID_OPEN_SETTINGS: &str = "open_settings";
const ID_RESET_POSITION: &str = "reset_position";
const ID_QUIT: &str = "quit";

/// Emitted with `true` / `false` when the capsule is shown or hidden.
pub const VISIBILITY_EVENT: &str = "visibility-changed";

/// Asks the frontend to open its settings panel.
pub const OPEN_SETTINGS_EVENT: &str = "open-settings";

/// The menu items whose text follows the app's state.
pub struct TrayMenu {
    visibility: MenuItem<Wry>,
    mode: MenuItem<Wry>,
}

fn visibility_label(visible: bool) -> &'static str {
    if visible { "Hide" } else { "Show" }
}

/// Names the mode the item switches *to*.
fn mode_label(current: DisplayMode) -> &'static str {
    match current {
        DisplayMode::Island => "Switch to Notch",
        DisplayMode::Notch => "Switch to Dynamic Island",
    }
}

/// Creates the tray icon. Call once during app setup.
pub fn setup(app: &AppHandle, settings: &AppSettings) -> tauri::Result<()> {
    let visibility = MenuItem::with_id(
        app,
        ID_TOGGLE_VISIBILITY,
        visibility_label(true),
        true,
        None::<&str>,
    )?;
    let mode = MenuItem::with_id(
        app,
        ID_SWITCH_MODE,
        mode_label(settings.display_mode),
        true,
        None::<&str>,
    )?;
    let open_settings =
        MenuItem::with_id(app, ID_OPEN_SETTINGS, "Settings...", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, ID_RESET_POSITION, "Reset Position", true, None::<&str>)?;
    let quit = MenuItem::with_id(
        app,
        ID_QUIT,
        format!("Quit {APP_NAME}"),
        true,
        None::<&str>,
    )?;

    let menu = Menu::with_items(
        app,
        &[
            &visibility,
            &mode,
            &PredefinedMenuItem::separator(app)?,
            &open_settings,
            &reset,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(APP_NAME)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(on_tray_icon_event);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayMenu { visibility, mode });
    Ok(())
}

/// Brings the menu in line with the settings. Safe to call before the tray
/// exists (it then does nothing).
pub fn sync(app: &AppHandle, settings: &AppSettings) {
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.mode.set_text(mode_label(settings.display_mode));
    }
}

/// Shows the capsule if it is hidden, hides it otherwise.
fn toggle_visibility(app: &AppHandle) {
    let Some(window) = app.get_webview_window(NOTCH_LABEL) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(true);
    set_visibility(app, !visible);
}

fn set_visibility(app: &AppHandle, visible: bool) {
    let Some(window) = app.get_webview_window(NOTCH_LABEL) else {
        return;
    };
    if window.is_visible().unwrap_or(!visible) == visible {
        return;
    }

    let result = if visible { window.show() } else { window.hide() };
    if let Err(error) = result {
        eprintln!("could not change the capsule's visibility: {error}");
        return;
    }

    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.visibility.set_text(visibility_label(visible));
    }
    let _ = app.emit(VISIBILITY_EVENT, visible);
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        ID_TOGGLE_VISIBILITY => toggle_visibility(app),
        ID_SWITCH_MODE => settings::update(app, |settings| {
            settings.display_mode = settings.display_mode.toggled();
        }),
        ID_OPEN_SETTINGS => {
            // The settings panel is part of the capsule, so it has to be visible.
            set_visibility(app, true);
            let _ = app.emit(OPEN_SETTINGS_EVENT, ());
        }
        ID_RESET_POSITION => {
            if let Some(window) = app.get_webview_window(NOTCH_LABEL)
                && let Err(error) = center_top(&window)
            {
                eprintln!("could not reset the capsule's position: {error}");
            }
        }
        ID_QUIT => app.exit(0),
        _ => {}
    }
}

fn on_tray_icon_event(tray: &TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        toggle_visibility(tray.app_handle());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_name_the_action() {
        assert_eq!(visibility_label(true), "Hide");
        assert_eq!(visibility_label(false), "Show");
        assert_eq!(mode_label(DisplayMode::Island), "Switch to Notch");
        assert_eq!(mode_label(DisplayMode::Notch), "Switch to Dynamic Island");
    }
}
