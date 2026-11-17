//! Whether the user wants the capsule on screen (tray Show/Hide).
//!
//! Only the user's choice hides the real window. Stepping aside for a
//! fullscreen app is done by the frontend alone: it fades the capsule to
//! nothing and reports no clickable shape, while the (fully transparent,
//! click-through) window stays where it is.
//!
//! Earlier the window itself was hidden during fullscreen and shown again
//! afterwards without activating it. A webview brought back that way does not
//! reliably resume drawing until it receives input, which is how the capsule
//! could stay invisible after a game was minimized until the user clicked
//! somewhere. Not hiding the window removes that failure altogether.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};

use crate::NOTCH_LABEL;

pub struct Visibility {
    /// What the user chose in the tray.
    user_visible: AtomicBool,
}

impl Default for Visibility {
    fn default() -> Self {
        Self {
            user_visible: AtomicBool::new(true),
        }
    }
}

impl Visibility {
    pub fn is_user_visible(&self) -> bool {
        self.user_visible.load(Ordering::Relaxed)
    }
}

/// Records the user's Show/Hide choice and shows or hides the window.
///
/// This goes through Tauri, so the webview is suspended and resumed properly.
/// Showing activates the window, which is fine here: the user asked for it.
pub fn set_user_visible(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    app.state::<Visibility>()
        .user_visible
        .store(visible, Ordering::Relaxed);

    let Some(window) = app.get_webview_window(NOTCH_LABEL) else {
        return Ok(());
    };
    if visible { window.show() } else { window.hide() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_until_the_user_hides_it() {
        let visibility = Visibility::default();
        assert!(visibility.is_user_visible());

        visibility.user_visible.store(false, Ordering::Relaxed);
        assert!(!visibility.is_user_visible());
    }
}
