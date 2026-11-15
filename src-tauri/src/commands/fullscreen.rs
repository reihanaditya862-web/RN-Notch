//! What is in front of the capsule: a fullscreen app (game, video in
//! fullscreen, slide show) or a maximized window (a browser, typically).
//!
//! - Fullscreen: the capsule fades out and its window is hidden.
//! - Maximized: the capsule switches to its compact shape, so it stays out of
//!   the app's tab strip and title bar.
//!
//! Detection is plain Win32: the foreground window's rectangle and style
//! compared with the monitor it is on.

use std::ffi::c_void;
use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_STYLE, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect, IsWindowVisible,
    IsZoomed, WS_CAPTION,
};

use crate::visibility;

/// Emitted with a `ForegroundState` whenever it changes.
pub const FOREGROUND_EVENT: &str = "foreground-state";

/// How often the foreground window is looked at.
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Time given to the frontend's fade-out before the window is really hidden.
const FADE_OUT: Duration = Duration::from_millis(350);

/// Windows of the shell itself. The desktop covers the whole monitor too,
/// but looking at it is not "an app in fullscreen".
const SHELL_CLASSES: [&str; 5] = [
    "Progman",
    "WorkerW",
    "Shell_TrayWnd",
    "XamlExplorerHostIslandWindow",
    "MultitaskingViewFrame",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct ForegroundState {
    /// The foreground window covers the entire monitor.
    pub is_fullscreen: bool,
    /// The foreground window is maximized (and not fullscreen).
    pub is_maximized: bool,
}

/// Last state seen by the watcher, for the commands below.
#[derive(Default)]
pub struct ForegroundWatch {
    current: Mutex<ForegroundState>,
}

impl ForegroundWatch {
    fn get(&self) -> ForegroundState {
        *self.current.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Stores the new state and returns the previous one.
    fn replace(&self, next: ForegroundState) -> ForegroundState {
        let mut current = self.current.lock().unwrap_or_else(PoisonError::into_inner);
        std::mem::replace(&mut *current, next)
    }
}

/// Decides what a window is from its rectangle and style.
///
/// A window that covers the whole monitor is fullscreen - unless it is an
/// ordinary maximized window (it has a title bar), which also reaches every
/// edge when the taskbar is set to auto-hide.
fn classify(window: &RECT, monitor: &RECT, is_zoomed: bool, has_caption: bool) -> ForegroundState {
    let covers_monitor = window.left <= monitor.left
        && window.top <= monitor.top
        && window.right >= monitor.right
        && window.bottom >= monitor.bottom;

    let is_fullscreen = covers_monitor && !(is_zoomed && has_caption);
    ForegroundState {
        is_fullscreen,
        is_maximized: is_zoomed && !is_fullscreen,
    }
}

fn is_shell_class(class_name: &str) -> bool {
    SHELL_CLASSES.contains(&class_name)
}

fn class_name(window: HWND) -> String {
    let mut buffer = [0u16; 128];
    let length = unsafe { GetClassNameW(window, &mut buffer) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

/// Looks at the foreground window.
///
/// Returns `None` when there is nothing new to conclude: the capsule itself
/// has focus (the user clicked it), so whatever was in front before still is.
fn read_foreground(own: HWND) -> Option<ForegroundState> {
    let nothing = Some(ForegroundState::default());

    let foreground = unsafe { GetForegroundWindow() };
    if foreground == own {
        return None;
    }
    if foreground.0.is_null() || !unsafe { IsWindowVisible(foreground) }.as_bool() {
        return nothing;
    }
    if is_shell_class(&class_name(foreground)) {
        return nothing;
    }

    // Only a window on the capsule's own monitor can be in its way.
    let monitor = unsafe { MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST) };
    if monitor != unsafe { MonitorFromWindow(own, MONITOR_DEFAULTTONEAREST) } {
        return nothing;
    }

    let mut monitor_info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let mut window_rect = RECT::default();
    unsafe {
        if !GetMonitorInfoW(monitor, &mut monitor_info).as_bool() {
            return nothing;
        }
        if GetWindowRect(foreground, &mut window_rect).is_err() {
            return nothing;
        }
    }

    let style = unsafe { GetWindowLongW(foreground, GWL_STYLE) } as u32;
    Some(classify(
        &window_rect,
        &monitor_info.rcMonitor,
        unsafe { IsZoomed(foreground) }.as_bool(),
        style & WS_CAPTION.0 == WS_CAPTION.0,
    ))
}

/// Starts the background thread that follows the foreground window.
pub fn spawn_watcher(window: WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    // A raw window handle is not `Send`; carry it across as an integer.
    let raw_hwnd = window.hwnd()?.0 as isize;
    let app = window.app_handle().clone();

    thread::Builder::new()
        .name("notch-foreground-watcher".into())
        .spawn(move || watch(app, raw_hwnd))?;
    Ok(())
}

/// Body of the watcher thread. Runs for the lifetime of the app.
fn watch(app: AppHandle, raw_hwnd: isize) {
    let own = HWND(raw_hwnd as *mut c_void);

    loop {
        thread::sleep(POLL_INTERVAL);

        let Some(next) = read_foreground(own) else {
            continue;
        };
        let previous = app.state::<ForegroundWatch>().replace(next);
        if next == previous {
            continue;
        }

        match (previous.is_fullscreen, next.is_fullscreen) {
            // Entering fullscreen: let the capsule fade out, then hide the
            // window so it cannot cost the game a single frame.
            (false, true) => {
                let _ = app.emit(FOREGROUND_EVENT, next);
                thread::sleep(FADE_OUT);
                visibility::set_fullscreen(&app, true);
            }
            // Leaving fullscreen: bring the window back first, then let the
            // capsule fade in.
            (true, false) => {
                visibility::set_fullscreen(&app, false);
                let _ = app.emit(FOREGROUND_EVENT, next);
            }
            _ => {
                let _ = app.emit(FOREGROUND_EVENT, next);
            }
        }
    }
}

/// Returns what the watcher last saw in front of the capsule.
#[tauri::command]
pub fn get_foreground_state(state: State<'_, ForegroundWatch>) -> ForegroundState {
    state.get()
}

/// True while a fullscreen app (game, fullscreen video, slide show) is in front.
#[tauri::command]
pub fn is_fullscreen_app_active(state: State<'_, ForegroundWatch>) -> bool {
    state.get().is_fullscreen
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1920x1080 monitor at the origin.
    const MONITOR: RECT = RECT {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
    };

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn a_normal_window_is_neither() {
        let state = classify(&rect(200, 100, 1200, 800), &MONITOR, false, true);
        assert_eq!(state, ForegroundState::default());
    }

    #[test]
    fn a_maximized_window_above_the_taskbar_is_maximized() {
        // Maximized windows overhang the work area by their invisible border.
        let state = classify(&rect(-8, -8, 1928, 1040), &MONITOR, true, true);
        assert!(state.is_maximized);
        assert!(!state.is_fullscreen);
    }

    #[test]
    fn a_maximized_window_with_auto_hidden_taskbar_is_still_just_maximized() {
        let state = classify(&rect(-8, -8, 1928, 1088), &MONITOR, true, true);
        assert!(state.is_maximized);
        assert!(!state.is_fullscreen);
    }

    #[test]
    fn a_borderless_window_covering_the_monitor_is_fullscreen() {
        // A game, or a browser video after pressing F.
        let state = classify(&rect(0, 0, 1920, 1080), &MONITOR, false, false);
        assert!(state.is_fullscreen);
        assert!(!state.is_maximized);
    }

    #[test]
    fn a_browser_that_was_maximized_before_going_fullscreen_is_fullscreen() {
        // Still flagged as zoomed, but the title bar is gone.
        let state = classify(&rect(0, 0, 1920, 1080), &MONITOR, true, false);
        assert!(state.is_fullscreen);
        assert!(!state.is_maximized);
    }

    #[test]
    fn a_window_on_a_monitor_to_the_right_uses_that_monitors_bounds() {
        let second = rect(1920, 0, 3840, 1080);
        assert!(classify(&rect(1920, 0, 3840, 1080), &second, false, false).is_fullscreen);
        assert!(!classify(&rect(2000, 100, 3000, 900), &second, false, true).is_fullscreen);
    }

    #[test]
    fn the_desktop_and_taskbar_are_not_apps() {
        assert!(is_shell_class("Progman"));
        assert!(is_shell_class("WorkerW"));
        assert!(is_shell_class("Shell_TrayWnd"));
        assert!(!is_shell_class("Chrome_WidgetWin_1"));
    }
}
