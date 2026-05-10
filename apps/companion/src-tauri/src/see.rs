//! Vision composition — companion-agent slice 5.
//!
//! Bundles the three observation primitives (screenshot, window list,
//! a11y tree of focused window) into a single round-trip the Conductor
//! can drop into its planning context. One hub envelope instead of three
//! sequential ones cuts perceived latency from ~600 ms to ~200 ms on the
//! median desktop.
//!
//! OCR is intentionally NOT bundled here. Modern vision LLMs (Claude
//! Sonnet 4.5+, GPT-4o, Gemini 2.0+) read on-screen text directly from the
//! PNG with higher accuracy than tesseract, and bundling tesseract would
//! add ~30 MB to the companion binary. If a future use case actually
//! needs offline OCR, `OcrPayload` is shaped for it (`engine: "tesseract"`)
//! and the field can be filled in by a runtime sidecar — same dormant-
//! deps pattern as whisper.cpp / piper.
//!
//! Cross-platform: screenshot + window list work everywhere; the a11y
//! subtree is Windows-only today (mirrors `a11y::read`'s contract).

use serde::{Deserialize, Serialize};

use crate::{a11y, screenshot, windowing};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SeeArgs {
    /// "screen" (default) or "window".
    #[serde(default = "default_target")]
    pub target: String,
    /// Window id (from `device.list_windows`); when set, the screenshot
    /// AND the a11y tree both narrow to that window.
    pub window_id: Option<String>,
    /// Monitor index when target = "screen". Defaults to primary.
    pub monitor: Option<usize>,
    /// Cap depth/nodes on the a11y tree. Defaults match `a11y::read`.
    pub max_depth: Option<u32>,
    pub max_nodes: Option<u32>,
    /// Skip the a11y tree (saves ~50–200 ms on slow Chromium windows).
    #[serde(default)]
    pub skip_a11y: bool,
    /// Skip the window list (when the caller already has it).
    #[serde(default)]
    pub skip_windows: bool,
}

fn default_target() -> String {
    "screen".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPayload {
    /// "tesseract" | "none". `none` = LLM should read the screenshot directly.
    pub engine: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeeResult {
    pub screenshot: screenshot::ScreenshotResult,
    pub windows: Option<Vec<windowing::WindowInfo>>,
    pub a11y: Option<a11y::A11yTree>,
    pub ocr: OcrPayload,
    /// ISO-8601 UTC timestamp when capture finished — gives the planner a
    /// ground truth for "when was this seen?".
    pub captured_at: String,
}

pub fn see(args: SeeArgs) -> Result<SeeResult, String> {
    let SeeArgs {
        target,
        window_id,
        monitor,
        max_depth,
        max_nodes,
        skip_a11y,
        skip_windows,
    } = args;

    // 1. Screenshot — the only mandatory leg.
    let screenshot = screenshot::capture(screenshot::ScreenshotArgs {
        target: target.clone(),
        window_id: window_id.clone(),
        monitor,
    })?;

    // 2. Window list (cheap; ~5 ms).
    let windows = if skip_windows {
        None
    } else {
        match windowing::list_windows() {
            Ok(list) => Some(list),
            Err(_) => None, // Best-effort; don't fail the whole `see`.
        }
    };

    // 3. A11y subtree.
    let a11y = if skip_a11y {
        None
    } else {
        match a11y::read(a11y::A11yArgs {
            window_id,
            max_depth,
            max_nodes,
        }) {
            Ok(tree) => Some(tree),
            Err(_) => None,
        }
    };

    Ok(SeeResult {
        screenshot,
        windows,
        a11y,
        ocr: OcrPayload {
            engine: "none".to_string(),
            text: String::new(),
        },
        captured_at: now_iso8601(),
    })
}

fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Minimal RFC3339 — precise enough for log correlation; we don't pull
    // chrono in just for this.
    let (y, mo, d, h, mi, s) = unix_to_ymdhms(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn unix_to_ymdhms(t: u64) -> (u32, u32, u32, u32, u32, u32) {
    let secs = t % 86_400;
    let days = (t / 86_400) as i64;
    let h = (secs / 3600) as u32;
    let mi = ((secs / 60) % 60) as u32;
    let s = (secs % 60) as u32;
    // Civil-from-days (Howard Hinnant). Returns (y, mo, d) for the Gregorian date.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as u32, m as u32, d as u32, h, mi, s)
}
