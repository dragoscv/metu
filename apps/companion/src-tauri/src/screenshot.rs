//! Screenshot capture — cross-platform via `xcap`.
//!
//! Strategy:
//!   * `screen` target → capture the primary monitor (or `monitor` index).
//!   * `window` target → look up by our internal window id (the index in the
//!     enumeration returned by `windowing::list_windows`).
//!
//! The captured image is downscaled so the longest edge ≤ 1600px to keep
//! WebSocket envelopes small, then encoded as PNG and returned as base64.
//! The Conductor decides whether to upload to GCS for retention.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use image::{imageops::FilterType, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use xcap::{Monitor, Window};

const MAX_EDGE: u32 = 1600;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotArgs {
    /// "screen" (default) or "window".
    #[serde(default = "default_target")]
    pub target: String,
    /// Required when `target == "window"`.
    pub window_id: Option<String>,
    /// Monitor index for `target == "screen"`. Defaults to primary.
    pub monitor: Option<usize>,
}

fn default_target() -> String {
    "screen".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub format: String,
    pub width: u32,
    pub height: u32,
    /// PNG bytes, base64-encoded.
    pub data_base64: String,
    /// What was actually captured, for the Conductor's bookkeeping.
    pub source: String,
}

pub fn capture(args: ScreenshotArgs) -> Result<ScreenshotResult, String> {
    let img = match args.target.as_str() {
        "window" => {
            let id = args
                .window_id
                .ok_or_else(|| "window_id_required".to_string())?;
            capture_window(&id)?
        }
        _ => capture_monitor(args.monitor)?,
    };

    let (w, h) = img.dimensions();
    let resized = if w.max(h) > MAX_EDGE {
        let scale = MAX_EDGE as f32 / w.max(h) as f32;
        let nw = (w as f32 * scale) as u32;
        let nh = (h as f32 * scale) as u32;
        image::DynamicImage::ImageRgba8(img)
            .resize(nw, nh, FilterType::Triangle)
            .to_rgba8()
    } else {
        img
    };
    let (out_w, out_h) = resized.dimensions();

    let mut buf: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(resized)
        .write_to(&mut std::io::Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| format!("encode_failed: {e}"))?;

    Ok(ScreenshotResult {
        format: "png".into(),
        width: out_w,
        height: out_h,
        data_base64: B64.encode(&buf),
        source: args.target,
    })
}

fn capture_monitor(idx: Option<usize>) -> Result<RgbaImage, String> {
    let monitors = Monitor::all().map_err(|e| format!("monitor_enum_failed: {e}"))?;
    if monitors.is_empty() {
        return Err("no_monitors".into());
    }
    let target = match idx {
        Some(i) if i < monitors.len() => &monitors[i],
        _ => monitors
            .iter()
            .find(|m| m.is_primary())
            .unwrap_or(&monitors[0]),
    };
    target
        .capture_image()
        .map_err(|e| format!("capture_failed: {e}"))
}

fn capture_window(window_id: &str) -> Result<RgbaImage, String> {
    let windows = Window::all().map_err(|e| format!("window_enum_failed: {e}"))?;
    // The id we hand out is the stringified index from `list_windows`.
    let idx: usize = window_id
        .parse()
        .map_err(|_| format!("invalid_window_id: {window_id}"))?;
    let win = windows
        .get(idx)
        .ok_or_else(|| format!("window_not_found: {window_id}"))?;
    win.capture_image()
        .map_err(|e| format!("capture_failed: {e}"))
}
