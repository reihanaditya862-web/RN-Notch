//! Whether the capsule's window is on screen.
//!
//! Two parties have a say: the user (tray Show/Hide) and the fullscreen
//! watcher (auto-hide while a game or a fullscreen video is in front). The
//! window is shown only when both agree.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};
use windows::Win32::UI::WindowsAndMessaging::{SW_HIDE, SW_SHOWNOACTIVATE, ShowWindow};

use crate::NOTCH_LABEL;

pub struct Visibility {
    /// What the user chose in the tray.
    user_visible: AtomicBool,
    /// A fullscreen app is in the foreground.
    fullscreen: AtomicBool,
}

impl Default for Visibility {
    fn default() -> Self {
        Self {
            user_visible: AtomicBool::new(true),
            fullscreen: AtomicBool::new(false),
        }
    }
}

impl Visibility {
    pub fn is_user_visible(&self) -> bool {
        self.user_visible.load(Ordering::Relaxed)
    }

    fn should_show(&self) -> bool {
        self.is_user_visible() && !self.fullscreen.load(Ordering::Relaxed)
    }
}

/// Shows or hides the window to match the current state.
///
/// The window is shown *without activating it*: when a fullscreen video ends,
/// keyboard focus must stay with the app the user returned to, not jump to
/// the capsule.
fn apply(app: &AppHandle) {
    let Some(window) = app.get_webview_window(NOTCH_LABEL) else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let command = if app.state::<Visibility>().should_show() {
        SW_SHOWNOACTIVATE
    } else {
        SW_HIDE
    };
    // The return value is the previous visibility, not an error.
    let _ = unsafe { ShowWindow(hwnd, command) };
}

/// Records the user's Show/Hide choice and applies it.
pub fn set_user_visible(app: &AppHandle, visible: bool) {
    app.state::<Visibility>()
        .user_visible
        .store(visible, Ordering::Relaxed);
    apply(app);
}

/// Records whether a fullscreen app is in front and applies it.
pub fn set_fullscreen(app: &AppHandle, active: bool) {
    app.state::<Visibility>()
        .fullscreen
        .store(active, Ordering::Relaxed);
    apply(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shown_only_when_the_user_and_the_fullscreen_watcher_agree() {
        let visibility = Visibility::default();
        assert!(visibility.should_show());

        visibility.fullscreen.store(true, Ordering::Relaxed);
        assert!(!visibility.should_show());

        visibility.fullscreen.store(false, Ordering::Relaxed);
        visibility.user_visible.store(false, Ordering::Relaxed);
        assert!(!visibility.should_show());

        // Leaving fullscreen must not undo the user's Hide.
        visibility.fullscreen.store(true, Ordering::Relaxed);
        visibility.fullscreen.store(false, Ordering::Relaxed);
        assert!(!visibility.should_show());
    }
}
