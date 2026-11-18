//! Shortcuts to the desktop AI apps in the media drawer: Claude, ChatGPT and
//! Gemini.
//!
//! Each one opens the installed app when there is one, found by its name in
//! Windows' list of installed apps (the Start menu's "All apps", which covers
//! Store apps, classic installers and browser-installed web apps alike), and
//! falls back to the website otherwise. The icon comes from the installed
//! app, or from the website's own icon.

use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, KF_FLAG_DEFAULT,
    SHGetKnownFolderItem, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING,
};

use super::background::ensure_com;
use super::{http, icons, notifications};

/// The list of installed apps is read again after this long.
const CATALOG_TTL: Duration = Duration::from_secs(10 * 60);
const ICON_SIZE: u32 = 32;

struct AiApp {
    id: &'static str,
    name: &'static str,
    /// Names the installed app may have in the Start menu.
    names: &'static [&'static str],
    url: &'static str,
    domain: &'static str,
}

const AI_APPS: [AiApp; 3] = [
    AiApp {
        id: "claude",
        name: "Claude",
        names: &["claude"],
        url: "https://claude.ai",
        domain: "claude.ai",
    },
    AiApp {
        id: "chatgpt",
        name: "ChatGPT",
        names: &["chatgpt"],
        url: "https://chatgpt.com",
        domain: "chatgpt.com",
    },
    AiApp {
        id: "gemini",
        name: "Gemini",
        names: &["gemini", "google gemini"],
        url: "https://gemini.google.com/app",
        domain: "gemini.google.com",
    },
];

/// One shortcut as the frontend shows it.
#[derive(Debug, Clone, Serialize)]
pub struct AiShortcut {
    pub id: &'static str,
    pub name: &'static str,
    /// The desktop app is installed; otherwise the website opens.
    pub installed: bool,
    /// PNG or other image `data:` URL; `None` when no icon could be found.
    pub icon: Option<String>,
}

/// Installed apps: display name (lowercase) and AppUserModelId.
type Catalog = Vec<(String, String)>;

fn catalog() -> Catalog {
    static CACHE: OnceLock<Mutex<Option<(Instant, Catalog)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    let mut cached = cache.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some((read_at, apps)) = cached.as_ref()
        && read_at.elapsed() < CATALOG_TTL
    {
        return apps.clone();
    }
    let apps = read_catalog().unwrap_or_default();
    *cached = Some((Instant::now(), apps.clone()));
    apps
}

/// Walks the shell's Apps folder.
fn read_catalog() -> windows::core::Result<Catalog> {
    ensure_com();
    let mut apps = Vec::new();
    unsafe {
        let folder: IShellItem = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)?;
        let items: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems)?;
        loop {
            let mut batch = [None];
            let mut fetched = 0u32;
            if items.Next(&mut batch, Some(&mut fetched)).is_err() || fetched == 0 {
                break;
            }
            let Some(item) = batch[0].take() else { break };
            let (Some(name), Some(id)) = (
                display_name(&item, SIGDN_NORMALDISPLAY),
                display_name(&item, SIGDN_PARENTRELATIVEPARSING),
            ) else {
                continue;
            };
            apps.push((name.to_lowercase(), id));
        }
    }
    Ok(apps)
}

unsafe fn display_name(
    item: &IShellItem,
    kind: windows::Win32::UI::Shell::SIGDN,
) -> Option<String> {
    unsafe {
        let name = item.GetDisplayName(kind).ok()?;
        let text = name.to_string().ok();
        CoTaskMemFree(Some(name.0 as *const _));
        text
    }
}

/// The installed app's id, matching the name exactly (so "Claude Code" or
/// "ChatGPT Atlas" do not stand in for the app itself).
fn installed_id(app: &AiApp, catalog: &Catalog) -> Option<String> {
    catalog
        .iter()
        .find(|(name, _)| app.names.contains(&name.as_str()))
        .map(|(_, id)| id.clone())
}

fn find(id: &str) -> Result<&'static AiApp, String> {
    AI_APPS
        .iter()
        .find(|app| app.id == id)
        .ok_or_else(|| format!("unknown app '{id}'"))
}

/// Icons found so far: app id, whether it was installed then, the icon.
type KnownIcons = Vec<(&'static str, bool, Option<String>)>;

/// The three shortcuts with their icons. Looks things up on disk and maybe on
/// the web the first time; cheap afterwards.
#[tauri::command(async)]
pub fn ai_shortcuts() -> Vec<AiShortcut> {
    static ICONS: OnceLock<Mutex<KnownIcons>> = OnceLock::new();
    let known = ICONS.get_or_init(|| Mutex::new(Vec::new()));

    let catalog = catalog();
    AI_APPS
        .iter()
        .map(|app| {
            let installed = installed_id(app, &catalog);
            let mut known = known.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some((_, was_installed, icon)) = known.iter().find(|(id, _, _)| *id == app.id)
                && *was_installed == installed.is_some()
                && icon.is_some()
            {
                return AiShortcut {
                    id: app.id,
                    name: app.name,
                    installed: installed.is_some(),
                    icon: icon.clone(),
                };
            }

            let icon = installed
                .as_deref()
                .and_then(|id| icons::shell_icon(&format!("shell:AppsFolder\\{id}"), ICON_SIZE))
                .or_else(|| {
                    http::image_data_url(&format!(
                        "https://www.google.com/s2/favicons?domain={}&sz=64",
                        app.domain
                    ))
                    .ok()
                });
            known.retain(|(id, _, _)| *id != app.id);
            known.push((app.id, installed.is_some(), icon.clone()));
            AiShortcut {
                id: app.id,
                name: app.name,
                installed: installed.is_some(),
                icon,
            }
        })
        .collect()
}

/// Opens the AI app, or its website when it is not installed. Returns "app"
/// or "web".
#[tauri::command(async)]
pub fn launch_ai(app: AppHandle, id: String) -> Result<&'static str, String> {
    let ai = find(&id)?;
    if let Some(app_id) = installed_id(ai, &catalog())
        && notifications::launch_app_id(&app_id).is_ok()
    {
        return Ok("app");
    }
    app.opener()
        .open_url(ai.url, None::<&str>)
        .map_err(|error| format!("could not open {}: {error}", ai.url))?;
    Ok("web")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apps(names: &[&str]) -> Catalog {
        names
            .iter()
            .map(|name| (name.to_lowercase(), format!("id-of-{name}")))
            .collect()
    }

    #[test]
    fn exact_names_only() {
        let installed = apps(&["Claude Code", "ChatGPT Atlas", "Google Gemini"]);
        assert_eq!(installed_id(&AI_APPS[0], &installed), None);
        assert_eq!(installed_id(&AI_APPS[1], &installed), None);
        assert_eq!(
            installed_id(&AI_APPS[2], &installed).as_deref(),
            Some("id-of-Google Gemini")
        );

        let installed = apps(&["Claude", "ChatGPT"]);
        assert_eq!(installed_id(&AI_APPS[0], &installed).as_deref(), Some("id-of-Claude"));
        assert_eq!(installed_id(&AI_APPS[1], &installed).as_deref(), Some("id-of-ChatGPT"));
    }

    #[test]
    fn unknown_ids_are_refused() {
        assert!(find("claude").is_ok());
        assert!(find("notepad").is_err());
    }
}
