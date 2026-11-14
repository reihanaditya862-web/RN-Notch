//! Master volume of the default playback device, through Windows Core Audio
//! (`IAudioEndpointVolume`).

use std::ptr;
use std::sync::OnceLock;

use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{IMMDeviceEnumerator, MMDeviceEnumerator, eMultimedia, eRender};
use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance, CoIncrementMTAUsage};

/// Master volume snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VolumeState {
    /// 0-100.
    pub percent: u8,
    pub muted: bool,
}

/// Makes COM usable from any thread of the process.
///
/// Commands run on the async runtime's worker threads, which never initialize
/// COM themselves. Holding one MTA usage reference for the lifetime of the app
/// puts every such thread in the multithreaded apartment implicitly.
fn ensure_com() {
    static MTA: OnceLock<()> = OnceLock::new();
    MTA.get_or_init(|| {
        // The cookie is deliberately never released.
        let _ = unsafe { CoIncrementMTAUsage() };
    });
}

/// Volume control of the current default output device.
///
/// Looked up on every call, so the commands follow the user when they plug in
/// headphones or switch speakers.
fn endpoint_volume() -> windows::core::Result<IAudioEndpointVolume> {
    ensure_com();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

/// Converts the 0.0-1.0 scalar Windows reports to a whole percentage.
fn scalar_to_percent(scalar: f32) -> u8 {
    (scalar.clamp(0.0, 1.0) * 100.0).round() as u8
}

fn percent_to_scalar(percent: u8) -> f32 {
    f32::from(percent.min(100)) / 100.0
}

/// Reads the master volume. Fails when there is no output device.
pub fn read_volume() -> windows::core::Result<VolumeState> {
    let endpoint = endpoint_volume()?;
    unsafe {
        Ok(VolumeState {
            percent: scalar_to_percent(endpoint.GetMasterVolumeLevelScalar()?),
            muted: endpoint.GetMute()?.as_bool(),
        })
    }
}

fn describe(action: &str, error: windows::core::Error) -> String {
    format!("failed to {action}: {error}")
}

/// Returns the master volume as 0-100.
#[tauri::command(async)]
pub fn get_volume() -> Result<u8, String> {
    read_volume()
        .map(|state| state.percent)
        .map_err(|error| describe("read the volume", error))
}

/// Sets the master volume (0-100). Raising it from a muted state unmutes,
/// the same way the Windows volume slider behaves.
#[tauri::command(async)]
pub fn set_volume(level: u8) -> Result<(), String> {
    let level = level.min(100);
    let endpoint = endpoint_volume().map_err(|error| describe("open the audio device", error))?;

    unsafe {
        endpoint
            .SetMasterVolumeLevelScalar(percent_to_scalar(level), ptr::null())
            .map_err(|error| describe("set the volume", error))?;

        if level > 0 && endpoint.GetMute().map(|muted| muted.as_bool()).unwrap_or(false) {
            endpoint
                .SetMute(false, ptr::null())
                .map_err(|error| describe("unmute", error))?;
        }
    }
    Ok(())
}

/// Toggles mute and returns the new state (`true` = muted).
#[tauri::command(async)]
pub fn toggle_mute() -> Result<bool, String> {
    let endpoint = endpoint_volume().map_err(|error| describe("open the audio device", error))?;

    unsafe {
        let muted = endpoint
            .GetMute()
            .map_err(|error| describe("read the mute state", error))?
            .as_bool();
        endpoint
            .SetMute(!muted, ptr::null())
            .map_err(|error| describe("toggle mute", error))?;
        Ok(!muted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scalar_and_percent_round_trip() {
        assert_eq!(scalar_to_percent(0.0), 0);
        assert_eq!(scalar_to_percent(0.724), 72);
        assert_eq!(scalar_to_percent(0.995), 100);
        assert_eq!(scalar_to_percent(1.7), 100);
        assert_eq!(scalar_to_percent(-0.2), 0);

        for percent in 0..=100u8 {
            assert_eq!(scalar_to_percent(percent_to_scalar(percent)), percent);
        }
        assert_eq!(percent_to_scalar(250), 1.0);
    }
}
