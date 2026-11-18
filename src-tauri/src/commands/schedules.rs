//! Recurring daily schedule, kept at `%APPDATA%\rn-notch\schedules.json`.
//!
//! Each entry has a time and the weekdays it repeats on (0 = Sunday ... 6 =
//! Saturday), so "weekdays", "weekend" and "every Tuesday" are all just day
//! lists. Ticking an entry off records today's date; tomorrow it is open again.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

pub const SCHEDULES_FILE: &str = "schedules.json";

const MAX_ITEMS: usize = 100;
const TITLE_MAX_CHARS: usize = 80;
const ID_MAX_CHARS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScheduleItem {
    pub id: String,
    pub title: String,
    /// "HH:MM", 24-hour.
    pub time: String,
    /// Weekdays it repeats on, 0 = Sunday ... 6 = Saturday, sorted.
    pub days: Vec<u8>,
    /// The last day it was ticked off, "YYYY-MM-DD".
    #[serde(default)]
    pub done_on: Option<String>,
}

fn is_time(text: &str) -> bool {
    let bytes = text.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return false;
    }
    let number = |range: std::ops::Range<usize>| text.get(range)?.parse::<u8>().ok();
    let digits = text[..2].chars().chain(text[3..].chars()).all(|c| c.is_ascii_digit());
    digits && matches!((number(0..2), number(3..5)), (Some(h), Some(m)) if h < 24 && m < 60)
}

fn is_date(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    matches!(parts.as_slice(), [year, month, day]
        if year.len() == 4 && month.len() == 2 && day.len() == 2
        && parts.iter().all(|part| part.chars().all(|c| c.is_ascii_digit()))
        && (1..=12).contains(&month.parse::<u8>().unwrap_or(0))
        && (1..=31).contains(&day.parse::<u8>().unwrap_or(0)))
}

fn is_id(text: &str) -> bool {
    !text.is_empty()
        && text.chars().count() <= ID_MAX_CHARS
        && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

impl ScheduleItem {
    /// The entry with every field made valid, or `None` when it cannot be.
    fn sanitized(mut self) -> Option<Self> {
        self.title = self.title.split_whitespace().collect::<Vec<_>>().join(" ");
        if self.title.chars().count() > TITLE_MAX_CHARS {
            self.title = self.title.chars().take(TITLE_MAX_CHARS).collect();
        }
        self.days.retain(|day| *day <= 6);
        self.days.sort_unstable();
        self.days.dedup();
        if self.done_on.as_deref().is_some_and(|date| !is_date(date)) {
            self.done_on = None;
        }
        (is_id(&self.id) && !self.title.is_empty() && is_time(&self.time) && !self.days.is_empty())
            .then_some(self)
    }
}

/// Keeps the valid entries (unique ids, at most `MAX_ITEMS`), sorted by time.
fn sanitize(items: Vec<ScheduleItem>) -> Vec<ScheduleItem> {
    let mut seen = std::collections::HashSet::new();
    let mut items: Vec<ScheduleItem> = items
        .into_iter()
        .filter_map(ScheduleItem::sanitized)
        .filter(|item| seen.insert(item.id.clone()))
        .take(MAX_ITEMS)
        .collect();
    items.sort_by(|a, b| a.time.cmp(&b.time).then_with(|| a.title.cmp(&b.title)));
    items
}

/// Reads the file entry by entry; a broken entry is skipped, not fatal.
fn parse(text: &str) -> Vec<ScheduleItem> {
    let Ok(Value::Array(values)) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    sanitize(
        values
            .into_iter()
            .filter_map(|value| serde_json::from_value(value).ok())
            .collect(),
    )
}

fn write_file(path: &Path, items: &[ScheduleItem]) -> io::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let json = serde_json::to_string_pretty(items).map_err(io::Error::other)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, json)?;
    fs::rename(&temporary, path)
}

pub struct SchedulesState {
    path: PathBuf,
    items: Mutex<Vec<ScheduleItem>>,
}

impl SchedulesState {
    pub fn load(path: PathBuf) -> Self {
        let items = fs::read_to_string(&path)
            .map(|text| parse(&text))
            .unwrap_or_default();
        Self {
            path,
            items: Mutex::new(items),
        }
    }
}

#[tauri::command]
pub fn load_schedules(state: State<'_, SchedulesState>) -> Vec<ScheduleItem> {
    state.items.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

/// Replaces the schedule and writes the file. Returns what was stored.
#[tauri::command]
pub fn save_schedules(
    state: State<'_, SchedulesState>,
    items: Vec<ScheduleItem>,
) -> Result<Vec<ScheduleItem>, String> {
    let items = sanitize(items);
    *state.items.lock().unwrap_or_else(PoisonError::into_inner) = items.clone();
    write_file(&state.path, &items).map_err(|error| {
        format!("failed to save the schedule to {}: {error}", state.path.display())
    })?;
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, title: &str, time: &str, days: &[u8]) -> ScheduleItem {
        ScheduleItem {
            id: id.into(),
            title: title.into(),
            time: time.into(),
            days: days.to_vec(),
            done_on: None,
        }
    }

    #[test]
    fn times_and_dates_are_validated() {
        assert!(is_time("00:00") && is_time("23:59") && is_time("08:05"));
        assert!(!is_time("24:00") && !is_time("8:05") && !is_time("12:60") && !is_time("ab:cd"));
        assert!(is_date("2026-11-18"));
        assert!(!is_date("2026-13-01") && !is_date("18-11-2026") && !is_date("2026-1-1"));
    }

    #[test]
    fn invalid_entries_are_dropped_and_the_rest_sorted() {
        let items = sanitize(vec![
            item("b", "Lecture", "10:00", &[1, 2, 3, 4, 5]),
            item("a", "  Gym   session ", "07:30", &[6, 0, 6]),
            item("bad", "No days", "09:00", &[]),
            item("bad2", "", "09:00", &[1]),
            item("bad3", "Wrong time", "9:00", &[1]),
            item("b", "Duplicate id", "11:00", &[1]),
            item("../x", "Bad id", "11:00", &[1]),
        ]);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Gym session");
        assert_eq!(items[0].days, vec![0, 6]);
        assert_eq!(items[1].id, "b");
    }

    #[test]
    fn a_broken_file_keeps_the_good_entries() {
        let text = r#"[
            { "id": "x1", "title": "Standup", "time": "09:15", "days": [1,2,3,4,5], "done_on": "2026-11-18" },
            { "id": "x2", "title": 5 },
            { "id": "x3", "title": "Call", "time": "18:00", "days": [9, 2], "done_on": "yesterday" }
        ]"#;
        let items = parse(text);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].done_on.as_deref(), Some("2026-11-18"));
        assert_eq!(items[1].days, vec![2]);
        assert_eq!(items[1].done_on, None);
        assert!(parse("not json").is_empty());
    }

    #[test]
    fn long_titles_are_cut() {
        let long = "x".repeat(200);
        let items = sanitize(vec![item("a", &long, "12:00", &[1])]);
        assert_eq!(items[0].title.chars().count(), TITLE_MAX_CHARS);
    }
}
