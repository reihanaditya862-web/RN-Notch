//! Memory while the capsule sits collapsed, which is most of the day.
//!
//! Two documented levers, both undone the moment the capsule opens:
//! - WebView2's memory target (`ICoreWebView2_19::MemoryUsageTargetLevel`).
//!   At `Low` the browser engine trims its caches and hands memory back from
//!   its own processes (renderer, GPU) as an inactive app would.
//! - This process's working set: `SetProcessWorkingSetSizeEx` with both
//!   limits at `usize::MAX` asks Windows to move pages nobody touched lately
//!   out of physical memory (onto the standby list, from which they return at
//!   once when needed).
//!
//! Only RN Notch's own process and its own WebView are touched; other
//! processes are never opened.

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    ICoreWebView2_19,
};
use windows::Win32::System::Memory::{SETPROCESSWORKINGSETSIZEEX_FLAGS, SetProcessWorkingSetSizeEx};
use windows::Win32::System::Threading::GetCurrentProcess;
use windows::core::Interface;

/// `low` when the capsule has finished collapsing (or went off screen),
/// `false` as soon as it opens again.
#[tauri::command]
pub fn set_memory_mode(window: WebviewWindow, low: bool) -> Result<(), String> {
    window
        .with_webview(move |webview| {
            let level = if low {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
            } else {
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
            };
            // An older WebView2 runtime has no memory target: nothing to do.
            unsafe {
                if let Ok(core) = webview.controller().CoreWebView2()
                    && let Ok(core) = core.cast::<ICoreWebView2_19>()
                {
                    let _ = core.SetMemoryUsageTargetLevel(level);
                }
            }
        })
        .map_err(|error| error.to_string())?;

    if low {
        // SAFETY: the pseudo handle of the current process is always valid.
        unsafe {
            let _ = SetProcessWorkingSetSizeEx(
                GetCurrentProcess(),
                usize::MAX,
                usize::MAX,
                SETPROCESSWORKINGSETSIZEEX_FLAGS(0),
            );
        }
    }
    Ok(())
}
