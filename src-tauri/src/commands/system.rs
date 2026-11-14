//! Hardware monitor: battery (Win32 power status), CPU and RAM (`sysinfo`),
//! plus the master volume so the HUD needs a single call per refresh.

use std::sync::{Mutex, PoisonError};
use std::time::Instant;

use serde::Serialize;
use sysinfo::{MINIMUM_CPU_UPDATE_INTERVAL, System};
use tauri::State;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

use super::audio;

const BYTES_PER_GB: f64 = 1024.0 * 1024.0 * 1024.0;

/// `SYSTEM_POWER_STATUS` sentinel values.
const BATTERY_FLAG_CHARGING: u8 = 8;
const BATTERY_FLAG_NO_BATTERY: u8 = 128;
const POWER_VALUE_UNKNOWN: u8 = 255;
const AC_LINE_ONLINE: u8 = 1;

/// Snapshot of the machine, serialized to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct SystemInfo {
    /// 0-100, or `None` on a machine without a battery (or when unknown).
    pub battery_percent: Option<u8>,
    pub is_charging: bool,
    pub is_ac_connected: bool,
    /// 0.0-100.0, averaged over all cores since the previous refresh.
    pub cpu_usage_percent: f32,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    /// 0-100, or `None` when there is no audio output device.
    pub volume_percent: Option<u8>,
    pub is_muted: bool,
}

/// Keeps one `System` alive between calls: CPU usage is a delta between two
/// refreshes, so the sampler has to remember the previous one.
struct Sampler {
    system: System,
    last_cpu_refresh: Instant,
    cpu_usage: f32,
}

pub struct SystemState {
    sampler: Mutex<Sampler>,
}

impl Default for SystemState {
    fn default() -> Self {
        // Take the baseline CPU reading now, so the first real request
        // already has something to compare against.
        let mut system = System::new();
        system.refresh_cpu_usage();
        system.refresh_memory();

        Self {
            sampler: Mutex::new(Sampler {
                system,
                last_cpu_refresh: Instant::now(),
                cpu_usage: 0.0,
            }),
        }
    }
}

struct BatteryStatus {
    percent: Option<u8>,
    is_charging: bool,
    is_ac_connected: bool,
}

/// Interprets the raw Win32 power status.
fn interpret_power_status(status: &SYSTEM_POWER_STATUS) -> BatteryStatus {
    let flag = status.BatteryFlag;
    let has_battery = flag != POWER_VALUE_UNKNOWN && flag & BATTERY_FLAG_NO_BATTERY == 0;

    let percent = if has_battery && status.BatteryLifePercent != POWER_VALUE_UNKNOWN {
        Some(status.BatteryLifePercent.min(100))
    } else {
        None
    };

    BatteryStatus {
        percent,
        is_charging: has_battery && flag & BATTERY_FLAG_CHARGING != 0,
        is_ac_connected: status.ACLineStatus == AC_LINE_ONLINE,
    }
}

fn read_battery() -> BatteryStatus {
    let mut status = SYSTEM_POWER_STATUS::default();
    match unsafe { GetSystemPowerStatus(&mut status) } {
        Ok(()) => interpret_power_status(&status),
        Err(_) => BatteryStatus {
            percent: None,
            is_charging: false,
            is_ac_connected: false,
        },
    }
}

fn bytes_to_gb(bytes: u64) -> f32 {
    (bytes as f64 / BYTES_PER_GB) as f32
}

/// Returns battery, CPU, RAM and master volume in one call.
///
/// A part that cannot be read degrades to `None` / zero instead of failing
/// the whole request, so one broken sensor never blanks the other widgets.
#[tauri::command(async)]
pub fn get_system_info(state: State<'_, SystemState>) -> Result<SystemInfo, String> {
    let (cpu_usage_percent, ram_used_gb, ram_total_gb) = {
        let mut sampler = state
            .sampler
            .lock()
            .unwrap_or_else(PoisonError::into_inner);

        // Refreshing more often than sysinfo's minimum interval gives a
        // meaningless reading; reuse the previous one in that case.
        if sampler.last_cpu_refresh.elapsed() >= MINIMUM_CPU_UPDATE_INTERVAL {
            sampler.system.refresh_cpu_usage();
            sampler.last_cpu_refresh = Instant::now();
            sampler.cpu_usage = sampler.system.global_cpu_usage().clamp(0.0, 100.0);
        }
        sampler.system.refresh_memory();

        (
            sampler.cpu_usage,
            bytes_to_gb(sampler.system.used_memory()),
            bytes_to_gb(sampler.system.total_memory()),
        )
    };

    let battery = read_battery();
    let volume = audio::read_volume().ok();

    Ok(SystemInfo {
        battery_percent: battery.percent,
        is_charging: battery.is_charging,
        is_ac_connected: battery.is_ac_connected,
        cpu_usage_percent,
        ram_used_gb,
        ram_total_gb,
        volume_percent: volume.map(|v| v.percent),
        is_muted: volume.map(|v| v.muted).unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(ac: u8, flag: u8, percent: u8) -> SYSTEM_POWER_STATUS {
        SYSTEM_POWER_STATUS {
            ACLineStatus: ac,
            BatteryFlag: flag,
            BatteryLifePercent: percent,
            ..Default::default()
        }
    }

    #[test]
    fn laptop_on_battery() {
        let battery = interpret_power_status(&status(0, 1, 85));
        assert_eq!(battery.percent, Some(85));
        assert!(!battery.is_charging);
        assert!(!battery.is_ac_connected);
    }

    #[test]
    fn laptop_charging() {
        let battery = interpret_power_status(&status(1, 8, 42));
        assert_eq!(battery.percent, Some(42));
        assert!(battery.is_charging);
        assert!(battery.is_ac_connected);
    }

    #[test]
    fn laptop_plugged_in_and_full() {
        let battery = interpret_power_status(&status(1, 1, 100));
        assert_eq!(battery.percent, Some(100));
        assert!(!battery.is_charging);
        assert!(battery.is_ac_connected);
    }

    #[test]
    fn desktop_without_battery() {
        let battery = interpret_power_status(&status(1, 128, 255));
        assert_eq!(battery.percent, None);
        assert!(!battery.is_charging);
        assert!(battery.is_ac_connected);
    }

    #[test]
    fn unknown_status_reports_nothing() {
        let battery = interpret_power_status(&status(255, 255, 255));
        assert_eq!(battery.percent, None);
        assert!(!battery.is_charging);
        assert!(!battery.is_ac_connected);
    }

    #[test]
    fn bytes_convert_to_gigabytes() {
        assert_eq!(bytes_to_gb(0), 0.0);
        assert_eq!(bytes_to_gb(8 * 1024 * 1024 * 1024), 8.0);
    }
}
