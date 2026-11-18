//! Eyedropper: picks the colour of any pixel on screen and copies its hex code.
//!
//! Starting it opens a transparent, borderless window over the monitor the
//! cursor is on. It shows a crosshair and a small preview of the colour under
//! the cursor, and takes the click itself, so the app underneath does not
//! receive it. A click picks, Esc or a right click cancels.

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};
use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{
    CLR_INVALID, GetDC, GetMonitorInfoW, GetPixel, MONITOR_DEFAULTTONEAREST, MONITORINFO,
    MonitorFromPoint, ReleaseDC,
};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

use super::clipboard;
use crate::NOTCH_LABEL;

/// Label of the eyedropper window; the frontend renders the picker for it.
pub const PICKER_LABEL: &str = "picker";

/// Sent to the capsule with the picked "#RRGGBB".
pub const COLOR_PICKED_EVENT: &str = "color-picked";

fn cursor() -> Option<POINT> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some(point)
}

/// "#RRGGBB" of the screen pixel at `point` (physical px).
fn pixel_hex(point: POINT) -> Option<String> {
    unsafe {
        let dc = GetDC(None);
        if dc.is_invalid() {
            return None;
        }
        let color = GetPixel(dc, point.x, point.y);
        ReleaseDC(None, dc);
        if color.0 == CLR_INVALID {
            return None;
        }
        Some(colorref_hex(color.0))
    }
}

/// A COLORREF is 0x00BBGGRR.
fn colorref_hex(color: u32) -> String {
    let red = color & 0xFF;
    let green = (color >> 8) & 0xFF;
    let blue = (color >> 16) & 0xFF;
    format!("#{red:02X}{green:02X}{blue:02X}")
}

/// Opens the eyedropper over the monitor under the cursor.
#[tauri::command(async)]
pub fn start_color_pick(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PICKER_LABEL) {
        let _ = window.set_focus();
        return Ok(());
    }

    let point = cursor().ok_or("could not read the cursor position")?;
    let mut monitor = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let bounds = unsafe {
        let handle = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        if !GetMonitorInfoW(handle, &mut monitor).as_bool() {
            return Err("could not read the monitor".into());
        }
        monitor.rcMonitor
    };

    let window = WebviewWindowBuilder::new(&app, PICKER_LABEL, WebviewUrl::App("index.html".into()))
        .title("RN Notch colour picker")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|error| format!("could not open the colour picker: {error}"))?;

    let _ = window.set_position(PhysicalPosition::new(bounds.left, bounds.top));
    let _ = window.set_size(PhysicalSize::new(
        (bounds.right - bounds.left).max(1) as u32,
        (bounds.bottom - bounds.top).max(1) as u32,
    ));
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

/// Colour under the cursor right now, for the live preview.
#[tauri::command]
pub fn pixel_at_cursor() -> Option<String> {
    pixel_hex(cursor()?)
}

/// Ends the eyedropper. With `pick`, reads the colour under the cursor,
/// copies it and tells the capsule; returns it.
#[tauri::command(async)]
pub fn finish_color_pick(app: AppHandle, pick: bool) -> Result<Option<String>, String> {
    let color = if pick { cursor().and_then(pixel_hex) } else { None };

    if let Some(window) = app.get_webview_window(PICKER_LABEL) {
        let _ = window.destroy();
    }
    if let Some(hex) = &color {
        clipboard::write_text(hex)?;
        let _ = app.emit_to(NOTCH_LABEL, COLOR_PICKED_EVENT, hex.clone());
    }
    Ok(color)
}

#[cfg(test)]
mod tests {
    use super::colorref_hex;

    #[test]
    fn colorref_is_blue_green_red() {
        assert_eq!(colorref_hex(0x0000_00FF), "#FF0000");
        assert_eq!(colorref_hex(0x00FF_0000), "#0000FF");
        assert_eq!(colorref_hex(0x0012_3456), "#563412");
    }
}
