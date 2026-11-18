//! Small HTTPS client for the few web services the capsule reads: the F1
//! schedule and results (Jolpica), driver photos and team logos (Wikipedia),
//! synced song lyrics (LRCLIB), and site icons
//! for AI apps that are not installed.
//!
//! Uses Windows' own HTTP stack (`Windows.Web.Http`), so no extra library is
//! shipped. Only HTTPS and only the hosts below are allowed: the frontend can
//! not turn this into a general-purpose fetcher.

use std::thread;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use windows::Foundation::Uri;
use windows::Storage::Streams::DataReader;
use windows::Web::Http::HttpClient;
use windows::core::HSTRING;

use super::background::ensure_com;

const USER_AGENT: &str = "RN-Notch/1.1 (Windows desktop widget)";

/// Hosts that may be fetched, with the path every URL must start with.
const ALLOWED: [(&str, &str); 7] = [
    ("api.jolpi.ca", "/ergast/f1/"),
    ("en.wikipedia.org", "/api/rest_v1/page/summary/"),
    ("upload.wikimedia.org", "/"),
    ("thumb.wikimedia.org", "/"),
    ("www.google.com", "/s2/favicons"),
    ("t0.gstatic.com", "/faviconV2"),
    ("lrclib.net", "/api/"),
];

const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BYTES: usize = 3 * 1024 * 1024;

fn check_url(url: &str) -> Result<Uri, String> {
    let uri = Uri::CreateUri(&HSTRING::from(url)).map_err(|_| "not a valid URL".to_string())?;
    let scheme = uri.SchemeName().map(|s| s.to_string()).unwrap_or_default();
    let host = uri.Host().map(|s| s.to_string().to_lowercase()).unwrap_or_default();
    let path = uri.Path().map(|s| s.to_string()).unwrap_or_default();
    if scheme != "https" {
        return Err("only https is allowed".into());
    }
    if !is_allowed(&host, &path) {
        return Err(format!("{host} is not on the allowed list"));
    }
    Ok(uri)
}

fn is_allowed(host: &str, path: &str) -> bool {
    !path.contains("..")
        && ALLOWED
            .iter()
            .any(|(allowed_host, prefix)| host == *allowed_host && path.starts_with(prefix))
}

/// Fetches a URL; returns the body and its content type.
fn get(url: &str) -> Result<(Vec<u8>, String), String> {
    ensure_com();
    let uri = check_url(url)?;
    let client = HttpClient::new().map_err(|error| error.to_string())?;
    if let Ok(headers) = client.DefaultRequestHeaders()
        && let Ok(agent) = headers.UserAgent()
    {
        let _ = agent.TryParseAdd(&HSTRING::from(USER_AGENT));
    }

    let operation = client.GetAsync(&uri).map_err(|error| error.to_string())?;
    // A stalled connection must not hold the command forever. Cancelling an
    // operation that already finished does nothing.
    let watchdog = operation.clone();
    thread::spawn(move || {
        thread::sleep(TIMEOUT);
        let _ = watchdog.Cancel();
    });
    let response = operation
        .join()
        .map_err(|error| format!("request failed: {error}"))?;
    if !response.IsSuccessStatusCode().unwrap_or(false) {
        let status = response.StatusCode().map(|code| code.0).unwrap_or(0);
        return Err(format!("the server answered {status}"));
    }

    let content = response.Content().map_err(|error| error.to_string())?;
    let content_type = content
        .Headers()
        .and_then(|headers| headers.ContentType())
        .and_then(|value| value.MediaType())
        .map(|value| value.to_string())
        .unwrap_or_default();
    let buffer = content
        .ReadAsBufferAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| format!("could not read the answer: {error}"))?;
    let length = buffer.Length().map_err(|error| error.to_string())? as usize;
    if length > MAX_BYTES {
        return Err("the answer is too large".into());
    }
    let reader = DataReader::FromBuffer(&buffer).map_err(|error| error.to_string())?;
    let mut bytes = vec![0u8; length];
    reader.ReadBytes(&mut bytes).map_err(|error| error.to_string())?;
    Ok((bytes, content_type))
}

/// Fetches text (JSON) from an allowed URL.
#[tauri::command(async)]
pub fn http_get_text(url: String) -> Result<String, String> {
    let (bytes, _) = get(&url)?;
    String::from_utf8(bytes).map_err(|_| "the answer is not text".to_string())
}

/// Fetches an image from an allowed URL as a `data:` URL.
pub fn image_data_url(url: &str) -> Result<String, String> {
    let (bytes, content_type) = get(url)?;
    if !content_type.starts_with("image/") {
        return Err("the answer is not an image".into());
    }
    Ok(format!("data:{content_type};base64,{}", BASE64.encode(bytes)))
}

#[tauri::command(async)]
pub fn http_get_image(url: String) -> Result<String, String> {
    image_data_url(&url)
}

#[cfg(test)]
mod tests {
    use super::is_allowed;

    #[test]
    fn only_listed_hosts_and_paths_pass() {
        assert!(is_allowed("api.jolpi.ca", "/ergast/f1/current.json"));
        assert!(is_allowed("en.wikipedia.org", "/api/rest_v1/page/summary/Max_Verstappen"));
        assert!(is_allowed("upload.wikimedia.org", "/wikipedia/commons/a/b.jpg"));
        assert!(is_allowed("thumb.wikimedia.org", "/wikipedia/commons/thumb/a/b.jpg/330px-b.jpg"));
        assert!(is_allowed("www.google.com", "/s2/favicons"));

        assert!(!is_allowed("api.jolpi.ca", "/admin"));
        assert!(!is_allowed("example.com", "/ergast/f1/"));
        assert!(!is_allowed("en.wikipedia.org", "/wiki/Special:Login"));
        assert!(!is_allowed("api.jolpi.ca", "/ergast/f1/../../secret"));
        assert!(!is_allowed("api.jolpi.ca.evil.com", "/ergast/f1/"));
    }
}
