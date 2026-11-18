//! Shared plumbing for the background loops (notifications, hardware,
//! clipboard): COM setup, and whether they should slow down right now.
//!
//! The loops ease off while the capsule is off screen (a fullscreen app, or
//! hidden from the tray), under battery saver, and while the session is
//! locked. The frontend reports the first two through
//! `set_background_paused`; the lock is checked here.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager, State};
use windows::Win32::System::Com::CoIncrementMTAUsage;
use windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, DESKTOP_ACCESS_FLAGS, DESKTOP_CONTROL_FLAGS, GetUserObjectInformationW,
    OpenInputDesktop, UOI_NAME,
};

use super::settings::{Features, SettingsState};

/// Makes COM usable from any thread of the process.
///
/// Commands and background loops run on threads that never initialize COM
/// themselves. Holding one MTA usage reference for the lifetime of the app
/// puts every such thread in the multithreaded apartment implicitly.
pub fn ensure_com() {
    static MTA: OnceLock<()> = OnceLock::new();
    MTA.get_or_init(|| {
        // The cookie is deliberately never released.
        let _ = unsafe { CoIncrementMTAUsage() };
    });
}

/// Set by the frontend while the capsule is off screen or battery saver is on.
#[derive(Default)]
pub struct Background {
    paused: AtomicBool,
}

impl Background {
    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }
}

/// The frontend tells the background loops to ease off (`true`) or resume.
#[tauri::command]
pub fn set_background_paused(state: State<'_, Background>, paused: bool) {
    state.paused.store(paused, Ordering::Relaxed);
}

/// True while the lock screen (or a UAC prompt) owns the input desktop.
///
/// A normal process cannot open the secure desktop at all, and on the
/// interactive desktop the name is "Default".
pub fn is_session_locked() -> bool {
    unsafe {
        let Ok(desktop) = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_ACCESS_FLAGS(0))
        else {
            return true;
        };
        let mut name = [0u16; 64];
        let mut needed = 0u32;
        let read = GetUserObjectInformationW(
            windows::Win32::Foundation::HANDLE(desktop.0),
            UOI_NAME,
            Some(name.as_mut_ptr().cast()),
            (name.len() * 2) as u32,
            Some(&mut needed),
        );
        let _ = CloseDesktop(desktop);
        if read.is_err() {
            return false;
        }
        let length = name.iter().position(|&c| c == 0).unwrap_or(name.len());
        !String::from_utf16_lossy(&name[..length]).eq_ignore_ascii_case("Default")
    }
}

/// Whether the loops should run at their slow pace now.
pub fn should_slow_down(app: &AppHandle) -> bool {
    app.state::<Background>().is_paused() || is_session_locked()
}

/// The module switches as they are right now.
pub fn features(app: &AppHandle) -> Features {
    app.state::<SettingsState>().get().features
}
