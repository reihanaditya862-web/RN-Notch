//! Media engine: reads and controls whatever is playing on Windows through the
//! System Media Transport Controls (SMTC) - Spotify, browsers, VLC and so on.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Serialize;
use tauri::State;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionMediaProperties as MediaProperties,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;

/// Windows time values are counted in 100-nanosecond ticks.
const TICKS_PER_MS: i64 = 10_000;

/// Seconds between the Windows epoch (1601-01-01) and the Unix epoch (1970-01-01).
const WINDOWS_TO_UNIX_EPOCH_SECS: i64 = 11_644_473_600;

/// Thumbnails larger than this are ignored instead of being sent to the webview.
const MAX_ART_BYTES: u64 = 4 * 1024 * 1024;

/// Snapshot of the active media session, serialized to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// `data:` URL of the cover art. Only filled when the art differs from the
    /// `known_art_id` the frontend passed in, so the image crosses the IPC
    /// bridge once per track instead of on every poll.
    pub album_art_url: Option<String>,
    /// Identifies the current cover art; `None` when the track has none.
    pub album_art_id: Option<String>,
    pub is_playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    /// Friendly name of the app that owns the session, e.g. "Spotify".
    pub source: String,
}

/// State shared by the media commands.
#[derive(Default)]
pub struct MediaState {
    /// Cached SMTC manager; requesting it once is enough for the app's lifetime.
    manager: Mutex<Option<SessionManager>>,
    /// App id of the session shown last. Keeps the capsule on the same app
    /// after it is paused, instead of jumping to another paused session.
    last_source: Mutex<Option<String>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn session_manager(state: &MediaState) -> windows::core::Result<SessionManager> {
    let mut cached = lock(&state.manager);
    if let Some(manager) = cached.as_ref() {
        return Ok(manager.clone());
    }

    let manager = SessionManager::RequestAsync()?.join()?;
    *cached = Some(manager.clone());
    Ok(manager)
}

fn source_id(session: &Session) -> String {
    session
        .SourceAppUserModelId()
        .map(|id| id.to_string())
        .unwrap_or_default()
}

fn is_playing(session: &Session) -> bool {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == PlaybackStatus::Playing)
        .unwrap_or(false)
}

/// Picks the session the capsule should show.
///
/// Order of preference:
/// 1. a session that is playing (the one shown last wins a tie),
/// 2. the session shown last, even if it is paused now,
/// 3. the session Windows considers current,
/// 4. any session at all.
fn select_session(state: &MediaState) -> windows::core::Result<Option<Session>> {
    let manager = session_manager(state)?;
    let sessions: Vec<Session> = manager.GetSessions()?.into_iter().collect();
    if sessions.is_empty() {
        *lock(&state.last_source) = None;
        return Ok(None);
    }

    let remembered = lock(&state.last_source).clone();
    let is_remembered =
        |session: &&Session| remembered.as_deref() == Some(source_id(session).as_str());

    let playing: Vec<&Session> = sessions.iter().filter(|s| is_playing(s)).collect();

    let chosen = playing
        .iter()
        .copied()
        .find(is_remembered)
        .or_else(|| playing.first().copied())
        .or_else(|| sessions.iter().find(is_remembered))
        .cloned()
        .or_else(|| manager.GetCurrentSession().ok())
        .or_else(|| sessions.first().cloned());

    *lock(&state.last_source) = chosen.as_ref().map(source_id);
    Ok(chosen)
}

/// Current time in Windows ticks (100ns since 1601-01-01 UTC).
fn now_ticks() -> i64 {
    let since_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let unix_ticks = (since_unix.as_millis() as i64).saturating_mul(TICKS_PER_MS);
    unix_ticks.saturating_add(WINDOWS_TO_UNIX_EPOCH_SECS * 1000 * TICKS_PER_MS)
}

fn ticks_to_ms(ticks: i64) -> u64 {
    (ticks.max(0) / TICKS_PER_MS) as u64
}

/// Returns `(position_ms, duration_ms)`.
///
/// Apps report their position only now and then (Spotify: on play, pause and
/// seek), so while a session is playing the position is advanced by the time
/// that has passed since its last report.
fn timeline(session: &Session, playing: bool) -> (u64, u64) {
    let Ok(timeline) = session.GetTimelineProperties() else {
        return (0, 0);
    };

    let start = timeline.StartTime().map(|t| t.Duration).unwrap_or(0);
    let end = timeline.EndTime().map(|t| t.Duration).unwrap_or(0);
    let reported = timeline.Position().map(|t| t.Duration).unwrap_or(0);

    let duration = end.saturating_sub(start).max(0);
    let mut position = reported.saturating_sub(start).max(0);

    if playing {
        let updated = timeline
            .LastUpdatedTime()
            .map(|t| t.UniversalTime)
            .unwrap_or(0);
        if updated > 0 {
            let elapsed = now_ticks().saturating_sub(updated);
            if elapsed > 0 {
                position = position.saturating_add(elapsed);
            }
        }
    }

    if duration > 0 {
        position = position.min(duration);
    }

    (ticks_to_ms(position), ticks_to_ms(duration))
}

/// Guesses the image type from its first bytes; SMTC often leaves the content
/// type empty.
fn image_mime(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'B', b'M', ..] => "image/bmp",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "image/png",
    }
}

/// Reads the cover art of a session.
///
/// Returns `None` when there is no usable thumbnail, otherwise the art id plus
/// the `data:` URL. The URL is skipped (`None`) when the id equals
/// `known_art_id`, which avoids reading and encoding the image on every poll.
///
/// The id is derived from the track and the thumbnail's byte size. Including
/// the size matters: right after a track change some apps still expose the
/// previous cover for a moment, and the size changes once the real one lands.
fn album_art(
    properties: &MediaProperties,
    track_key: &str,
    known_art_id: Option<&str>,
) -> Option<(String, Option<String>)> {
    let stream = properties.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > MAX_ART_BYTES {
        return None;
    }

    let mut hasher = DefaultHasher::new();
    track_key.hash(&mut hasher);
    size.hash(&mut hasher);
    let id = format!("{:016x}", hasher.finish());

    if known_art_id == Some(id.as_str()) {
        return Some((id, None));
    }

    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    let loaded = reader.LoadAsync(size as u32).ok()?.join().ok()? as usize;
    if loaded == 0 {
        return None;
    }

    let mut bytes = vec![0u8; loaded];
    reader.ReadBytes(&mut bytes).ok()?;

    let url = format!(
        "data:{};base64,{}",
        image_mime(&bytes),
        BASE64.encode(&bytes)
    );
    Some((id, Some(url)))
}

/// Turns an app user model id into a short display name.
///
/// Examples of raw ids: `Spotify.exe`, `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify`,
/// `Chrome`, `MSEdge`, `308046B0AF4A39CB` (Firefox).
fn friendly_source(app_id: &str) -> String {
    const KNOWN: [(&str, &str); 12] = [
        ("spotify", "Spotify"),
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
        ("308046b0af4a39cb", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("vivaldi", "Vivaldi"),
        ("vlc", "VLC"),
        ("zunemusic", "Media Player"),
        ("zunevideo", "Movies & TV"),
        ("applemusic", "Apple Music"),
    ];

    let lower = app_id.to_lowercase();
    if let Some((_, name)) = KNOWN.iter().find(|(needle, _)| lower.contains(needle)) {
        return (*name).to_string();
    }

    // Unknown app: keep the most readable part of the id.
    //   "Vendor.App_hash!Entry" -> "Entry",  "foobar2000.exe" -> "foobar2000"
    let name = app_id.rsplit('!').next().unwrap_or(app_id);
    let name = name.rsplit(['\\', '/']).next().unwrap_or(name);
    let name = name
        .strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".EXE"))
        .unwrap_or(name);

    if name.is_empty() {
        "Unknown".to_string()
    } else {
        name.to_string()
    }
}

fn read_media_info(
    state: &MediaState,
    known_art_id: Option<&str>,
) -> windows::core::Result<Option<MediaInfo>> {
    let Some(session) = select_session(state)? else {
        return Ok(None);
    };

    let properties = session.TryGetMediaPropertiesAsync()?.join()?;
    let title = properties.Title().map(|s| s.to_string()).unwrap_or_default();
    let artist = properties.Artist().map(|s| s.to_string()).unwrap_or_default();
    let album = properties
        .AlbumTitle()
        .map(|s| s.to_string())
        .unwrap_or_default();

    // A session without any metadata (an app that just opened, a silent tab)
    // has nothing worth showing.
    if title.is_empty() && artist.is_empty() {
        return Ok(None);
    }

    let app_id = source_id(&session);
    let playing = is_playing(&session);
    let (position_ms, duration_ms) = timeline(&session, playing);

    let track_key = format!("{app_id}\u{1f}{title}\u{1f}{artist}\u{1f}{album}");
    let (album_art_id, album_art_url) = match album_art(&properties, &track_key, known_art_id) {
        Some((id, url)) => (Some(id), url),
        None => (None, None),
    };

    Ok(Some(MediaInfo {
        title,
        artist,
        album,
        album_art_url,
        album_art_id,
        is_playing: playing,
        position_ms,
        duration_ms,
        source: friendly_source(&app_id),
    }))
}

/// Returns the active media session, or `None` when nothing is available.
///
/// `known_art_id` is the `album_art_id` the frontend already holds; pass it so
/// unchanged cover art is not sent again.
#[tauri::command(async)]
pub fn get_media_info(
    state: State<'_, MediaState>,
    known_art_id: Option<String>,
) -> Result<Option<MediaInfo>, String> {
    read_media_info(&state, known_art_id.as_deref()).map_err(|error| {
        // Drop the cached manager so the next poll requests a fresh one.
        *lock(&state.manager) = None;
        format!("failed to read media session: {error}")
    })
}

/// Runs a transport control (play/pause, next, previous) on the active session.
fn control_session<F>(state: &MediaState, action: &str, run: F) -> Result<(), String>
where
    F: FnOnce(&Session) -> windows::core::Result<bool>,
{
    let session = select_session(state)
        .map_err(|error| format!("failed to read media session: {error}"))?
        .ok_or_else(|| "no active media session".to_string())?;

    match run(&session) {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!("the media app did not accept '{action}'")),
        Err(error) => Err(format!("'{action}' failed: {error}")),
    }
}

#[tauri::command(async)]
pub fn media_play_pause(state: State<'_, MediaState>) -> Result<(), String> {
    control_session(&state, "play/pause", |session| {
        session.TryTogglePlayPauseAsync()?.join()
    })
}

#[tauri::command(async)]
pub fn media_next(state: State<'_, MediaState>) -> Result<(), String> {
    control_session(&state, "next", |session| session.TrySkipNextAsync()?.join())
}

#[tauri::command(async)]
pub fn media_previous(state: State<'_, MediaState>) -> Result<(), String> {
    control_session(&state, "previous", |session| {
        session.TrySkipPreviousAsync()?.join()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn friendly_source_maps_known_apps() {
        assert_eq!(friendly_source("Spotify.exe"), "Spotify");
        assert_eq!(
            friendly_source("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"),
            "Spotify"
        );
        assert_eq!(friendly_source("Chrome"), "Chrome");
        assert_eq!(friendly_source("MSEdge"), "Edge");
        assert_eq!(friendly_source("308046B0AF4A39CB"), "Firefox");
    }

    #[test]
    fn friendly_source_cleans_unknown_ids() {
        assert_eq!(friendly_source("foobar2000.exe"), "foobar2000");
        assert_eq!(friendly_source("Vendor.Player_abc123!App"), "App");
        assert_eq!(friendly_source(""), "Unknown");
    }

    #[test]
    fn image_mime_sniffs_common_formats() {
        assert_eq!(image_mime(&[0x89, b'P', b'N', b'G', 0x0D]), "image/png");
        assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), "image/jpeg");
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), "image/webp");
        assert_eq!(image_mime(&[]), "image/png");
    }

    #[test]
    fn ticks_convert_to_milliseconds() {
        assert_eq!(ticks_to_ms(10_000), 1);
        assert_eq!(ticks_to_ms(2_520_000_000), 252_000);
        assert_eq!(ticks_to_ms(-5), 0);
    }
}
