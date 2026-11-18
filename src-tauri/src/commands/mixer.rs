//! Audio utilities on the tools page: which output device plays (speakers,
//! headphones, a Bluetooth headset), a global microphone mute, and a volume
//! slider for every app that is playing sound right now.
//!
//! All of it is Windows Core Audio. Changing the default device uses
//! `IPolicyConfig`, the interface the Windows Sound settings use themselves;
//! it is not in the public SDK, so it is declared here by hand.

use std::collections::BTreeMap;
use std::ptr;

use serde::Serialize;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, DEVICE_STATE_ACTIVE, IAudioSessionControl2,
    IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    eCapture, eCommunications, eConsole, eMultimedia, eRender,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance, CoTaskMemFree, STGM_READ};
use windows::core::{HRESULT, Interface, PCWSTR, PWSTR};

use super::background::ensure_com;
use super::{icons, screen_tools};

const ICON_SIZE: u32 = 32;

/// `IPolicyConfig` (Windows 7 and later), named the way the vtable's owner
/// names it. Only `SetDefaultEndpoint` is called; the other methods are
/// declared so the vtable lines up.
#[allow(non_snake_case, dead_code)]
mod policy {
    use std::ffi::c_void;

    use windows::Win32::Media::Audio::ERole;
    use windows::core::{GUID, HRESULT, IUnknown, IUnknown_Vtbl, PCWSTR, interface};

    #[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
    pub unsafe trait IPolicyConfig: IUnknown {
        fn GetMixFormat(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
        fn GetDeviceFormat(&self, device: PCWSTR, default: i32, format: *mut *mut c_void)
        -> HRESULT;
        fn ResetDeviceFormat(&self, device: PCWSTR) -> HRESULT;
        fn SetDeviceFormat(&self, device: PCWSTR, endpoint: *mut c_void, mix: *mut c_void)
        -> HRESULT;
        fn GetProcessingPeriod(
            &self,
            device: PCWSTR,
            default: i32,
            default_period: *mut i64,
            minimum_period: *mut i64,
        ) -> HRESULT;
        fn SetProcessingPeriod(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
        fn GetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn SetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
        fn GetPropertyValue(
            &self,
            device: PCWSTR,
            store: i32,
            key: *const c_void,
            value: *mut c_void,
        ) -> HRESULT;
        fn SetPropertyValue(
            &self,
            device: PCWSTR,
            store: i32,
            key: *const c_void,
            value: *mut c_void,
        ) -> HRESULT;
        fn SetDefaultEndpoint(&self, device: PCWSTR, role: ERole) -> HRESULT;
        fn SetEndpointVisibility(&self, device: PCWSTR, visible: i32) -> HRESULT;
    }

    /// CLSID of `CPolicyConfigClient`.
    pub const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

    /// The macro keeps the methods private to this module.
    ///
    /// # Safety
    /// `device` must point to a nul-terminated endpoint id.
    pub unsafe fn set_default_endpoint(
        policy: &IPolicyConfig,
        device: PCWSTR,
        role: ERole,
    ) -> HRESULT {
        unsafe { policy.SetDefaultEndpoint(device, role) }
    }
}

use policy::{IPolicyConfig, POLICY_CONFIG_CLIENT, set_default_endpoint};

#[derive(Debug, Clone, Serialize)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioApp {
    pub pid: u32,
    pub name: String,
    /// 0-100.
    pub volume: u8,
    pub muted: bool,
    pub icon: Option<String>,
}

fn describe(action: &str, error: windows::core::Error) -> String {
    format!("failed to {action}: {error}")
}

fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
    ensure_com();
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

unsafe fn take_string(text: PWSTR) -> String {
    unsafe {
        let value = text.to_string().unwrap_or_default();
        CoTaskMemFree(Some(text.0 as *const _));
        value
    }
}

fn device_id(device: &IMMDevice) -> Option<String> {
    unsafe { device.GetId().ok().map(|id| take_string(id)) }
}

fn device_name(device: &IMMDevice) -> Option<String> {
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        let text = PropVariantToStringAlloc(&value).ok()?;
        Some(take_string(text))
    }
}

/// Active output devices, the default one marked.
#[tauri::command(async)]
pub fn audio_outputs() -> Result<Vec<OutputDevice>, String> {
    let enumerator = enumerator().map_err(|error| describe("open Core Audio", error))?;
    unsafe {
        let default = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .ok()
            .and_then(|device| device_id(&device));
        let devices = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|error| describe("list the output devices", error))?;
        let count = devices.GetCount().unwrap_or(0);
        let mut outputs = Vec::new();
        for index in 0..count {
            let Ok(device) = devices.Item(index) else { continue };
            let Some(id) = device_id(&device) else { continue };
            let name = device_name(&device).unwrap_or_else(|| "Audio device".into());
            outputs.push(OutputDevice {
                is_default: default.as_deref() == Some(id.as_str()),
                id,
                name,
            });
        }
        Ok(outputs)
    }
}

/// Makes `id` the default output for everything (apps, media, calls).
#[tauri::command(async)]
pub fn set_audio_output(id: String) -> Result<(), String> {
    let known = audio_outputs()?;
    if !known.iter().any(|device| device.id == id) {
        return Err("that device is not available".into());
    }
    ensure_com();
    let wide: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let policy: IPolicyConfig = CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
            .map_err(|error| describe("open the audio policy", error))?;
        for role in [eConsole, eMultimedia, eCommunications] {
            set_default_endpoint(&policy, PCWSTR(wide.as_ptr()), role)
                .ok()
                .map_err(|error| describe("switch the output device", error))?;
        }
    }
    Ok(())
}

fn microphone() -> windows::core::Result<IAudioEndpointVolume> {
    let enumerator = enumerator()?;
    unsafe {
        let device = enumerator.GetDefaultAudioEndpoint(eCapture, eConsole)?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

/// `Some(true)` when the default microphone is muted, `None` without one.
#[tauri::command(async)]
pub fn mic_muted() -> Option<bool> {
    let endpoint = microphone().ok()?;
    unsafe { endpoint.GetMute().ok().map(|muted| muted.as_bool()) }
}

/// Mutes or unmutes the default microphone; returns the new state.
#[tauri::command(async)]
pub fn toggle_mic() -> Result<bool, String> {
    let endpoint = microphone().map_err(|error| describe("open the microphone", error))?;
    unsafe {
        let muted = endpoint
            .GetMute()
            .map_err(|error| describe("read the microphone", error))?
            .as_bool();
        endpoint
            .SetMute(!muted, ptr::null())
            .map_err(|error| describe("mute the microphone", error))?;
        Ok(!muted)
    }
}

/// Every audio session on the default output with its process id.
fn sessions() -> windows::core::Result<Vec<(u32, IAudioSessionControl2)>> {
    let enumerator = enumerator()?;
    let mut found = Vec::new();
    unsafe {
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let manager = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)?;
        let list = manager.GetSessionEnumerator()?;
        for index in 0..list.GetCount()? {
            let Ok(control) = list.GetSession(index) else { continue };
            let Ok(control) = control.cast::<IAudioSessionControl2>() else { continue };
            // S_OK (0) means it is the "System sounds" session.
            if control.IsSystemSoundsSession() == HRESULT(0) {
                continue;
            }
            let Ok(pid) = control.GetProcessId() else { continue };
            if pid != 0 {
                found.push((pid, control));
            }
        }
    }
    Ok(found)
}

/// "chrome.exe" -> "Chrome", with a few names spelled the way people know them.
fn friendly_program_name(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let stem = file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file);
    match stem.to_lowercase().as_str() {
        "msedge" => "Edge".into(),
        "chrome" => "Chrome".into(),
        "firefox" => "Firefox".into(),
        "spotify" => "Spotify".into(),
        "discord" => "Discord".into(),
        "vlc" => "VLC".into(),
        "brave" => "Brave".into(),
        "opera" => "Opera".into(),
        "zoom" => "Zoom".into(),
        "ms-teams" | "teams" => "Teams".into(),
        _ => {
            let mut chars = stem.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect(),
                None => "App".into(),
            }
        }
    }
}

/// Apps playing sound right now, one entry per program.
#[tauri::command(async)]
pub fn audio_apps() -> Result<Vec<AudioApp>, String> {
    let sessions = sessions().map_err(|error| describe("read the audio sessions", error))?;
    let mut apps: BTreeMap<u32, AudioApp> = BTreeMap::new();
    for (pid, control) in sessions {
        let active = unsafe { control.GetState() }.is_ok_and(|state| state == AudioSessionStateActive);
        let Ok(volume) = control.cast::<ISimpleAudioVolume>() else { continue };
        let (level, muted) = unsafe {
            (
                volume.GetMasterVolume().unwrap_or(1.0),
                volume.GetMute().map(|m| m.as_bool()).unwrap_or(false),
            )
        };
        let percent = (level.clamp(0.0, 1.0) * 100.0).round() as u8;

        if let Some(app) = apps.get_mut(&pid) {
            app.volume = app.volume.max(percent);
            app.muted &= muted;
            continue;
        }
        if !active {
            continue;
        }
        let path = screen_tools::program_path(pid);
        apps.insert(
            pid,
            AudioApp {
                pid,
                name: path.as_deref().map_or_else(|| "App".into(), friendly_program_name),
                volume: percent,
                muted,
                icon: path.as_deref().and_then(|path| icons::shell_icon(path, ICON_SIZE)),
            },
        );
    }
    Ok(apps.into_values().collect())
}

fn for_each_volume(
    pid: u32,
    mut apply: impl FnMut(&ISimpleAudioVolume) -> windows::core::Result<()>,
) -> Result<(), String> {
    let sessions = sessions().map_err(|error| describe("read the audio sessions", error))?;
    let mut changed = false;
    for (session_pid, control) in sessions {
        if session_pid != pid {
            continue;
        }
        let volume = control
            .cast::<ISimpleAudioVolume>()
            .map_err(|error| describe("open the app's volume", error))?;
        apply(&volume).map_err(|error| describe("change the app's volume", error))?;
        changed = true;
    }
    if changed {
        Ok(())
    } else {
        Err("that app is no longer playing".into())
    }
}

/// Sets an app's volume (0-100) on every one of its sessions.
#[tauri::command(async)]
pub fn set_app_volume(pid: u32, volume: u8) -> Result<(), String> {
    let scalar = f32::from(volume.min(100)) / 100.0;
    for_each_volume(pid, |control| unsafe {
        control.SetMasterVolume(scalar, ptr::null())?;
        if volume > 0 {
            control.SetMute(false, ptr::null())?;
        }
        Ok(())
    })
}

#[tauri::command(async)]
pub fn set_app_muted(pid: u32, muted: bool) -> Result<(), String> {
    for_each_volume(pid, |control| unsafe { control.SetMute(muted, ptr::null()) })
}

#[cfg(test)]
mod tests {
    use super::friendly_program_name;

    #[test]
    fn program_names_read_naturally() {
        assert_eq!(friendly_program_name(r"C:\Program Files\Google\Chrome\chrome.exe"), "Chrome");
        assert_eq!(friendly_program_name(r"C:\x\msedge.exe"), "Edge");
        assert_eq!(friendly_program_name(r"C:\x\Spotify.exe"), "Spotify");
        assert_eq!(friendly_program_name(r"C:\x\foobar2000.exe"), "Foobar2000");
        assert_eq!(friendly_program_name("game"), "Game");
    }
}
