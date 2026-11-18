//! Short pop-ups when the hardware around the laptop changes: Wi-Fi joins or
//! drops, a Bluetooth device connects, a display is plugged in or out, the
//! charger is connected or removed, the battery runs low or is full.
//!
//! The loop sleeps until Windows reports a change (see `events.rs`), then
//! takes a snapshot and compares it with the previous one. The first snapshot
//! is only a baseline, so starting the app announces nothing.

use std::collections::BTreeSet;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Devices::Bluetooth::{BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice};
use windows::Devices::Enumeration::DeviceInformation;
use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};

use super::background::{ensure_com, features, should_slow_down};

/// Emitted with a `HardwareAlert` for each change worth showing.
pub const HARDWARE_EVENT: &str = "hardware-alert";


const BATTERY_LOW: u8 = 20;
const BATTERY_CRITICAL: u8 = 10;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HardwareAlert {
    /// "wifi", "bluetooth", "display", "battery" or "charging".
    pub kind: &'static str,
    pub title: String,
    pub detail: String,
    /// "info", "success" or "warning".
    pub tone: &'static str,
    /// Battery level, for the battery pop-ups.
    pub percent: Option<u8>,
}

impl HardwareAlert {
    fn new(kind: &'static str, title: &str, detail: String, tone: &'static str) -> Self {
        Self {
            kind,
            title: title.to_string(),
            detail,
            tone,
            percent: None,
        }
    }

    fn with_percent(mut self, percent: u8) -> Self {
        self.percent = Some(percent);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Battery {
    percent: u8,
    on_ac: bool,
    saver: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Snapshot {
    /// Name of the Wi-Fi network in use, if any.
    wifi: Option<String>,
    /// Names of connected Bluetooth devices; `None` when not looked at this round.
    bluetooth: Option<BTreeSet<String>>,
    monitors: i32,
    battery: Option<Battery>,
}

/// Everything that changed between two snapshots, as pop-ups.
fn changes(before: &Snapshot, after: &Snapshot) -> Vec<HardwareAlert> {
    let mut alerts = Vec::new();

    match (&before.wifi, &after.wifi) {
        (old, Some(name)) if old.as_ref() != Some(name) => {
            alerts.push(HardwareAlert::new("wifi", "Wi-Fi connected", name.clone(), "success"));
        }
        (Some(name), None) => {
            alerts.push(HardwareAlert::new("wifi", "Wi-Fi disconnected", name.clone(), "warning"));
        }
        _ => {}
    }

    if let (Some(old), Some(new)) = (&before.bluetooth, &after.bluetooth) {
        for name in new.difference(old) {
            alerts.push(HardwareAlert::new(
                "bluetooth",
                "Bluetooth connected",
                name.clone(),
                "info",
            ));
        }
    }

    if after.monitors > before.monitors && before.monitors > 0 {
        alerts.push(HardwareAlert::new(
            "display",
            "Display connected",
            displays(after.monitors),
            "info",
        ));
    } else if after.monitors < before.monitors && after.monitors > 0 {
        alerts.push(HardwareAlert::new(
            "display",
            "Display disconnected",
            displays(after.monitors),
            "info",
        ));
    }

    if let (Some(old), Some(new)) = (before.battery, after.battery) {
        let percent = new.percent;
        if new.on_ac && !old.on_ac {
            alerts.push(
                HardwareAlert::new("charging", "Charging", format!("{percent}%"), "success")
                    .with_percent(percent),
            );
        } else if !new.on_ac && old.on_ac {
            alerts.push(
                HardwareAlert::new("battery", "On battery", format!("{percent}% left"), "info")
                    .with_percent(percent),
            );
        }

        if !new.on_ac {
            if percent <= BATTERY_CRITICAL && old.percent > BATTERY_CRITICAL {
                alerts.push(
                    HardwareAlert::new(
                        "battery",
                        "Battery critical",
                        format!("{percent}% - plug in now"),
                        "warning",
                    )
                    .with_percent(percent),
                );
            } else if percent <= BATTERY_LOW && old.percent > BATTERY_LOW {
                alerts.push(
                    HardwareAlert::new("battery", "Low battery", format!("{percent}% left"), "warning")
                        .with_percent(percent),
                );
            }
        }

        if new.on_ac && percent == 100 && old.percent < 100 {
            alerts.push(
                HardwareAlert::new("charging", "Fully charged", "100%".into(), "success")
                    .with_percent(percent),
            );
        }
        if new.saver && !old.saver {
            alerts.push(
                HardwareAlert::new(
                    "battery",
                    "Battery saver on",
                    format!("{percent}% left"),
                    "warning",
                )
                .with_percent(percent),
            );
        }
    }

    alerts
}

fn displays(count: i32) -> String {
    if count == 1 {
        "1 display".into()
    } else {
        format!("{count} displays")
    }
}

/// The Wi-Fi network the PC is on: the SSID when Windows shares it (it may
/// need location access for that), otherwise the network profile's name,
/// which is the SSID unless the user renamed it.
fn read_wifi() -> Option<String> {
    let profiles = NetworkInformation::GetConnectionProfiles().ok()?;
    profiles.into_iter().find_map(|profile| {
        if !profile.IsWlanConnectionProfile().unwrap_or(false) {
            return None;
        }
        let level = profile.GetNetworkConnectivityLevel().ok()?;
        if level == NetworkConnectivityLevel::None {
            return None;
        }
        let ssid = profile
            .WlanConnectionProfileDetails()
            .and_then(|details| details.GetConnectedSsid())
            .map(|ssid| ssid.to_string())
            .unwrap_or_default();
        let name = if ssid.is_empty() {
            profile.ProfileName().map(|n| n.to_string()).unwrap_or_default()
        } else {
            ssid
        };
        (!name.is_empty()).then_some(name)
    })
}

fn read_bluetooth() -> Option<BTreeSet<String>> {
    let mut names = BTreeSet::new();
    for selector in [
        BluetoothDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected),
        BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(
            BluetoothConnectionStatus::Connected,
        ),
    ] {
        let devices = DeviceInformation::FindAllAsyncAqsFilter(&selector.ok()?)
            .and_then(|operation| operation.join())
            .ok()?;
        for device in devices {
            if let Ok(name) = device.Name() {
                let name = name.to_string();
                if !name.trim().is_empty() {
                    names.insert(name);
                }
            }
        }
    }
    Some(names)
}

fn read_battery() -> Option<Battery> {
    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
    // 128 = no system battery, 255 = unknown.
    if status.BatteryFlag & 128 != 0 || status.BatteryFlag == 255 || status.BatteryLifePercent > 100
    {
        return None;
    }
    Some(Battery {
        percent: status.BatteryLifePercent,
        on_ac: status.ACLineStatus == 1,
        saver: status.SystemStatusFlag == 1,
    })
}

/// Starts the loop that watches the hardware.
/// Without any event the state is still looked at this often: a battery that
/// drains slowly does not always raise one.
const SAFETY_INTERVAL: Duration = Duration::from_secs(60);
/// One change often comes as several events; they are given time to settle.
const SETTLE: Duration = Duration::from_millis(400);

/// Starts the loop that watches the hardware. It sleeps until `wake` says
/// something changed (see `events.rs`).
pub fn spawn_watcher(app: AppHandle, wake: Receiver<()>) -> std::io::Result<()> {
    thread::Builder::new()
        .name("notch-hardware".into())
        .spawn(move || watch(&app, &wake))
        .map(|_| ())
}

/// Waits for the next event (or the safety interval), then lets a burst of
/// events settle into one round.
fn wait(wake: &Receiver<()>) {
    match wake.recv_timeout(SAFETY_INTERVAL) {
        Ok(()) => {
            thread::sleep(SETTLE);
            while wake.try_recv().is_ok() {}
        }
        Err(RecvTimeoutError::Timeout) => {}
        Err(RecvTimeoutError::Disconnected) => thread::sleep(SAFETY_INTERVAL),
    }
}

fn watch(app: &AppHandle, wake: &Receiver<()>) {
    ensure_com();
    let mut previous: Option<Snapshot> = None;

    loop {
        // The first round after start (or after switching the module on)
        // takes the baseline at once.
        if previous.is_some() || !features(app).hardware_alerts {
            wait(wake);
        }
        if !features(app).hardware_alerts {
            previous = None;
            continue;
        }

        let snapshot = Snapshot {
            wifi: read_wifi(),
            // A failed lookup keeps the last known list rather than "none".
            bluetooth: read_bluetooth()
                .or_else(|| previous.as_ref().and_then(|before| before.bluetooth.clone())),
            monitors: unsafe { GetSystemMetrics(SM_CMONITORS) },
            battery: read_battery(),
        };

        if let Some(before) = &previous
            && !should_slow_down(app)
        {
            for alert in changes(before, &snapshot) {
                let _ = app.emit(HARDWARE_EVENT, alert);
            }
        }
        previous = Some(snapshot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn battery(percent: u8, on_ac: bool) -> Option<Battery> {
        Some(Battery {
            percent,
            on_ac,
            saver: false,
        })
    }

    fn titles(before: &Snapshot, after: &Snapshot) -> Vec<String> {
        changes(before, after).into_iter().map(|alert| alert.title).collect()
    }

    #[test]
    fn nothing_changed_means_no_pop_up() {
        let snapshot = Snapshot {
            wifi: Some("Home".into()),
            bluetooth: Some(BTreeSet::from(["Buds".to_string()])),
            monitors: 1,
            battery: battery(80, true),
        };
        assert!(changes(&snapshot, &snapshot).is_empty());
    }

    #[test]
    fn wifi_joins_switches_and_drops() {
        let off = Snapshot::default();
        let home = Snapshot { wifi: Some("Home".into()), ..Default::default() };
        let cafe = Snapshot { wifi: Some("Cafe".into()), ..Default::default() };
        assert_eq!(titles(&off, &home), ["Wi-Fi connected"]);
        assert_eq!(changes(&home, &cafe)[0].detail, "Cafe");
        assert_eq!(titles(&home, &off), ["Wi-Fi disconnected"]);
    }

    #[test]
    fn only_newly_connected_bluetooth_devices_are_announced() {
        let before = Snapshot {
            bluetooth: Some(BTreeSet::from(["Mouse".to_string()])),
            ..Default::default()
        };
        let after = Snapshot {
            bluetooth: Some(BTreeSet::from(["Mouse".to_string(), "Buds".to_string()])),
            ..Default::default()
        };
        let alerts = changes(&before, &after);
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].detail, "Buds");
        // A device going away, or a round without a lookup, is silent.
        assert!(changes(&after, &before).is_empty());
        assert!(changes(&before, &Snapshot { bluetooth: None, ..Default::default() }).is_empty());
    }

    #[test]
    fn displays_coming_and_going() {
        let one = Snapshot { monitors: 1, ..Default::default() };
        let two = Snapshot { monitors: 2, ..Default::default() };
        assert_eq!(titles(&one, &two), ["Display connected"]);
        assert_eq!(changes(&one, &two)[0].detail, "2 displays");
        assert_eq!(titles(&two, &one), ["Display disconnected"]);
    }

    #[test]
    fn charger_and_battery_levels() {
        let on = |percent| Snapshot { battery: battery(percent, true), ..Default::default() };
        let off = |percent| Snapshot { battery: battery(percent, false), ..Default::default() };

        assert_eq!(titles(&off(50), &on(50)), ["Charging"]);
        assert_eq!(titles(&on(50), &off(50)), ["On battery"]);
        assert_eq!(titles(&off(21), &off(20)), ["Low battery"]);
        assert_eq!(titles(&off(11), &off(10)), ["Battery critical"]);
        assert!(titles(&off(20), &off(19)).is_empty(), "announced once per crossing");
        assert_eq!(titles(&on(99), &on(100)), ["Fully charged"]);
        assert_eq!(changes(&on(99), &on(100))[0].percent, Some(100));

        let saver = Snapshot {
            battery: Some(Battery { percent: 18, on_ac: false, saver: true }),
            ..Default::default()
        };
        assert_eq!(titles(&off(18), &saver), ["Battery saver on"]);
    }
}
