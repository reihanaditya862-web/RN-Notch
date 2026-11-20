//! The system HUD: Windows reports every change of the master volume and of
//! the screen brightness, and each one becomes a `system-hud` event for the
//! frontend's volume/brightness pill. Nothing is polled.
//!
//! - Volume: an `IAudioEndpointVolumeCallback` on the default output device,
//!   moved to the new device whenever the default changes
//!   (`IMMNotificationClient`). Changes made by RN Notch's own slider carry
//!   `RN_NOTCH_AUDIO_CONTEXT` and are left out: the slider shows the value.
//! - Brightness: the WMI event `WmiMonitorBrightnessEvent` (built-in laptop
//!   screens; external monitors do not report one).
//!
//! Events are only sent while `features.system_hud` is on.

use std::sync::mpsc::{self, Sender};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::Endpoints::{
    IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
};
use windows::Win32::Media::Audio::{
    AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE, EDataFlow, ERole, IMMDeviceEnumerator,
    IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, eMultimedia, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, CLSCTX_INPROC_SERVER, CoCreateInstance, CoSetProxyBlanket, EOAC_NONE,
    RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE,
};
use windows::Win32::System::Rpc::{RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE};
use windows::Win32::System::Variant::{VARIANT, VT_UI1, VariantClear};
use windows::Win32::System::Wmi::{
    IWbemClassObject, IWbemLocator, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY,
    WBEM_INFINITE, WbemLocator,
};
use windows::core::{BSTR, GUID, PCWSTR, implement, w};

use super::background::{ensure_com, features};

/// Marks volume changes made by RN Notch itself (see `audio.rs`).
pub const RN_NOTCH_AUDIO_CONTEXT: GUID = GUID::from_u128(0x6f3c_2a91_5d0e_4b7a_9c1e_52a8_d3f0_7b46);

const HUD_EVENT: &str = "system-hud";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct HudEvent {
    /// "volume" or "brightness".
    kind: &'static str,
    /// 0-100.
    level: u8,
    muted: bool,
}

fn send(app: &AppHandle, event: HudEvent) {
    if features(app).system_hud {
        let _ = app.emit(HUD_EVENT, event);
    }
}

/// Starts both listeners on their own threads. Either may fail on its own
/// (no audio device, no WMI brightness provider); that is only logged.
pub fn spawn_watchers(app: AppHandle) -> std::io::Result<()> {
    let volume_app = app.clone();
    thread::Builder::new()
        .name("notch-hud-volume".into())
        .spawn(move || {
            if let Err(error) = watch_volume(&volume_app) {
                eprintln!("volume HUD unavailable: {error}");
            }
        })?;
    thread::Builder::new()
        .name("notch-hud-brightness".into())
        .spawn(move || {
            if let Err(error) = watch_brightness(&app) {
                eprintln!("brightness HUD unavailable: {error}");
            }
        })?;
    Ok(())
}

// --- Volume -------------------------------------------------------------------

#[implement(IAudioEndpointVolumeCallback)]
struct VolumeListener {
    app: AppHandle,
}

impl IAudioEndpointVolumeCallback_Impl for VolumeListener_Impl {
    fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        // SAFETY: Windows passes a valid pointer for the duration of the call.
        let Some(data) = (unsafe { data.as_ref() }) else {
            return Ok(());
        };
        if data.guidEventContext == RN_NOTCH_AUDIO_CONTEXT {
            return Ok(());
        }
        send(
            &self.app,
            HudEvent {
                kind: "volume",
                level: (data.fMasterVolume.clamp(0.0, 1.0) * 100.0).round() as u8,
                muted: data.bMuted.as_bool(),
            },
        );
        Ok(())
    }
}

/// Wakes the volume thread when the default output device changes.
#[implement(IMMNotificationClient)]
struct DefaultDeviceListener {
    changed: Sender<()>,
}

impl IMMNotificationClient_Impl for DefaultDeviceListener_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceAdded(&self, _: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDefaultDeviceChanged(
        &self,
        flow: EDataFlow,
        role: ERole,
        _: &PCWSTR,
    ) -> windows::core::Result<()> {
        if flow == eRender && role == eMultimedia {
            let _ = self.changed.send(());
        }
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

fn watch_volume(app: &AppHandle) -> windows::core::Result<()> {
    ensure_com();
    let (changed, default_changed) = mpsc::channel();
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let device_listener: IMMNotificationClient = DefaultDeviceListener { changed }.into();
    unsafe { enumerator.RegisterEndpointNotificationCallback(&device_listener)? };
    let volume_listener: IAudioEndpointVolumeCallback = VolumeListener { app: app.clone() }.into();

    loop {
        // Kept until the default device changes; then the callback moves.
        let endpoint: Option<IAudioEndpointVolume> = unsafe {
            enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .and_then(|device| device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None))
                .ok()
        };
        if let Some(endpoint) = &endpoint {
            unsafe { endpoint.RegisterControlChangeNotify(&volume_listener)? };
        }
        if default_changed.recv().is_err() {
            return Ok(());
        }
        // Several notifications arrive for one switch; handle them once.
        while default_changed.try_recv().is_ok() {}
        if let Some(endpoint) = &endpoint {
            let _ = unsafe { endpoint.UnregisterControlChangeNotify(&volume_listener) };
        }
    }
}

// --- Brightness ---------------------------------------------------------------

fn watch_brightness(app: &AppHandle) -> windows::core::Result<()> {
    ensure_com();
    let events = unsafe {
        let locator: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER)?;
        let services = locator.ConnectServer(
            &BSTR::from("ROOT\\WMI"),
            &BSTR::new(),
            &BSTR::new(),
            &BSTR::new(),
            0,
            &BSTR::new(),
            None,
        )?;
        CoSetProxyBlanket(
            &services,
            RPC_C_AUTHN_WINNT,
            RPC_C_AUTHZ_NONE,
            PCWSTR::null(),
            RPC_C_AUTHN_LEVEL_CALL,
            RPC_C_IMP_LEVEL_IMPERSONATE,
            None,
            EOAC_NONE,
        )?;
        services.ExecNotificationQuery(
            &BSTR::from("WQL"),
            &BSTR::from("SELECT * FROM WmiMonitorBrightnessEvent"),
            WBEM_FLAG_RETURN_IMMEDIATELY | WBEM_FLAG_FORWARD_ONLY,
            None,
        )?
    };

    loop {
        let mut objects: [Option<IWbemClassObject>; 1] = [None];
        let mut returned = 0u32;
        // Blocks until Windows reports a change.
        unsafe {
            events
                .Next(WBEM_INFINITE, &mut objects, &mut returned)
                .ok()?
        };
        let Some(object) = objects[0].take() else {
            continue;
        };
        if let Some(level) = brightness_of(&object) {
            send(
                app,
                HudEvent {
                    kind: "brightness",
                    level: level.min(100),
                    muted: false,
                },
            );
        }
    }
}

/// The `Brightness` property (a byte, 0-100) of a brightness event.
fn brightness_of(object: &IWbemClassObject) -> Option<u8> {
    let mut value = VARIANT::default();
    unsafe {
        object
            .Get(w!("Brightness"), 0, &mut value, None, None)
            .ok()?;
        let inner = &value.Anonymous.Anonymous;
        let level = (inner.vt == VT_UI1).then_some(inner.Anonymous.bVal);
        let _ = VariantClear(&mut value);
        level
    }
}
