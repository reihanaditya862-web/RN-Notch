//! Screenshot and screen recording through Windows' Snipping Tool, and
//! dragging files from the shelf out to other apps.
//!
//! Snipping Tool's documented URI protocol only answers packaged apps, so the
//! capsule presses its system shortcuts instead: Win+Shift+S for a snip,
//! Win+Shift+R for a recording. The command then waits while Snipping Tool's
//! overlay is in front, so the frontend can keep the capsule out of the shot.

use std::sync::{Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use tauri::WebviewWindow;
use serde::Serialize;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Ole::{DROPEFFECT_COPY, DROPEFFECT_LINK};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_KEYUP, SendInput,
    VIRTUAL_KEY, VK_LWIN, VK_SHIFT,
};
use windows::Win32::UI::Shell::{BHID_DataObject, IShellItem, SHCreateItemFromParsingName, SHDoDragDrop};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindowThreadProcessId, IsWindowVisible,
};
use windows::Win32::System::Com::IDataObject;
use windows::core::{BOOL, HSTRING, PWSTR};

/// Programs that draw Snipping Tool's capture overlay.
const SNIPPING_PROCESSES: [&str; 2] = ["screenclippinghost.exe", "snippingtool.exe"];

/// How long Snipping Tool gets to bring up its overlay.
const OVERLAY_START_TIMEOUT: Duration = Duration::from_millis(2500);
/// The user is still choosing an area; give up waiting after this.
const OVERLAY_MAX_DURATION: Duration = Duration::from_secs(120);
const WATCH_INTERVAL: Duration = Duration::from_millis(120);

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                ..Default::default()
            },
        },
    }
}

/// Presses Win+Shift+<letter> and lets go again.
fn press_win_shift(letter: u8) -> Result<(), String> {
    let letter = VIRTUAL_KEY(u16::from(letter));
    let inputs = [
        key(VK_LWIN, false),
        key(VK_SHIFT, false),
        key(letter, false),
        key(letter, true),
        key(VK_SHIFT, true),
        key(VK_LWIN, true),
    ];
    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("Windows did not accept the shortcut".into())
    }
}

/// File name of the program that owns the foreground window, lowercase.
fn foreground_program() -> Option<String> {
    unsafe {
        let window = GetForegroundWindow();
        if window.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(window, Some(&mut pid));
        program_file_name(pid)
    }
}

/// Full path of a process's executable.
pub fn program_path(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let read = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        );
        let _ = CloseHandle(process);
        read.ok()?;
        Some(String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

fn program_file_name(pid: u32) -> Option<String> {
    let path = program_path(pid)?;
    path.rsplit(['\\', '/']).next().map(str::to_lowercase)
}

fn snipping_in_front() -> bool {
    foreground_program().is_some_and(|name| SNIPPING_PROCESSES.contains(&name.as_str()))
}

/// The Snipping Tool processes seen running the last overlay RN Notch opened.
static SNIPPING_PIDS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

/// Remembers the process in front while it is Snipping Tool.
fn remember_snipping_process() {
    let pid = unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
        pid
    };
    if let Ok(mut pids) = SNIPPING_PIDS.lock()
        && pid != 0
        && !pids.contains(&pid)
    {
        pids.push(pid);
    }
}

unsafe extern "system" fn find_visible_window(window: HWND, found: LPARAM) -> BOOL {
    // SAFETY: `found` points at the `Search` that `snipping_tool_status` keeps alive.
    let search = unsafe { &mut *(found.0 as *mut Search) };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
    if search.pids.contains(&pid) && unsafe { IsWindowVisible(window) }.as_bool() {
        search.found = true;
        return BOOL(0);
    }
    BOOL(1)
}

struct Search {
    pids: Vec<u32>,
    found: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippingStatus {
    /// Snipping Tool is the app in front.
    in_front: bool,
    /// The Snipping Tool that opened the last overlay still shows a window
    /// (the recording toolbar, or its editor).
    has_window: bool,
}

/// Where Snipping Tool stands while a recording RN Notch started may run. The
/// user works in other apps meanwhile; Snipping Tool comes back to the front
/// when its toolbar is used to stop the recording, and has no window left
/// when the area selection was cancelled.
#[tauri::command]
pub fn snipping_tool_status() -> SnippingStatus {
    let pids = SNIPPING_PIDS.lock().map(|pids| pids.clone()).unwrap_or_default();
    let mut search = Search { pids, found: false };
    if !search.pids.is_empty() {
        let _ = unsafe { EnumWindows(Some(find_visible_window), LPARAM(&mut search as *mut Search as isize)) };
    }
    SnippingStatus {
        in_front: snipping_in_front(),
        has_window: search.found,
    }
}

/// Starts a snip ("screenshot") or a recording ("record") and returns once
/// Snipping Tool's overlay has closed again (the user picked an area or
/// cancelled). Fails when Snipping Tool did not open.
#[tauri::command(async)]
pub fn launch_snip(kind: String) -> Result<(), String> {
    let letter = match kind.as_str() {
        "screenshot" => b'S',
        "record" => b'R',
        _ => return Err(format!("unknown capture kind '{kind}'")),
    };
    if let Ok(mut pids) = SNIPPING_PIDS.lock() {
        pids.clear();
    }
    press_win_shift(letter)?;

    let started = Instant::now();
    while !snipping_in_front() {
        if started.elapsed() > OVERLAY_START_TIMEOUT {
            return Err("Snipping Tool did not open".into());
        }
        thread::sleep(WATCH_INTERVAL);
    }
    while snipping_in_front() && started.elapsed() < OVERLAY_MAX_DURATION {
        remember_snipping_process();
        thread::sleep(WATCH_INTERVAL);
    }
    Ok(())
}

/// Drags a shelf file out of the capsule into another app (a browser upload
/// field, a chat, a design tool), exactly as dragging it out of Explorer.
///
/// Must start while the mouse button is still held. The drag loop runs on the
/// window's thread; the command resolves when the file was dropped or the
/// drag cancelled, with "copied", "linked" or "cancelled".
#[tauri::command(async)]
pub fn start_file_drag(window: WebviewWindow, path: String) -> Result<&'static str, String> {
    if !std::path::Path::new(&path).exists() {
        return Err("the file is no longer there".into());
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let (sender, receiver) = mpsc::channel();

    window
        .run_on_main_thread(move || {
            let _ = sender.send(drag_file(HWND(hwnd as *mut _), &path));
        })
        .map_err(|error| error.to_string())?;

    receiver
        .recv()
        .map_err(|_| "the drag was interrupted".to_string())?
}

fn drag_file(window: HWND, path: &str) -> Result<&'static str, String> {
    unsafe {
        let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path), None)
            .map_err(|error| format!("could not open the file: {error}"))?;
        let data: IDataObject = item
            .BindToHandler(None, &BHID_DataObject)
            .map_err(|error| format!("could not prepare the drag: {error}"))?;
        let effect = SHDoDragDrop(Some(window), &data, None, DROPEFFECT_COPY | DROPEFFECT_LINK)
            .map_err(|error| format!("drag failed: {error}"))?;
        Ok(if effect.contains(DROPEFFECT_COPY) {
            "copied"
        } else if effect.contains(DROPEFFECT_LINK) {
            "linked"
        } else {
            "cancelled"
        })
    }
}
