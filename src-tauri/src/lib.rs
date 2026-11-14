use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{Emitter, Manager, PhysicalPosition, State, WebviewWindow};

/// Label of the notch window, as declared in `tauri.conf.json`.
const NOTCH_LABEL: &str = "notch";

/// Event sent to the frontend whenever the cursor enters or leaves the capsule.
const HOVER_EVENT: &str = "notch-hover";

/// How often the cursor position is compared against the capsule.
const CURSOR_POLL_INTERVAL: Duration = Duration::from_millis(33);

/// The capsule's rectangle in logical (CSS) pixels, relative to the window's
/// top-left corner. Reported by the frontend whenever the capsule changes size.
#[derive(Debug, Clone, Copy, Deserialize)]
struct HitRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Shared click-through state.
///
/// `ignoring` mirrors the value last passed to `set_ignore_cursor_events`, so
/// the cursor watcher and the frontend commands never fight over it.
struct ClickThroughState {
    region: Mutex<Option<HitRegion>>,
    ignoring: AtomicBool,
}

/// Turns click-through on or off for the notch window.
///
/// `ignore = true`  -> mouse events pass through to whatever is underneath.
/// `ignore = false` -> the window receives hover and click events.
#[tauri::command]
fn set_clickthrough(
    window: WebviewWindow,
    state: State<'_, ClickThroughState>,
    ignore: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|error| error.to_string())?;
    state.ignoring.store(ignore, Ordering::Relaxed);
    Ok(())
}

/// Stores the capsule rectangle used by the cursor watcher.
#[tauri::command]
fn set_hit_region(state: State<'_, ClickThroughState>, region: HitRegion) -> Result<(), String> {
    let all_finite = [region.x, region.y, region.width, region.height]
        .iter()
        .all(|value| value.is_finite());
    if !all_finite || region.width <= 0.0 || region.height <= 0.0 {
        return Err(format!("invalid hit region: {region:?}"));
    }

    let mut guard = state.region.lock().map_err(|error| error.to_string())?;
    *guard = Some(region);
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
/// The `x: 720` in `tauri.conf.json` is only right for 1920px at 100% scaling.
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

/// Returns true when the cursor is inside the capsule rectangle.
fn cursor_in_region(window: &WebviewWindow, region: HitRegion) -> tauri::Result<bool> {
    let cursor = window.cursor_position()?;
    let origin = window.inner_position()?;
    let scale = window.scale_factor()?;

    let left = f64::from(origin.x) + region.x * scale;
    let top = f64::from(origin.y) + region.y * scale;
    let right = left + region.width * scale;
    let bottom = top + region.height * scale;

    Ok(cursor.x >= left && cursor.x < right && cursor.y >= top && cursor.y < bottom)
}

/// Watches the cursor from a background thread.
///
/// A window that ignores cursor events receives no mouse messages at all, so
/// the webview can never fire `mouseenter` to switch click-through back off.
/// This watcher closes that gap: it compares the global cursor position with
/// the capsule rectangle and toggles click-through whenever the cursor crosses
/// its edge, then tells the frontend about the change.
fn spawn_cursor_watcher(window: WebviewWindow) -> std::io::Result<()> {
    thread::Builder::new()
        .name("notch-cursor-watcher".into())
        .spawn(move || watch_cursor(window))
        .map(|_| ())
}

/// Body of the watcher thread. Runs for the lifetime of the app.
fn watch_cursor(window: WebviewWindow) {
    loop {
        thread::sleep(CURSOR_POLL_INTERVAL);

        let state = window.state::<ClickThroughState>();

        let region = match state.region.lock() {
            Ok(guard) => *guard,
            Err(_) => continue,
        };
        let Some(region) = region else {
            continue;
        };

        let inside = match cursor_in_region(&window, region) {
            Ok(inside) => inside,
            Err(_) => continue,
        };

        let should_ignore = !inside;
        if state.ignoring.load(Ordering::Relaxed) == should_ignore {
            continue;
        }

        if window.set_ignore_cursor_events(should_ignore).is_ok() {
            state.ignoring.store(should_ignore, Ordering::Relaxed);
            let _ = window.emit(HOVER_EVENT, inside);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ClickThroughState {
            region: Mutex::new(None),
            ignoring: AtomicBool::new(true),
        })
        .invoke_handler(tauri::generate_handler![
            set_clickthrough,
            set_hit_region,
            reposition_center
        ])
        .setup(|app| {
            let window = app
                .get_webview_window(NOTCH_LABEL)
                .ok_or("notch window not found; check the label in tauri.conf.json")?;

            // Click-through is on from the first frame; the watcher turns it
            // off only while the cursor is over the capsule.
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
