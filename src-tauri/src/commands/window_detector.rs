//! What is in front of the capsule.
//!
//! A light background loop looks at the foreground window twice a second and
//! tells the frontend two things (event `foreground-state`):
//!
//! - `is_fullscreen`: a game, a fullscreen video or a slide show covers the
//!   whole monitor. The capsule fades out completely, hover trigger
//!   included; when the fullscreen app goes away it comes back.
//! - `is_window_maximized`: an app window sits right under the capsule - it
//!   is maximized, or snapped so that its top edge runs below the capsule.
//!   The capsule then retracts into the top edge until only a thin lip is
//!   left, which keeps it out of that window's tab strip and title bar.
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
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_STYLE, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect, IsIconic,
    IsWindowVisible, IsZoomed, WS_CAPTION,
};

/// Emitted with a `ForegroundState` whenever it changes.
pub const FOREGROUND_EVENT: &str = "foreground-state";

/// How often the foreground window is looked at.
const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Half the width of the strip under the capsule that counts as "its place",
/// in logical px. Wide enough for the collapsed capsule with music playing.
const CAPSULE_HALF_SPAN: f64 = 150.0;

/// A window whose top edge is within this many px of the monitor's top edge
/// has its title bar where the capsule is.
const TOP_EDGE_TOLERANCE: i32 = 2;

/// Windows of the shell itself. The desktop covers the whole monitor too,
/// but looking at it is not "an app in front".
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
    /// The foreground window's title bar is under the capsule: it is
    /// maximized, or snapped/placed along the top edge beneath the capsule.
    pub is_window_maximized: bool,
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
/// - Fullscreen: it covers the whole monitor - unless it is an ordinary
///   maximized window (it has a title bar), which also reaches every edge
///   when the taskbar is set to auto-hide.
/// - Under the capsule: it is maximized, or its top edge lies on the
///   monitor's top edge and it spans the strip `capsule_half_span` either
///   side of the monitor's center (a window snapped to one half does).
fn classify(
    window: &RECT,
    monitor: &RECT,
    is_zoomed: bool,
    has_caption: bool,
    capsule_half_span: i32,
) -> ForegroundState {
    let covers_monitor = window.left <= monitor.left
        && window.top <= monitor.top
        && window.right >= monitor.right
        && window.bottom >= monitor.bottom;
    let is_fullscreen = covers_monitor && !(is_zoomed && has_caption);

    let center = monitor.left + (monitor.right - monitor.left) / 2;
    let touches_top = window.top <= monitor.top + TOP_EDGE_TOLERANCE;
    let overlaps_capsule =
        window.left < center + capsule_half_span && window.right > center - capsule_half_span;

    ForegroundState {
        is_fullscreen,
        is_window_maximized: !is_fullscreen && (is_zoomed || (touches_top && overlaps_capsule)),
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
    // A window that was just minimized can stay "foreground" until the user
    // clicks something else. It is not in front of anything any more.
    if unsafe { IsIconic(foreground) }.as_bool() {
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

    // The span is defined in logical px; window rectangles are physical.
    let dpi = unsafe { GetDpiForWindow(own) };
    let scale = if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 };

    let style = unsafe { GetWindowLongW(foreground, GWL_STYLE) } as u32;
    Some(classify(
        &window_rect,
        &monitor_info.rcMonitor,
        unsafe { IsZoomed(foreground) }.as_bool(),
        style & WS_CAPTION.0 == WS_CAPTION.0,
        (CAPSULE_HALF_SPAN * scale).round() as i32,
    ))
}

/// Starts the background loop that follows the foreground window.
pub fn spawn_watcher(window: WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    // A raw window handle is not `Send`; carry it across as an integer.
    let raw_hwnd = window.hwnd()?.0 as isize;
    let app = window.app_handle().clone();

    thread::Builder::new()
        .name("notch-window-detector".into())
        .spawn(move || watch(app, raw_hwnd))?;
    Ok(())
}

/// Body of the detector thread. Runs for the lifetime of the app.
fn watch(app: AppHandle, raw_hwnd: isize) {
    let own = HWND(raw_hwnd as *mut c_void);

    loop {
        thread::sleep(POLL_INTERVAL);

        let Some(next) = read_foreground(own) else {
            continue;
        };
        let previous = app.state::<ForegroundWatch>().replace(next);
        if next != previous {
            // The frontend does the rest: fading out for fullscreen,
            // retracting over a maximized window, coming back afterwards.
            let _ = app.emit(FOREGROUND_EVENT, next);
        }
    }
}

/// Returns what the detector last saw in front of the capsule.
#[tauri::command]
pub fn get_foreground_state(state: State<'_, ForegroundWatch>) -> ForegroundState {
    state.get()
}

/// True while an app window sits under the capsule (maximized, or snapped
/// along the top edge beneath it).
#[tauri::command]
pub fn is_window_maximized(state: State<'_, ForegroundWatch>) -> bool {
    state.get().is_window_maximized
}

/// True while a fullscreen app (game, fullscreen video, slide show) is in front.
#[tauri::command]
pub fn is_fullscreen(state: State<'_, ForegroundWatch>) -> bool {
    state.get().is_fullscreen
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1920x1080 monitor at the origin; its center is x = 960.
    const MONITOR: RECT = RECT {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1080,
    };
    const SPAN: i32 = 150;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn a_floating_window_is_neither() {
        let state = classify(&rect(200, 100, 1200, 800), &MONITOR, false, true, SPAN);
        assert_eq!(state, ForegroundState::default());
    }

    #[test]
    fn a_maximized_window_above_the_taskbar_is_maximized() {
        // Maximized windows overhang the work area by their invisible border.
        let state = classify(&rect(-8, -8, 1928, 1040), &MONITOR, true, true, SPAN);
        assert!(state.is_window_maximized);
        assert!(!state.is_fullscreen);
    }

    #[test]
    fn a_maximized_window_with_auto_hidden_taskbar_is_still_just_maximized() {
        let state = classify(&rect(-8, -8, 1928, 1088), &MONITOR, true, true, SPAN);
        assert!(state.is_window_maximized);
        assert!(!state.is_fullscreen);
    }

    #[test]
    fn a_borderless_window_covering_the_monitor_is_fullscreen() {
        // A game, or a browser video after pressing F.
        let state = classify(&rect(0, 0, 1920, 1080), &MONITOR, false, false, SPAN);
        assert!(state.is_fullscreen);
        assert!(!state.is_window_maximized);
    }

    #[test]
    fn a_browser_that_was_maximized_before_going_fullscreen_is_fullscreen() {
        // Still flagged as zoomed, but the title bar is gone.
        let state = classify(&rect(0, 0, 1920, 1080), &MONITOR, true, false, SPAN);
        assert!(state.is_fullscreen);
        assert!(!state.is_window_maximized);
    }

    #[test]
    fn a_window_snapped_to_one_half_has_its_buttons_under_the_capsule() {
        // Left half: its close button ends at x = 960, right under the capsule.
        let left = classify(&rect(-7, 0, 967, 1040), &MONITOR, false, true, SPAN);
        assert!(left.is_window_maximized);
        let right = classify(&rect(953, 0, 1927, 1040), &MONITOR, false, true, SPAN);
        assert!(right.is_window_maximized);
    }

    #[test]
    fn a_window_along_the_top_edge_but_away_from_the_center_is_not_in_the_way() {
        // A narrow window docked in the top-left corner.
        let state = classify(&rect(0, 0, 600, 500), &MONITOR, false, true, SPAN);
        assert!(!state.is_window_maximized);
    }

    #[test]
    fn a_centered_window_below_the_top_edge_is_not_in_the_way() {
        let state = classify(&rect(400, 60, 1500, 900), &MONITOR, false, true, SPAN);
        assert!(!state.is_window_maximized);
    }

    #[test]
    fn a_window_on_a_monitor_to_the_right_uses_that_monitors_bounds() {
        let second = rect(1920, 0, 3840, 1080);
        assert!(classify(&rect(1920, 0, 3840, 1080), &second, false, false, SPAN).is_fullscreen);
        assert!(!classify(&rect(2000, 100, 3000, 900), &second, false, true, SPAN).is_fullscreen);
        assert!(
            classify(&rect(1912, -8, 3848, 1040), &second, true, true, SPAN).is_window_maximized
        );
    }

    #[test]
    fn the_desktop_and_taskbar_are_not_apps() {
        assert!(is_shell_class("Progman"));
        assert!(is_shell_class("WorkerW"));
        assert!(is_shell_class("Shell_TrayWnd"));
        assert!(!is_shell_class("Chrome_WidgetWin_1"));
    }
}
