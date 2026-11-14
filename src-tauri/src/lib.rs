mod commands;

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{Emitter, Manager, PhysicalPosition, State, WebviewWindow};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};

use commands::media::{self, MediaState};
use commands::system::{self, SystemState};
use commands::audio;

/// Label of the notch window, as declared in `tauri.conf.json`.
const NOTCH_LABEL: &str = "notch";

/// Event sent to the frontend whenever the cursor enters or leaves the capsule.
const HOVER_EVENT: &str = "notch-hover";

/// Cursor check interval while the cursor is close to the notch window. Short,
/// so a click made right after leaving the capsule already passes through.
const CURSOR_POLL_NEAR: Duration = Duration::from_millis(8);

/// Cursor check interval while the cursor is elsewhere on the screen.
const CURSOR_POLL_FAR: Duration = Duration::from_millis(40);

/// How far around the window (physical px) the cursor counts as "close".
const NEAR_MARGIN_PX: i32 = 160;

/// The capsule's shape in logical (CSS) pixels, relative to the window's
/// top-left corner: a rectangle with rounded corners. Reported by the
/// frontend whenever the capsule changes state.
#[derive(Debug, Clone, Copy, Deserialize)]
struct HitRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    radius: f64,
}

impl HitRegion {
    /// True when the point lies on the capsule itself. The area cut away by
    /// the rounded corners does not count, so it stays click-through.
    fn contains(&self, px: f64, py: f64) -> bool {
        let (left, top) = (self.x, self.y);
        let (right, bottom) = (self.x + self.width, self.y + self.height);
        if px < left || px >= right || py < top || py >= bottom {
            return false;
        }

        let radius = self.radius.clamp(0.0, self.width.min(self.height) / 2.0);

        // Distance from the point to the rectangle shrunk by `radius`; inside
        // the rounded shape that distance is never more than `radius`.
        let dx = px - px.clamp(left + radius, right - radius);
        let dy = py - py.clamp(top + radius, bottom - radius);
        dx * dx + dy * dy <= radius * radius
    }
}

/// Shared click-through state.
struct ClickThroughState {
    region: Mutex<Option<HitRegion>>,
    /// The value last passed to `set_ignore_cursor_events`. The lock is held
    /// while the window is being changed, so this can never disagree with the
    /// real window, whichever thread makes the change.
    ignoring: Mutex<bool>,
    /// Asks the watcher to announce the hover state again on its next step.
    resync: AtomicBool,
}

impl ClickThroughState {
    /// Switches click-through and records it. Returns whether anything changed.
    ///
    /// Must not be called from the UI thread: the window call is handed to
    /// that thread while the lock is held.
    fn apply(&self, window: &WebviewWindow, ignore: bool) -> tauri::Result<bool> {
        let mut current = self.ignoring.lock().unwrap_or_else(PoisonError::into_inner);
        if *current == ignore {
            return Ok(false);
        }
        window.set_ignore_cursor_events(ignore)?;
        *current = ignore;
        Ok(true)
    }
}

/// Turns click-through on or off for the notch window by hand.
///
/// `ignore = true`  -> mouse events pass through to whatever is underneath.
/// `ignore = false` -> the window receives hover and click events.
///
/// The cursor watcher is the authority: it re-evaluates within milliseconds
/// and will override a value that contradicts where the cursor is. The
/// frontend therefore does not need to call this on hover.
#[tauri::command(async)]
fn set_clickthrough(
    window: WebviewWindow,
    state: State<'_, ClickThroughState>,
    ignore: bool,
) -> Result<(), String> {
    state
        .apply(&window, ignore)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Stores the capsule shape used by the cursor watcher. The watcher answers
/// with a `notch-hover` event, so the frontend always knows where the cursor
/// stands relative to the new shape.
#[tauri::command]
fn set_hit_region(state: State<'_, ClickThroughState>, region: HitRegion) -> Result<(), String> {
    let all_finite = [region.x, region.y, region.width, region.height, region.radius]
        .iter()
        .all(|value| value.is_finite());
    if !all_finite || region.width <= 0.0 || region.height <= 0.0 || region.radius < 0.0 {
        return Err(format!("invalid hit region: {region:?}"));
    }

    let mut guard = state.region.lock().map_err(|error| error.to_string())?;
    *guard = Some(region);
    state.resync.store(true, Ordering::Relaxed);
    Ok(())
}

/// Moves the notch window back to the top-center of the primary monitor.
#[tauri::command]
fn reposition_center(window: WebviewWindow) -> Result<(), String> {
    center_top(&window).map_err(|error| error.to_string())
}

/// Centers the window horizontally on the primary monitor and pins it to the
/// top edge.
///
/// The `x` in `tauri.conf.json` is only right for 1920px at 100% scaling.
/// Working in physical pixels here keeps the notch centered at 125% / 150%
/// Windows display scaling and on other resolutions.
fn center_top(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = match window.primary_monitor()? {
        Some(monitor) => monitor,
        None => match window.current_monitor()? {
            Some(monitor) => monitor,
            None => return Ok(()),
        },
    };

    let monitor_position = monitor.position();
    let monitor_width = monitor.size().width as i32;
    let window_width = window.outer_size()?.width as i32;

    let x = monitor_position.x + (monitor_width - window_width) / 2;
    let y = monitor_position.y;

    window.set_position(PhysicalPosition::new(x, y))
}

/// Where the cursor is, relative to the capsule and the notch window.
struct CursorProbe {
    /// The cursor is on the capsule.
    inside: bool,
    /// The cursor is on or close to the notch window.
    near: bool,
}

/// Reads the cursor straight from Win32. These calls are cheap and do not go
/// through the UI thread, which is what makes the short poll interval viable.
fn probe_cursor(hwnd: HWND, region: HitRegion) -> Option<CursorProbe> {
    let mut cursor = POINT::default();
    let mut window_rect = RECT::default();
    unsafe {
        GetCursorPos(&mut cursor).ok()?;
        GetWindowRect(hwnd, &mut window_rect).ok()?;
    }

    let dpi = unsafe { GetDpiForWindow(hwnd) };
    let scale = if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 };

    // Physical screen pixels -> logical pixels inside the window.
    let x = f64::from(cursor.x - window_rect.left) / scale;
    let y = f64::from(cursor.y - window_rect.top) / scale;

    let near = cursor.x >= window_rect.left - NEAR_MARGIN_PX
        && cursor.x < window_rect.right + NEAR_MARGIN_PX
        && cursor.y >= window_rect.top - NEAR_MARGIN_PX
        && cursor.y < window_rect.bottom + NEAR_MARGIN_PX;

    Some(CursorProbe {
        inside: region.contains(x, y),
        near,
    })
}

/// Watches the cursor from a background thread.
///
/// A window that ignores cursor events receives no mouse messages at all, so
/// the webview can never fire `mouseenter` to switch click-through back off.
/// This watcher closes that gap: it compares the global cursor position with
/// the capsule shape and toggles click-through the moment the cursor crosses
/// its edge, then tells the frontend about the change. It is the single
/// authority for both click-through and hover.
///
/// Everything outside the capsule - including the transparent rest of the
/// window - therefore stays click-through.
fn spawn_cursor_watcher(window: WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    // A raw window handle is not `Send`; carry it across as an integer.
    let raw_hwnd = window.hwnd()?.0 as isize;

    thread::Builder::new()
        .name("notch-cursor-watcher".into())
        .spawn(move || watch_cursor(window, raw_hwnd))?;
    Ok(())
}

/// Body of the watcher thread. Runs for the lifetime of the app.
fn watch_cursor(window: WebviewWindow, raw_hwnd: isize) {
    let hwnd = HWND(raw_hwnd as *mut c_void);

    loop {
        let near = check_cursor(&window, hwnd);
        thread::sleep(if near {
            CURSOR_POLL_NEAR
        } else {
            CURSOR_POLL_FAR
        });
    }
}

/// One watcher step. Returns whether the cursor is close to the window.
fn check_cursor(window: &WebviewWindow, hwnd: HWND) -> bool {
    let state = window.state::<ClickThroughState>();

    let region = match state.region.lock() {
        Ok(guard) => *guard,
        Err(_) => return false,
    };
    let Some(region) = region else {
        return false;
    };
    let Some(probe) = probe_cursor(hwnd, region) else {
        return false;
    };

    // Announce every change, and also answer a pending resync request.
    let resync = state.resync.swap(false, Ordering::Relaxed);
    let changed = state.apply(window, !probe.inside).unwrap_or(false);
    if changed || resync {
        let _ = window.emit(HOVER_EVENT, probe.inside);
    }

    probe.near
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ClickThroughState {
            region: Mutex::new(None),
            ignoring: Mutex::new(true),
            resync: AtomicBool::new(false),
        })
        .manage(MediaState::default())
        .manage(SystemState::default())
        .invoke_handler(tauri::generate_handler![
            set_clickthrough,
            set_hit_region,
            reposition_center,
            media::get_media_info,
            media::media_play_pause,
            media::media_next,
            media::media_previous,
            system::get_system_info,
            audio::get_volume,
            audio::set_volume,
            audio::toggle_mute
        ])
        .setup(|app| {
            let window = app
                .get_webview_window(NOTCH_LABEL)
                .ok_or("notch window not found; check the label in tauri.conf.json")?;

            // Click-through is on from the first frame; the watcher turns it
            // off only while the cursor is on the capsule.
            window.set_ignore_cursor_events(true)?;

            // A failed lookup of the monitor is not fatal: the window simply
            // stays at the x/y from tauri.conf.json.
            if let Err(error) = center_top(&window) {
                eprintln!("could not center the notch window: {error}");
            }

            spawn_cursor_watcher(window)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::HitRegion;

    /// The idle capsule: 180x28 at (170, 8) with fully rounded ends.
    const PILL: HitRegion = HitRegion {
        x: 170.0,
        y: 8.0,
        width: 180.0,
        height: 28.0,
        radius: 14.0,
    };

    #[test]
    fn center_and_straight_edges_are_inside() {
        assert!(PILL.contains(260.0, 22.0));
        assert!(PILL.contains(260.0, 8.0));
        assert!(PILL.contains(260.0, 35.9));
        assert!(PILL.contains(170.5, 22.0));
    }

    #[test]
    fn everything_around_the_capsule_is_outside() {
        assert!(!PILL.contains(260.0, 7.9)); // the gap above the capsule
        assert!(!PILL.contains(260.0, 36.0)); // just below
        assert!(!PILL.contains(169.9, 22.0)); // just left
        assert!(!PILL.contains(350.0, 22.0)); // just right
    }

    #[test]
    fn rounded_corners_are_outside() {
        // Inside the bounding box, but cut away by the corner radius.
        assert!(!PILL.contains(171.0, 9.0));
        assert!(!PILL.contains(349.0, 9.0));
        assert!(!PILL.contains(171.0, 35.0));
        assert!(!PILL.contains(349.0, 35.0));
        // Same corner, a bit further in: on the capsule.
        assert!(PILL.contains(176.0, 14.0));
    }

    #[test]
    fn zero_radius_is_a_plain_rectangle() {
        let rect = HitRegion { radius: 0.0, ..PILL };
        assert!(rect.contains(170.0, 8.0));
        assert!(rect.contains(349.9, 35.9));
        assert!(!rect.contains(350.0, 36.0));
    }

    #[test]
    fn oversized_radius_is_clamped() {
        let pill = HitRegion { radius: 999.0, ..PILL };
        assert!(pill.contains(260.0, 22.0));
        assert!(!pill.contains(171.0, 9.0));
    }
}
