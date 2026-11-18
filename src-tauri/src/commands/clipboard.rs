//! Clipboard history: text copied anywhere in Windows is passed to the
//! frontend, which keeps the last ten entries in memory (never on disk), each
//! cut to 500 characters.
//!
//! The loop sleeps until Windows reports a clipboard change, then compares
//! the sequence number and reads the text when it changed. Images and files are
//! ignored, and so is anything a password manager marks as private
//! (`ExcludeClipboardContentFromMonitorProcessing`, or
//! `CanIncludeInClipboardHistory` = 0, the flags Windows' own history obeys).

use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber,
    IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock,
};
use windows::core::w;

use super::background::features;

/// Emitted with the copied text.
pub const CLIPBOARD_EVENT: &str = "clipboard-text";

/// The sequence number is still compared this often, in case an event is lost.
const SAFETY_INTERVAL: Duration = Duration::from_secs(30);

/// Each entry keeps at most this many characters; a whole document copied
/// is cut, so the history stays small.
const MAX_CHARS: usize = 500;
/// Longest text accepted for copying back.
const WRITE_MAX_CHARS: usize = 4000;

/// `CF_UNICODETEXT`.
const CF_UNICODETEXT: u32 = 13;

/// Starts the loop that follows the clipboard. It sleeps until Windows says
/// the clipboard changed (`WM_CLIPBOARDUPDATE`, see `events.rs`).
pub fn spawn_watcher(app: AppHandle, wake: Receiver<()>) -> std::io::Result<()> {
    thread::Builder::new()
        .name("notch-clipboard".into())
        .spawn(move || watch(&app, &wake))
        .map(|_| ())
}

fn watch(app: &AppHandle, wake: &Receiver<()>) {
    // What is on the clipboard when the loop starts is not "new".
    let mut last = unsafe { GetClipboardSequenceNumber() };

    loop {
        match wake.recv_timeout(SAFETY_INTERVAL) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => thread::sleep(SAFETY_INTERVAL),
        }
        while wake.try_recv().is_ok() {}

        let sequence = unsafe { GetClipboardSequenceNumber() };
        if sequence == last {
            continue;
        }
        last = sequence;

        if !features(app).clipboard_history {
            continue;
        }
        if let Some(text) = read_text() {
            let _ = app.emit(CLIPBOARD_EVENT, text);
        }
    }
}

/// Another program may hold the clipboard for a moment; try a few times.
fn open_clipboard() -> bool {
    for _ in 0..5 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(15));
    }
    false
}

fn is_private() -> bool {
    unsafe {
        let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
        if exclude != 0 && IsClipboardFormatAvailable(exclude).is_ok() {
            return true;
        }
        let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        if history != 0
            && IsClipboardFormatAvailable(history).is_ok()
            && let Ok(handle) = GetClipboardData(history)
        {
            let memory = HGLOBAL(handle.0);
            let pointer = GlobalLock(memory) as *const u32;
            let allowed = pointer.is_null() || GlobalSize(memory) < 4 || pointer.read_unaligned() != 0;
            let _ = GlobalUnlock(memory);
            return !allowed;
        }
        false
    }
}

fn read_text() -> Option<String> {
    if unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) }.is_err() || !open_clipboard() {
        return None;
    }
    let text = unsafe {
        if is_private() {
            None
        } else {
            read_locked_text()
        }
    };
    unsafe {
        let _ = CloseClipboard();
    }
    text.map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
        .map(|text| text.chars().take(MAX_CHARS).collect())
}

/// Reads `CF_UNICODETEXT`; the clipboard must be open.
unsafe fn read_locked_text() -> Option<String> {
    unsafe {
        let handle = GetClipboardData(CF_UNICODETEXT).ok()?;
        let memory = HGLOBAL(handle.0);
        let pointer = GlobalLock(memory) as *const u16;
        if pointer.is_null() {
            return None;
        }
        // Never read past the block, even when the text lacks its final nul.
        let units = (GlobalSize(memory) / 2).min(MAX_CHARS * 2 + 2);
        let slice = std::slice::from_raw_parts(pointer, units);
        let length = slice.iter().position(|&unit| unit == 0).unwrap_or(units);
        let text = String::from_utf16_lossy(&slice[..length]);
        let _ = GlobalUnlock(memory);
        Some(text)
    }
}

/// Puts text on the clipboard (a history entry clicked, a picked colour).
pub fn write_text(text: &str) -> Result<(), String> {
    let mut units: Vec<u16> = text.encode_utf16().collect();
    units.push(0);

    if !open_clipboard() {
        return Err("the clipboard is busy".into());
    }
    let result = unsafe {
        (|| -> Result<(), String> {
            EmptyClipboard().map_err(|error| error.to_string())?;
            let memory = GlobalAlloc(GMEM_MOVEABLE, units.len() * 2).map_err(|e| e.to_string())?;
            let pointer = GlobalLock(memory) as *mut u16;
            if pointer.is_null() {
                let _ = GlobalFree(Some(memory));
                return Err("could not lock clipboard memory".into());
            }
            std::ptr::copy_nonoverlapping(units.as_ptr(), pointer, units.len());
            let _ = GlobalUnlock(memory);
            if let Err(error) = SetClipboardData(CF_UNICODETEXT, Some(HANDLE(memory.0))) {
                // Ownership only passes to Windows on success.
                let _ = GlobalFree(Some(memory));
                return Err(error.to_string());
            }
            Ok(())
        })()
    };
    unsafe {
        let _ = CloseClipboard();
    }
    result.map_err(|error| format!("could not copy: {error}"))
}

#[tauri::command(async)]
pub fn write_clipboard_text(text: String) -> Result<(), String> {
    if text.chars().count() > WRITE_MAX_CHARS {
        return Err("text too long".into());
    }
    write_text(&text)
}
