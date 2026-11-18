//! Notifications from other apps and the browser, shown in the capsule.
//!
//! Windows lets a desktop app read the Action Center through
//! `UserNotificationListener` once the user allows it (Settings > Privacy >
//! Notifications). Its `NotificationChanged` event needs a packaged app, so
//! the list is read every 1.5 s instead and only notifications with an id not
//! seen before are passed on. Whatever is already there when the loop starts,
//! or arrives while the capsule is off screen, is never announced.

use std::collections::HashSet;
use std::process::Command;
use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};

use super::background::{ensure_com, features, should_slow_down};
use super::icons;

/// Emitted with an `AppNotification` for each new notification.
pub const NOTIFICATION_EVENT: &str = "app-notification";

const POLL_FAST: Duration = Duration::from_millis(1500);
const POLL_SLOW: Duration = Duration::from_secs(5);

/// A burst (an app sending ten at once) is cut to the newest few.
const MAX_PER_ROUND: usize = 3;
const TITLE_MAX_CHARS: usize = 120;
const BODY_MAX_CHARS: usize = 240;
const ICON_SIZE: u32 = 48;

#[derive(Debug, Clone, Serialize)]
pub struct AppNotification {
    pub id: u32,
    /// Display name of the app that sent it, e.g. "WhatsApp".
    pub app: String,
    /// Identifies the app, for opening it; `None` when Windows does not say.
    pub app_id: Option<String>,
    pub title: String,
    pub body: String,
    /// The app's icon as a PNG `data:` URL, when the shell has one.
    pub icon: Option<String>,
}

/// What the listener last reported about access, for the settings panel.
#[derive(Default)]
pub struct NotificationAccess {
    status: Mutex<Option<&'static str>>,
}

impl NotificationAccess {
    fn set(&self, status: &'static str) {
        *self.status.lock().unwrap_or_else(PoisonError::into_inner) = Some(status);
    }
}

fn access_status(listener: &UserNotificationListener) -> &'static str {
    match listener.GetAccessStatus() {
        Ok(UserNotificationListenerAccessStatus::Allowed) => "allowed",
        Ok(UserNotificationListenerAccessStatus::Denied) => "denied",
        Ok(_) => "unspecified",
        Err(_) => "unavailable",
    }
}

/// "allowed", "denied", "unspecified" (never asked) or "unavailable" (this
/// Windows cannot share notifications with the app).
#[tauri::command(async)]
pub fn notification_access(state: State<'_, NotificationAccess>) -> &'static str {
    ensure_com();
    let status = match UserNotificationListener::Current() {
        Ok(listener) => access_status(&listener),
        Err(_) => "unavailable",
    };
    state.set(status);
    status
}

/// Starts the loop that watches for new notifications.
pub fn spawn_watcher(app: AppHandle) -> std::io::Result<()> {
    thread::Builder::new()
        .name("notch-notifications".into())
        .spawn(move || watch(&app))
        .map(|_| ())
}

fn watch(app: &AppHandle) {
    ensure_com();
    let mut seen: HashSet<u32> = HashSet::new();
    let mut primed = false;

    loop {
        let slow = should_slow_down(app);
        thread::sleep(if slow { POLL_SLOW } else { POLL_FAST });

        if !features(app).notifications {
            // Starting again later must not replay what came in meanwhile.
            primed = false;
            continue;
        }
        let Ok(listener) = UserNotificationListener::Current() else {
            app.state::<NotificationAccess>().set("unavailable");
            continue;
        };
        let status = access_status(&listener);
        app.state::<NotificationAccess>().set(status);
        if status != "allowed" {
            primed = false;
            continue;
        }

        let Ok(list) = listener
            .GetNotificationsAsync(NotificationKinds::Toast)
            .and_then(|operation| operation.join())
        else {
            continue;
        };

        let mut current = HashSet::new();
        let mut fresh = Vec::new();
        for item in list {
            let Ok(id) = item.Id() else { continue };
            current.insert(id);
            if primed && !seen.contains(&id) {
                fresh.push(item);
            }
        }
        seen = current;
        let announce = primed && !slow;
        primed = true;
        if !announce {
            continue;
        }

        // Newest last in the list; keep the newest few, oldest first.
        let skip = fresh.len().saturating_sub(MAX_PER_ROUND);
        for item in fresh.into_iter().skip(skip) {
            if let Some(notification) = read_notification(&item) {
                let _ = app.emit(NOTIFICATION_EVENT, notification);
            }
        }
    }
}

fn read_notification(item: &UserNotification) -> Option<AppNotification> {
    let id = item.Id().ok()?;
    let info = item.AppInfo().ok();
    let app = info
        .as_ref()
        .and_then(|info| info.DisplayInfo().ok())
        .and_then(|display| display.DisplayName().ok())
        .map(|name| name.to_string())
        .unwrap_or_default();
    let app_id = info
        .as_ref()
        .and_then(|info| info.AppUserModelId().ok())
        .map(|id| id.to_string())
        .filter(|id| !id.is_empty());

    let texts: Vec<String> = item
        .Notification()
        .and_then(|notification| notification.Visual())
        .and_then(|visual| visual.GetBinding(&KnownNotificationBindings::ToastGeneric()?))
        .and_then(|binding| binding.GetTextElements())
        .map(|elements| {
            elements
                .into_iter()
                .filter_map(|element| element.Text().ok())
                .map(|text| text.to_string().trim().to_string())
                .filter(|text| !text.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let (title, body) = split_texts(&texts, &app);
    if title.is_empty() && body.is_empty() {
        return None;
    }

    let icon = app_id
        .as_deref()
        .and_then(|id| icons::shell_icon(&format!("shell:AppsFolder\\{id}"), ICON_SIZE));

    Some(AppNotification {
        id,
        app: if app.is_empty() { "Notification".into() } else { app },
        app_id,
        title,
        body,
        icon,
    })
}

/// First text line is the title, the rest is the body. A notification with a
/// single line uses the app's name as its title.
fn split_texts(texts: &[String], app: &str) -> (String, String) {
    let (title, rest) = match texts {
        [] => (String::new(), &[][..]),
        [only] if !app.is_empty() => (app.to_string(), std::slice::from_ref(only)),
        [first, rest @ ..] => (first.clone(), rest),
    };
    (
        shorten(&title, TITLE_MAX_CHARS),
        shorten(&rest.join(" "), BODY_MAX_CHARS),
    )
}

/// Collapses whitespace and cuts to `max` characters with an ellipsis.
fn shorten(text: &str, max: usize) -> String {
    let single_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.chars().count() <= max {
        return single_line;
    }
    let mut cut: String = single_line.chars().take(max.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

/// An AppUserModelId as Windows writes them. Classic programs sometimes use a
/// known-folder path (`{GUID}\Vendor\app.exe`), so backslashes are allowed,
/// but no quotes, parent-folder steps or control characters.
fn is_plain_app_id(app_id: &str) -> bool {
    !app_id.is_empty()
        && app_id.len() <= 512
        && !app_id.contains("..")
        && app_id.chars().all(|c| {
            c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | '!' | '{' | '}' | ' ' | '\\' | '+')
        })
}

/// Brings up the app with this AppUserModelId (the sender of a notification,
/// or one of the AI apps), the way the Start menu would.
pub fn launch_app_id(app_id: &str) -> Result<(), String> {
    if !is_plain_app_id(app_id) {
        return Err("not an app id".into());
    }
    Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{app_id}"))
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not open the app: {error}"))
}

#[tauri::command(async)]
pub fn open_app(app_id: String) -> Result<(), String> {
    launch_app_id(&app_id)
}

/// Opens Settings > Privacy & security > Notifications, where the user allows
/// apps to read notifications.
#[tauri::command(async)]
pub fn open_notification_settings(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("ms-settings:privacy-notifications", None::<&str>)
        .map_err(|error| format!("could not open Windows Settings: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(lines: &[&str]) -> Vec<String> {
        lines.iter().map(|line| line.to_string()).collect()
    }

    #[test]
    fn first_line_is_the_title() {
        let (title, body) = split_texts(&texts(&["Rina", "See you at", "eight"]), "WhatsApp");
        assert_eq!(title, "Rina");
        assert_eq!(body, "See you at eight");
    }

    #[test]
    fn a_single_line_gets_the_app_as_title() {
        assert_eq!(
            split_texts(&texts(&["Download complete"]), "Chrome"),
            ("Chrome".into(), "Download complete".into())
        );
        assert_eq!(
            split_texts(&texts(&["Download complete"]), ""),
            ("Download complete".into(), String::new())
        );
        assert_eq!(split_texts(&[], "Chrome"), (String::new(), String::new()));
    }

    #[test]
    fn long_text_is_cut_and_flattened() {
        assert_eq!(shorten("a\n  b\tc", 10), "a b c");
        let long = "x".repeat(300);
        let cut = shorten(&long, 120);
        assert_eq!(cut.chars().count(), 120);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn app_ids_are_checked_before_launching() {
        assert!(is_plain_app_id("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"));
        assert!(is_plain_app_id("com.squirrel.AnthropicClaude.claude"));
        assert!(is_plain_app_id("{6D809377-6AF0-444B-8957-A3773F02200E}"));
        assert!(!is_plain_app_id(""));
        assert!(!is_plain_app_id("calc\" & del"));
        assert!(!is_plain_app_id("..\\..\\windows"));
        assert!(!is_plain_app_id("a\nb"));
    }
}
