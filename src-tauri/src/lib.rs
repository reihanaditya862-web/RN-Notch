mod commands;
mod tray;
mod visibility;

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};

use commands::background::{self, Background};
use commands::media::{self, MediaState};
use commands::notifications::{self, NotificationAccess};
use commands::schedules::{self, SCHEDULES_FILE, SchedulesState};
use commands::settings::{self, SETTINGS_DIR, SETTINGS_FILE, SettingsState};
use commands::system::{self, SystemState};
use commands::window_detector::{self, ForegroundWatch};
use commands::{
    apps, audio, autostart, clipboard, events, hardware, http, hud, memory, mixer, picker, screen_tools,
};

/// Name shown to the user (tray tooltip, menu texts).
pub(crate) const APP_NAME: &str = "RN Notch";

/// WebView2 arguments of every window: the defaults Tauri would pass, a
/// 64 MB cap on the JavaScript heap (garbage collection runs early), a 1 MB
/// disk cache with no shader cache, one renderer process for both windows,
/// and none of the browser's own background work (extensions, plugins,
/// component updates, background networking). Must match
/// `additionalBrowserArgs` in `tauri.conf.json` exactly, because WebView2
/// windows that share a data folder must also share their arguments.
pub(crate) const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --js-flags=--max-old-space-size=64 --disk-cache-size=1048576 --disable-gpu-shader-disk-cache --renderer-process-limit=1 --disable-extensions --disable-plugins --disable-background-networking --disable-component-update";

/// Label of the notch window, as declared in `tauri.conf.json`.
pub(crate) const NOTCH_LABEL: &str = "notch";

/// Event sent to the frontend whenever the cursor enters or leaves the capsule.
const HOVER_EVENT: &str = "notch-hover";

/// Event sent when a mouse button is pressed outside every clickable shape
/// while the frontend has asked to be told (a menu or panel is open).
const OUTSIDE_CLICK_EVENT: &str = "notch-outside-click";

/// Cursor check interval while the cursor is close to the notch window. Short,
/// so a click made right after leaving the capsule already passes through.
const CURSOR_POLL_NEAR: Duration = Duration::from_millis(8);

/// Cursor check interval while the cursor is elsewhere on the screen.
const CURSOR_POLL_FAR: Duration = Duration::from_millis(40);

/// How far around the window (physical px) the cursor counts as "close".
const NEAR_MARGIN_PX: i32 = 160;

/// Window size at 100% scale, in logical px; keep in step with the `width`
/// and `height` in `tauri.conf.json`. Wider than the dashboard so the
/// collapsed capsule can grow to fit a long lyric line.
const BASE_WINDOW_WIDTH: f64 = 760.0;
const BASE_WINDOW_HEIGHT: f64 = 440.0;

/// Range of capsule scales the window can be sized for.
const WINDOW_SCALE_MIN: f64 = 0.75;
const WINDOW_SCALE_MAX: f64 = 2.0;

/// A clickable shape in logical (CSS) pixels, relative to the window's
/// top-left corner: a rectangle whose top and bottom corners can be rounded
/// independently. The capsule is one (flat on top in notch mode, a full pill
/// in island mode); an open context menu is another. Reported by the frontend
/// whenever the shapes change.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HitRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    top_radius: f64,
    #[serde(default)]
    bottom_radius: f64,
    /// A passive shape reports hover but does not take the mouse: clicks on
    /// it still go to the window underneath. Used for the ultra-slim bar over
    /// a maximized app, so a tab that happens to be below it stays clickable;
    /// resting the cursor on the bar is what opens the capsule.
    #[serde(default)]
    passive: bool,
}

impl HitRegion {
    /// True when the point lies on the shape itself. The area cut away by
    /// the rounded corners does not count, so it stays click-through.
    fn contains(&self, px: f64, py: f64) -> bool {
        let (left, top) = (self.x, self.y);
        let (right, bottom) = (self.x + self.width, self.y + self.height);
        if px < left || px >= right || py < top || py >= bottom {
            return false;
        }

        let (top_radius, bottom_radius) = self.fitted_radii();

        // Inside a corner's square the point must also be inside that
        // corner's circle; everywhere else the bounding box is enough.
        let in_circle = |center_x: f64, center_y: f64, radius: f64| {
            let (dx, dy) = (px - center_x, py - center_y);
            dx * dx + dy * dy <= radius * radius
        };

        if py < top + top_radius {
            if px < left + top_radius {
                return in_circle(left + top_radius, top + top_radius, top_radius);
            }
            if px >= right - top_radius {
                return in_circle(right - top_radius, top + top_radius, top_radius);
            }
        }
        if py >= bottom - bottom_radius {
            if px < left + bottom_radius {
                return in_circle(left + bottom_radius, bottom - bottom_radius, bottom_radius);
            }
            if px >= right - bottom_radius {
                return in_circle(right - bottom_radius, bottom - bottom_radius, bottom_radius);
            }
        }
        true
    }

    /// The corner radii as the browser draws them. CSS shrinks radii that do
    /// not fit: two corners sharing an edge may not add up to more than that
    /// edge. All radii are scaled by the same factor, like CSS does.
    fn fitted_radii(&self) -> (f64, f64) {
        let top = self.top_radius.max(0.0);
        let bottom = self.bottom_radius.max(0.0);

        let mut factor: f64 = 1.0;
        for (sum, edge) in [
            (top + bottom, self.height),
            (top * 2.0, self.width),
            (bottom * 2.0, self.width),
        ] {
            if sum > edge && sum > 0.0 {
                factor = factor.min(edge / sum);
            }
        }
        (top * factor, bottom * factor)
    }

    fn is_valid(&self) -> bool {
        let values = [
            self.x,
            self.y,
            self.width,
            self.height,
            self.top_radius,
            self.bottom_radius,
        ];
        values.iter().all(|value| value.is_finite())
            && self.width > 0.0
            && self.height > 0.0
            && self.top_radius >= 0.0
            && self.bottom_radius >= 0.0
    }
}

/// Shared click-through state.
struct ClickThroughState {
    /// Every shape that should receive the mouse. Empty until the frontend
    /// reports the capsule.
    regions: Mutex<Vec<HitRegion>>,
    /// The value last passed to `set_ignore_cursor_events`. The lock is held
    /// while the window is being changed, so this can never disagree with the
    /// real window, whichever thread makes the change.
    ignoring: Mutex<bool>,
    /// Asks the watcher to announce the hover state again on its next step.
    resync: AtomicBool,
    /// The frontend wants to hear about clicks that land outside the shapes,
    /// so it can close an open menu or panel.
    watch_outside_clicks: AtomicBool,
    /// Something dragged from another app toward the capsule makes the window
    /// take it (see `check_cursor`). Off with the shelf or smart context off.
    magnet_enabled: AtomicBool,
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

/// Stores the clickable shapes used by the cursor watcher: the capsule and,
/// while it is open, the context menu. The watcher answers with a
/// `notch-hover` event, so the frontend always knows where the cursor stands
/// relative to the new shapes.
///
/// With `watch_outside_clicks` the watcher also emits `notch-outside-click`
/// when a mouse button goes down outside all of them. Those clicks reach
/// other apps, never the webview, so this is the only way to notice them.
#[tauri::command]
fn set_hit_regions(
    state: State<'_, ClickThroughState>,
    regions: Vec<HitRegion>,
    watch_outside_clicks: bool,
) -> Result<(), String> {
    if let Some(invalid) = regions.iter().find(|region| !region.is_valid()) {
        return Err(format!("invalid hit region: {invalid:?}"));
    }

    let mut guard = state.regions.lock().map_err(|error| error.to_string())?;
    *guard = regions;
    state
        .watch_outside_clicks
        .store(watch_outside_clicks, Ordering::Relaxed);
    state.resync.store(true, Ordering::Relaxed);
    Ok(())
}

/// Moves the notch window back to the top-center of the primary monitor.
#[tauri::command]
fn reposition_center(window: WebviewWindow) -> Result<(), String> {
    center_top(&window).map_err(|error| error.to_string())
}

/// Exits the application.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Resizes the (transparent) window for a capsule scale and re-centers it.
///
/// The window is only as large as the biggest capsule state needs. At 175%
/// the dashboard would not fit the base size, so the window grows with the
/// scale the user picked in Settings. `scale` is a factor: 1.0 = 100%.
#[tauri::command]
fn set_window_scale(window: WebviewWindow, scale: f64) -> Result<(), String> {
    if !scale.is_finite() {
        return Err(format!("invalid window scale: {scale}"));
    }
    let scale = scale.clamp(WINDOW_SCALE_MIN, WINDOW_SCALE_MAX);

    window
        .set_size(LogicalSize::new(
            (BASE_WINDOW_WIDTH * scale).round(),
            (BASE_WINDOW_HEIGHT * scale).round(),
        ))
        .map_err(|error| error.to_string())?;
    center_top(&window).map_err(|error| error.to_string())
}

/// Centers the window horizontally on the primary monitor and pins it to the
/// top edge.
///
/// The `x` in `tauri.conf.json` is only right for 1920px at 100% scaling.
/// Working in physical pixels here keeps the notch centered at 125% / 150%
/// Windows display scaling and on other resolutions.
pub(crate) fn center_top(window: &WebviewWindow) -> tauri::Result<()> {
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

/// Where the cursor is, relative to the reported shapes and the notch window.
struct CursorProbe {
    /// The cursor is on one of the shapes, passive or not.
    hovering: bool,
    /// The cursor is on a shape that takes the mouse.
    interactive: bool,
    /// The cursor is within `MAGNET_MARGIN` of the capsule.
    in_magnet_zone: bool,
    /// The cursor is on or close to the notch window.
    near: bool,
}

/// What the watcher remembers from one step to the next.
#[derive(Default)]
struct WatcherMemory {
    button_was_down: bool,
    was_hovering: bool,
    was_watching: bool,
    /// The cursor was in the magnet zone on the previous step.
    was_in_magnet_zone: bool,
    /// The left button was already held when the cursor arrived in the
    /// magnet zone, and still is: a drag that started in another app.
    dragging_in: bool,
}

/// Reads the cursor straight from Win32. These calls are cheap and do not go
/// through the UI thread, which is what makes the short poll interval viable.
fn probe_cursor(hwnd: HWND, regions: &[HitRegion]) -> Option<CursorProbe> {
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

    let mut hovering = false;
    let mut interactive = false;
    for region in regions.iter().filter(|region| region.contains(x, y)) {
        hovering = true;
        interactive |= !region.passive;
    }
    // The first shape is the capsule; the magnet zone is its box plus a margin.
    let in_magnet_zone = regions.first().is_some_and(|capsule| {
        x >= capsule.x - MAGNET_MARGIN
            && x < capsule.x + capsule.width + MAGNET_MARGIN
            && y >= capsule.y - MAGNET_MARGIN
            && y < capsule.y + capsule.height + MAGNET_MARGIN
    });

    Some(CursorProbe {
        hovering,
        interactive,
        in_magnet_zone,
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

/// True while the left mouse button is held down. Read only for the magnet
/// (see `check_cursor`); it never produces input.
fn left_button_down() -> bool {
    unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON.0)) < 0 }
}

/// Room around the capsule (logical px) in which a file dragged in pulls it open.
const MAGNET_MARGIN: f64 = 56.0;

/// Switches the file magnet (see `check_cursor`) on or off.
#[tauri::command]
fn set_magnet_enabled(state: State<'_, ClickThroughState>, enabled: bool) {
    state.magnet_enabled.store(enabled, Ordering::Relaxed);
}

/// True while the left, right or middle mouse button is held down, anywhere
/// on the desktop. This only reads the state; it never produces input.
fn any_mouse_button_down() -> bool {
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON]
        .iter()
        .any(|key| unsafe { GetAsyncKeyState(i32::from(key.0)) } < 0)
}

/// Body of the watcher thread. Runs for the lifetime of the app.
fn watch_cursor(window: WebviewWindow, raw_hwnd: isize) {
    let hwnd = HWND(raw_hwnd as *mut c_void);
    let mut memory = WatcherMemory::default();

    loop {
        let fast = check_cursor(&window, hwnd, &mut memory);
        thread::sleep(if fast {
            CURSOR_POLL_NEAR
        } else {
            CURSOR_POLL_FAR
        });
    }
}

/// One watcher step. Returns whether the next step should come quickly: the
/// cursor is close to the window, or outside clicks are being watched (a
/// click is short, so it needs the fast interval wherever the cursor is).
fn check_cursor(window: &WebviewWindow, hwnd: HWND, memory: &mut WatcherMemory) -> bool {
    let state = window.state::<ClickThroughState>();
    let watching = state.watch_outside_clicks.load(Ordering::Relaxed);

    // The mouse buttons are read only while outside clicks matter (a menu or
    // settings is open). A background process that reads input state all the
    // time looks like a keylogger to antivirus heuristics, and it is not
    // needed otherwise. The first step after watching starts only takes the
    // baseline, so a button already held then is not mistaken for a press.
    let pressed = if watching {
        let button_down = any_mouse_button_down();
        let pressed = button_down && !memory.button_was_down && memory.was_watching;
        memory.button_was_down = button_down;
        pressed
    } else {
        false
    };
    memory.was_watching = watching;

    let regions = match state.regions.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => return watching,
    };
    let Some(probe) = probe_cursor(hwnd, &regions) else {
        return watching;
    };

    // The magnet: a file dragged from Explorer (or anything dragged from
    // another app) toward the capsule. The left button is read only while the
    // cursor is in the zone just around the capsule; held already when it
    // arrives means the drag began elsewhere. While it lasts the window takes
    // the mouse, so Windows offers it the drop and the capsule opens as the
    // shelf. Pressing the button inside the zone (a click, a tab dragged
    // under the notch) never counts.
    let magnet_on = state.magnet_enabled.load(Ordering::Relaxed);
    let in_zone = magnet_on && probe.in_magnet_zone;
    memory.dragging_in = in_zone && {
        let left = left_button_down();
        if memory.was_in_magnet_zone { memory.dragging_in && left } else { left }
    };
    memory.was_in_magnet_zone = in_zone;

    // The window takes the mouse only on a shape that wants it (or for a
    // drag coming in); a passive shape leaves click-through on.
    let _ = state.apply(window, !(probe.interactive || memory.dragging_in));

    // Hover is announced on every change, and again when a resync is pending.
    let resync = state.resync.swap(false, Ordering::Relaxed);
    if probe.hovering != memory.was_hovering || resync {
        let _ = window.emit(HOVER_EVENT, probe.hovering);
    }
    memory.was_hovering = probe.hovering;

    if watching && pressed && !probe.hovering {
        let _ = window.emit(OUTSIDE_CLICK_EVENT, ());
    }

    probe.near || watching
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // "Start with Windows": registers this executable under the app's name.
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name(APP_NAME)
                .build(),
        )
        .manage(ClickThroughState {
            regions: Mutex::new(Vec::new()),
            ignoring: Mutex::new(true),
            resync: AtomicBool::new(false),
            watch_outside_clicks: AtomicBool::new(false),
            magnet_enabled: AtomicBool::new(false),
        })
        .manage(MediaState::default())
        .manage(SystemState::default())
        .manage(ForegroundWatch::default())
        .manage(visibility::Visibility::default())
        .manage(Background::default())
        .manage(NotificationAccess::default())
        .invoke_handler(tauri::generate_handler![
            set_clickthrough,
            set_hit_regions,
            reposition_center,
            quit_app,
            set_window_scale,
            window_detector::get_foreground_state,
            window_detector::is_window_maximized,
            window_detector::is_fullscreen,
            autostart::get_autostart,
            autostart::set_autostart,
            settings::load_settings,
            settings::save_settings,
            media::get_media_info,
            media::media_play_pause,
            media::media_next,
            media::media_previous,
            media::media_seek,
            media::media_set_shuffle,
            media::media_set_repeat,
            system::get_system_info,
            audio::get_volume,
            audio::set_volume,
            audio::toggle_mute,
            background::set_background_paused,
            notifications::notification_access,
            notifications::open_app,
            notifications::open_notification_settings,
            clipboard::write_clipboard_text,
            picker::start_color_pick,
            picker::pixel_at_cursor,
            picker::finish_color_pick,
            screen_tools::launch_snip,
            screen_tools::snipping_tool_status,
            memory::set_memory_mode,
            set_magnet_enabled,
            screen_tools::start_file_drag,
            apps::ai_shortcuts,
            apps::launch_ai,
            http::http_get_text,
            http::http_get_image,
            schedules::load_schedules,
            schedules::save_schedules,
            mixer::audio_outputs,
            mixer::set_audio_output,
            mixer::mic_muted,
            mixer::toggle_mic,
            mixer::audio_apps,
            mixer::set_app_volume,
            mixer::set_app_muted
        ])
        .setup(|app| {
            let window = app
                .get_webview_window(NOTCH_LABEL)
                .ok_or("notch window not found; check the label in tauri.conf.json")?;

            // Settings live at %APPDATA%\rn-notch\settings.json and must be
            // in place before the frontend asks for them.
            let data_dir = app.path().config_dir()?.join(SETTINGS_DIR);
            let settings_state = SettingsState::load(data_dir.join(SETTINGS_FILE));
            let initial_settings = settings_state.get();
            app.manage(settings_state);
            app.manage(SchedulesState::load(data_dir.join(SCHEDULES_FILE)));

            // The optional modules. Each loop checks its switch in the
            // settings on every round, and eases off while the capsule is
            // off screen or the session is locked. None of them is needed
            // for the capsule itself, so a failure to start is only logged.
            // Hardware and clipboard sleep until Windows reports a change; the
            // media watcher pushes track and playback changes to the frontend.
            let (hardware_wake, clipboard_wake) = match events::start() {
                Ok(wakeups) => (wakeups.hardware, wakeups.clipboard),
                Err(error) => {
                    eprintln!("could not listen for Windows events: {error}");
                    // Without events the loops still check on their safety interval.
                    let (_, hardware) = std::sync::mpsc::channel();
                    let (_, clipboard) = std::sync::mpsc::channel();
                    (hardware, clipboard)
                }
            };
            for (name, started) in [
                ("notifications", notifications::spawn_watcher(app.handle().clone())),
                ("hardware", hardware::spawn_watcher(app.handle().clone(), hardware_wake)),
                ("clipboard", clipboard::spawn_watcher(app.handle().clone(), clipboard_wake)),
                ("media", media::spawn_event_watcher(app.handle().clone())),
                ("system HUD", hud::spawn_watchers(app.handle().clone())),
            ] {
                if let Err(error) = started {
                    eprintln!("could not start the {name} watcher: {error}");
                }
            }

            // The app is usable without a tray icon, so a failure is not fatal.
            if let Err(error) = tray::setup(app.handle(), &initial_settings) {
                eprintln!("could not create the tray icon: {error}");
            }

            // Click-through is on from the first frame; the watcher turns it
            // off only while the cursor is on the capsule.
            window.set_ignore_cursor_events(true)?;

            // A failed lookup of the monitor is not fatal: the window simply
            // stays at the x/y from tauri.conf.json.
            if let Err(error) = center_top(&window) {
                eprintln!("could not center the notch window: {error}");
            }

            // Fullscreen auto-hide and the ultra-slim shape are extras: the
            // app still works if the detector cannot start.
            if let Err(error) = window_detector::spawn_watcher(window.clone()) {
                eprintln!("could not start the window detector: {error}");
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

    /// Island mode, idle: 180x28 at (170, 8) with fully rounded ends.
    const PILL: HitRegion = HitRegion {
        x: 170.0,
        y: 8.0,
        width: 180.0,
        height: 28.0,
        top_radius: 14.0,
        bottom_radius: 14.0,
        passive: false,
    };

    /// Notch mode, idle: 180x28 flush with the top edge, flat on top, with
    /// only the bottom corners rounded.
    const NOTCH: HitRegion = HitRegion {
        x: 170.0,
        y: 0.0,
        width: 180.0,
        height: 28.0,
        top_radius: 0.0,
        bottom_radius: 16.0,
        passive: false,
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
        let rect = HitRegion {
            top_radius: 0.0,
            bottom_radius: 0.0,
            ..PILL
        };
        assert!(rect.contains(170.0, 8.0));
        assert!(rect.contains(349.9, 35.9));
        assert!(!rect.contains(350.0, 36.0));
    }

    #[test]
    fn oversized_radii_are_scaled_down_like_css() {
        // "rounded-full": 9999px on a 28px-high box becomes 14px.
        let pill = HitRegion {
            top_radius: 9999.0,
            bottom_radius: 9999.0,
            ..PILL
        };
        assert_eq!(pill.fitted_radii(), (14.0, 14.0));
        assert!(pill.contains(260.0, 22.0));
        assert!(!pill.contains(171.0, 9.0));

        // A flat top leaves the whole height to the bottom corners.
        assert_eq!(NOTCH.fitted_radii(), (0.0, 16.0));
    }

    #[test]
    fn notch_is_flat_on_top_and_rounded_below() {
        // Top corners are square: the very first pixel row belongs to it,
        // right up to the screen edge.
        assert!(NOTCH.contains(170.0, 0.0));
        assert!(NOTCH.contains(349.9, 0.0));
        assert!(NOTCH.contains(260.0, 0.0));
        // Bottom corners are cut away.
        assert!(!NOTCH.contains(171.0, 27.0));
        assert!(!NOTCH.contains(349.0, 27.0));
        assert!(NOTCH.contains(260.0, 27.9));
        // Nothing below or beside it.
        assert!(!NOTCH.contains(260.0, 28.0));
        assert!(!NOTCH.contains(169.9, 5.0));
    }

    #[test]
    fn invalid_shapes_are_rejected() {
        assert!(PILL.is_valid());
        assert!(NOTCH.is_valid());
        assert!(!HitRegion { width: 0.0, ..PILL }.is_valid());
        assert!(!HitRegion { x: f64::NAN, ..PILL }.is_valid());
        assert!(
            !HitRegion {
                bottom_radius: -1.0,
                ..PILL
            }
            .is_valid()
        );
    }
}
