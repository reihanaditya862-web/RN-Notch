//! App icons as small PNG `data:` URLs, taken from the Windows shell.
//!
//! The shell knows the icon of anything it can name: an executable path, or
//! `shell:AppsFolder\<AppUserModelId>` for an installed app (Store apps and
//! classic programs alike). That covers the senders of notifications, the AI
//! apps in the drawer and the programs in the volume mixer.

use std::sync::{Mutex, OnceLock, PoisonError};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
    DeleteObject, GetDIBits, GetObjectW, HBITMAP, HGDIOBJ,
};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_ICONONLY,
};
use windows::core::HSTRING;

use super::background::ensure_com;

/// Icons kept in memory, least recently used dropped first.
const CACHE_LIMIT: usize = 20;
/// No icon is drawn larger than this anywhere in the capsule.
const MAX_SIZE: u32 = 32;

/// Name -> icon (or a remembered miss), oldest use first.
type IconCache = Vec<(String, Option<String>)>;

fn cache() -> &'static Mutex<IconCache> {
    static CACHE: OnceLock<Mutex<IconCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Vec::with_capacity(CACHE_LIMIT)))
}

/// Icon of the shell item `parsing_name` at up to 32 x 32 px, as a PNG
/// `data:` URL. `None` when the shell has no icon for it. Results (also
/// misses) are kept in a small LRU cache.
pub fn shell_icon(parsing_name: &str, size: u32) -> Option<String> {
    let size = size.min(MAX_SIZE);
    let key = format!("{size}|{parsing_name}");
    {
        let mut cache = cache().lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(index) = cache.iter().position(|(name, _)| *name == key) {
            let entry = cache.remove(index);
            let icon = entry.1.clone();
            cache.push(entry);
            return icon;
        }
    }

    let icon = load_icon(parsing_name, size);
    let mut cache = cache().lock().unwrap_or_else(PoisonError::into_inner);
    if cache.len() >= CACHE_LIMIT {
        cache.remove(0);
    }
    cache.push((key, icon.clone()));
    icon
}

fn load_icon(parsing_name: &str, size: u32) -> Option<String> {
    ensure_com();
    let side = i32::try_from(size).ok()?;
    let bitmap = unsafe {
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&HSTRING::from(parsing_name), None).ok()?;
        factory
            .GetImage(SIZE { cx: side, cy: side }, SIIGBF_ICONONLY)
            .ok()?
    };
    let pixels = read_bitmap(bitmap);
    unsafe {
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
    }
    let (width, height, rgba) = pixels?;
    let png = encode_png(width, height, &rgba);
    Some(format!("data:image/png;base64,{}", BASE64.encode(png)))
}

/// Copies a 32-bit bitmap into straight (not premultiplied) RGBA, top row first.
fn read_bitmap(bitmap: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    unsafe {
        let mut info = BITMAP::default();
        let written = GetObjectW(
            HGDIOBJ(bitmap.0),
            size_of::<BITMAP>() as i32,
            Some((&raw mut info).cast()),
        );
        if written == 0 || info.bmWidth <= 0 || info.bmHeight == 0 {
            return None;
        }
        let width = info.bmWidth;
        let height = info.bmHeight.abs();

        let mut header = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                // Negative: rows from the top down.
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bgra = vec![0u8; (width * height * 4) as usize];
        let dc = CreateCompatibleDC(None);
        let lines = GetDIBits(
            dc,
            bitmap,
            0,
            height as u32,
            Some(bgra.as_mut_ptr().cast()),
            &mut header,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(dc);
        if lines == 0 {
            return None;
        }
        Some((width as u32, height as u32, bgra_to_rgba(bgra)))
    }
}

/// Swaps blue and red, and repairs the alpha channel.
///
/// Shell bitmaps come either without alpha (every alpha byte 0: the image is
/// opaque) or premultiplied (no colour channel exceeds its alpha), which PNG
/// does not support, so the colours are divided back out.
fn bgra_to_rgba(mut pixels: Vec<u8>) -> Vec<u8> {
    let has_alpha = pixels.as_chunks::<4>().0.iter().any(|p| p[3] != 0);
    let premultiplied = has_alpha
        && pixels
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]);

    for pixel in pixels.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        if !has_alpha {
            pixel[3] = 255;
        } else if premultiplied && pixel[3] > 0 && pixel[3] < 255 {
            let alpha = u32::from(pixel[3]);
            for channel in &mut pixel[..3] {
                *channel = ((u32::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
            }
        }
    }
    pixels
}

/// Minimal PNG writer: 8-bit RGBA, one IDAT with uncompressed ("stored")
/// deflate blocks. App icons are at most 64x64, so the missing compression
/// costs a few kilobytes and saves a dependency.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let row = width as usize * 4;
    let mut raw = Vec::with_capacity((row + 1) * height as usize);
    for line in rgba.chunks_exact(row).take(height as usize) {
        raw.push(0); // filter: none
        raw.extend_from_slice(line);
    }

    let mut header = Vec::with_capacity(13);
    header.extend_from_slice(&width.to_be_bytes());
    header.extend_from_slice(&height.to_be_bytes());
    header.extend_from_slice(&[8, 6, 0, 0, 0]); // 8 bit, RGBA, deflate, no filter set, no interlace

    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    write_chunk(&mut png, b"IHDR", &header);
    write_chunk(&mut png, b"IDAT", &zlib_stored(&raw));
    write_chunk(&mut png, b"IEND", &[]);
    png
}

fn write_chunk(png: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    png.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let start = png.len();
    png.extend_from_slice(kind);
    png.extend_from_slice(data);
    let crc = crc32(&png[start..]);
    png.extend_from_slice(&crc.to_be_bytes());
}

fn zlib_stored(data: &[u8]) -> Vec<u8> {
    const BLOCK: usize = 65_535;
    let mut out = vec![0x78, 0x01];
    let mut blocks = data.chunks(BLOCK).peekable();
    if blocks.peek().is_none() {
        out.extend_from_slice(&[1, 0, 0, 0xFF, 0xFF]);
    }
    while let Some(block) = blocks.next() {
        out.push(u8::from(blocks.peek().is_none()));
        let length = block.len() as u16;
        out.extend_from_slice(&length.to_le_bytes());
        out.extend_from_slice(&(!length).to_le_bytes());
        out.extend_from_slice(block);
    }
    out.extend_from_slice(&adler32(data).to_be_bytes());
    out
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for chunk in bytes.chunks(5552) {
        for &byte in chunk {
            a += u32::from(byte);
            b += a;
        }
        a %= 65_521;
        b %= 65_521;
    }
    (b << 16) | a
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksums_match_known_values() {
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
        assert_eq!(crc32(b""), 0);
        assert_eq!(adler32(b"Wikipedia"), 0x11E6_0398);
        assert_eq!(adler32(b""), 1);
    }

    #[test]
    fn png_has_the_right_structure() {
        let png = encode_png(2, 1, &[255, 0, 0, 255, 0, 0, 255, 128]);
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 2);
        assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), 1);
        assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");
        // One row: filter byte + 2 pixels, in one final stored block.
        let idat = &png[33 + 8..];
        assert_eq!(&idat[..2], &[0x78, 0x01]);
        assert_eq!(idat[2], 1);
        assert_eq!(u16::from_le_bytes([idat[3], idat[4]]), 9);
    }

    #[test]
    fn stored_blocks_split_large_data() {
        let data = vec![7u8; 70_000];
        let zlib = zlib_stored(&data);
        // Header, two block headers, the data, the checksum.
        assert_eq!(zlib.len(), 2 + 5 * 2 + 70_000 + 4);
        assert_eq!(zlib[2], 0, "first block is not the last");
        assert_eq!(zlib[2 + 5 + 65_535], 1, "second block is the last");
    }

    #[test]
    fn opaque_and_premultiplied_bitmaps_become_straight_rgba() {
        // No alpha at all: opaque.
        assert_eq!(bgra_to_rgba(vec![10, 20, 30, 0]), vec![30, 20, 10, 255]);
        // Premultiplied half-transparent white becomes white at half alpha.
        assert_eq!(bgra_to_rgba(vec![128, 128, 128, 128, 0, 0, 0, 0]), vec![255, 255, 255, 128, 0, 0, 0, 0]);
        // Straight alpha (a channel above alpha) is left alone.
        assert_eq!(bgra_to_rgba(vec![200, 0, 0, 100]), vec![0, 0, 200, 100]);
    }
}
