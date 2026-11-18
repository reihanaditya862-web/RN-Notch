//! Windows tells us when things change, so the background loops can sleep.
//!
//! A hidden, unowned top-level window (it never shows) receives the system's
//! broadcast messages: `WM_CLIPBOARDUPDATE` (through a clipboard format
//! listener), `WM_POWERBROADCAST` (charger plugged or pulled, battery level),
//! `WM_DISPLAYCHANGE` and `WM_DEVICECHANGE` (a monitor came or went). Wi-Fi
//! changes arrive through `NetworkInformation.NetworkStatusChanged` and
//! Bluetooth connections through two `DeviceWatcher`s. Each event only wakes
//! the loop that cares; the loops then read the new state themselves.
//!
//! The same window gets `WM_WTSSESSION_CHANGE`, which says when the session
//! is locked and unlocked, so nothing has to poll for the lock screen.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationUpdate, DeviceWatcher};
use windows::Foundation::TypedEventHandler;
use windows::Networking::Connectivity::{NetworkInformation, NetworkStatusChangedEventHandler};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::AddClipboardFormatListener;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::{NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, MSG, RegisterClassW,
    TranslateMessage, WINDOW_STYLE, WM_CLIPBOARDUPDATE, WM_DEVICECHANGE, WM_DISPLAYCHANGE,
    WM_POWERBROADCAST, WM_WTSSESSION_CHANGE, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
};
use windows::core::w;

use super::background::ensure_com;

/// What the background loops wait on.
pub struct Wakeups {
    pub hardware: Receiver<()>,
    pub clipboard: Receiver<()>,
}

static HARDWARE: OnceLock<Sender<()>> = OnceLock::new();
static CLIPBOARD: OnceLock<Sender<()>> = OnceLock::new();
/// Whether the session is locked, as last reported by Windows.
static LOCKED: AtomicBool = AtomicBool::new(false);

/// True while the session is locked (the lock screen is up).
pub fn session_locked() -> bool {
    LOCKED.load(Ordering::Relaxed)
}

fn wake(channel: &OnceLock<Sender<()>>) {
    if let Some(sender) = channel.get() {
        let _ = sender.send(());
    }
}

unsafe extern "system" fn window_proc(
    window: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_CLIPBOARDUPDATE => wake(&CLIPBOARD),
        WM_POWERBROADCAST | WM_DISPLAYCHANGE | WM_DEVICECHANGE => wake(&HARDWARE),
        WM_WTSSESSION_CHANGE => match wparam.0 as u32 {
            WTS_SESSION_LOCK => LOCKED.store(true, Ordering::Relaxed),
            WTS_SESSION_UNLOCK => LOCKED.store(false, Ordering::Relaxed),
            _ => {}
        },
        _ => {}
    }
    unsafe { DefWindowProcW(window, message, wparam, lparam) }
}

/// Starts listening. The returned receivers get a message whenever something
/// may have changed; nothing is sent while nothing happens.
pub fn start() -> std::io::Result<Wakeups> {
    let (hardware_tx, hardware) = mpsc::channel();
    let (clipboard_tx, clipboard) = mpsc::channel();
    let _ = HARDWARE.set(hardware_tx);
    let _ = CLIPBOARD.set(clipboard_tx);

    thread::Builder::new()
        .name("notch-events".into())
        .spawn(run)?;
    Ok(Wakeups { hardware, clipboard })
}

fn run() {
    ensure_com();

    // Kept alive for as long as the thread runs, which is the app's lifetime.
    let _network = NetworkInformation::NetworkStatusChanged(&NetworkStatusChangedEventHandler::new(
        |_| {
            wake(&HARDWARE);
            Ok(())
        },
    ));
    let _bluetooth: Vec<DeviceWatcher> = [
        BluetoothDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected),
        BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(
            BluetoothConnectionStatus::Connected,
        ),
    ]
    .into_iter()
    .filter_map(|selector| watch_devices(&selector.ok()?).ok())
    .collect();

    unsafe {
        let Ok(module) = GetModuleHandleW(None) else {
            return;
        };
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: module.into(),
            lpszClassName: w!("RNNotchEvents"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return;
        }
        // Unowned and top-level, so it gets the broadcasts; never shown.
        let Ok(window) = CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            w!("RNNotchEvents"),
            w!("RN Notch events"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            None,
            None,
            Some(module.into()),
            None,
        ) else {
            return;
        };
        let _ = AddClipboardFormatListener(window);
        let _ = WTSRegisterSessionNotification(window, NOTIFY_FOR_THIS_SESSION);

        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

/// A device watcher that wakes the hardware loop whenever a matching device
/// appears, changes or goes away.
fn watch_devices(selector: &windows::core::HSTRING) -> windows::core::Result<DeviceWatcher> {
    let watcher = DeviceInformation::CreateWatcherAqsFilter(selector)?;
    watcher.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(|_, _| {
        wake(&HARDWARE);
        Ok(())
    }))?;
    watcher.Updated(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
        |_, _| {
            wake(&HARDWARE);
            Ok(())
        },
    ))?;
    watcher.Removed(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
        |_, _| {
            wake(&HARDWARE);
            Ok(())
        },
    ))?;
    watcher.Start()?;
    Ok(watcher)
}
