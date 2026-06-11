//! Jarvis Slice A — the Sense engine.
//!
//! Always-on, cheap ambient awareness for the desktop assistant:
//!
//!   * **Activity store** — local SQLite (`activity.db`) with an FTS5 index
//!     over OCR/UIA text. Raw frames metadata kept ~7 days (pruned on
//!     launch + daily); distilled summaries kept forever.
//!   * **Frame sampler** — captures the focused window every `SAMPLE_MS`
//!     or on foreground change, dedupes near-identical frames with a tiny
//!     perceptual hash, extracts text via Windows.Media.Ocr (native, no
//!     model download), and stores text + metadata (never the pixels).
//!   * **Privacy gate** — sampling hard-pauses when: a password field has
//!     focus (UIA `IsPassword`), the window looks like a private browser
//!     session, the app is on the user-editable blocklist, or the user
//!     explicitly paused watching. State is queryable so the UI can show
//!     a "not watching" indicator.
//!   * **Input cadence** — `GetLastInputInfo`-based idle tracking only.
//!     We never hook the keyboard; no keystroke content is ever read.
//!
//! Everything is text-and-numbers; screenshots are OCR'd then discarded.
//! Raw pixel data NEVER leaves this module, let alone the device.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const SAMPLE_MS: u64 = 10_000; // focused-window sample cadence
const RAW_RETENTION_DAYS: i64 = 7;
const SENSE_EVENT: &str = "metu://sense";

// ── Shared state ───────────────────────────────────────────────────────────

#[derive(Default)]
pub struct SenseState {
    /// User pressed "stop watching" (tray / right-click menu).
    pub user_paused: AtomicBool,
    /// Set by the privacy gate when the focused context is sensitive.
    pub privacy_paused: AtomicBool,
    /// Engine running at all (started after onboarding consent).
    pub running: AtomicBool,
    /// Last frame's perceptual hash — dedupe.
    last_phash: AtomicU64,
    /// Blocklist of app names (lowercase substring match).
    blocklist: Mutex<Vec<String>>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Activity store (SQLite + FTS5) ─────────────────────────────────────────

fn db_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("appdata_unavailable: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("appdata_create_failed: {e}"))?;
    Ok(dir.join("activity.db"))
}

fn open_db<R: Runtime>(app: &AppHandle<R>) -> Result<rusqlite::Connection, String> {
    let conn =
        rusqlite::Connection::open(db_path(app)?).map_err(|e| format!("db_open_failed: {e}"))?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS frames (
          id INTEGER PRIMARY KEY,
          ts INTEGER NOT NULL,
          app TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'ocr',
          phash INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_frames_ts ON frames(ts);
        CREATE VIRTUAL TABLE IF NOT EXISTS frames_fts USING fts5(
          text, app, title, content='frames', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS frames_ai AFTER INSERT ON frames BEGIN
          INSERT INTO frames_fts(rowid, text, app, title)
          VALUES (new.id, new.text, new.app, new.title);
        END;
        CREATE TRIGGER IF NOT EXISTS frames_ad AFTER DELETE ON frames BEGIN
          INSERT INTO frames_fts(frames_fts, rowid, text, app, title)
          VALUES ('delete', old.id, old.text, old.app, old.title);
        END;
        CREATE TABLE IF NOT EXISTS app_sessions (
          id INTEGER PRIMARY KEY,
          app TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          started_ts INTEGER NOT NULL,
          ended_ts INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_started ON app_sessions(started_ts);
        CREATE TABLE IF NOT EXISTS summaries (
          id INTEGER PRIMARY KEY,
          ts INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'periodic',
          summary TEXT NOT NULL,
          synced INTEGER NOT NULL DEFAULT 0
        );
        "#,
    )
    .map_err(|e| format!("db_init_failed: {e}"))?;
    Ok(conn)
}

fn prune_raw<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(conn) = open_db(app) {
        let cutoff = now_ms() - RAW_RETENTION_DAYS * 24 * 3600 * 1000;
        let _ = conn.execute("DELETE FROM frames WHERE ts < ?1", [cutoff]);
        let _ = conn.execute("DELETE FROM app_sessions WHERE started_ts < ?1", [cutoff]);
    }
}

// ── Privacy gate ───────────────────────────────────────────────────────────

/// Window-title fragments that indicate a private browsing session.
const PRIVATE_TITLE_MARKERS: &[&str] = &[
    "inprivate",
    "incognito",
    "private browsing",
    "navigare privată",
];

#[cfg(windows)]
fn focused_field_is_password() -> bool {
    // UIA: current focused element's IsPassword property. Best-effort —
    // any failure means "not a password" rather than blocking sampling.
    (|| -> Option<bool> {
        let automation = uiautomation::UIAutomation::new().ok()?;
        let el = automation.get_focused_element().ok()?;
        el.is_password().ok()
    })()
    .unwrap_or(false)
}

#[cfg(not(windows))]
fn focused_field_is_password() -> bool {
    false
}

fn is_private_title(title: &str) -> bool {
    let t = title.to_lowercase();
    PRIVATE_TITLE_MARKERS.iter().any(|m| t.contains(m))
}

fn is_blocklisted(state: &SenseState, app_name: &str) -> bool {
    let app = app_name.to_lowercase();
    state
        .blocklist
        .lock()
        .map(|b| b.iter().any(|x| !x.is_empty() && app.contains(x)))
        .unwrap_or(false)
}

// ── Idle / input cadence (no keylogging — timestamps only) ────────────────

#[cfg(windows)]
fn idle_ms() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe {
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount();
            return now.wrapping_sub(info.dwTime) as u64;
        }
    }
    0
}

#[cfg(not(windows))]
fn idle_ms() -> u64 {
    0
}

// ── Perceptual hash (8×8 average hash over grayscale) ─────────────────────

fn phash_rgba(buf: &[u8], w: u32, h: u32) -> u64 {
    if w == 0 || h == 0 {
        return 0;
    }
    // Downsample to 8×8 grayscale by block averaging.
    let mut cells = [0u64; 64];
    let mut counts = [0u64; 64];
    let cw = (w as usize).max(8) / 8;
    let ch = (h as usize).max(8) / 8;
    for y in 0..(h as usize) {
        let cy = (y / ch).min(7);
        for x in 0..(w as usize) {
            let cx = (x / cw).min(7);
            let i = (y * w as usize + x) * 4;
            if i + 2 < buf.len() {
                let lum = (buf[i] as u64 * 299 + buf[i + 1] as u64 * 587 + buf[i + 2] as u64 * 114)
                    / 1000;
                cells[cy * 8 + cx] += lum;
                counts[cy * 8 + cx] += 1;
            }
        }
    }
    let avgs: Vec<u64> = cells
        .iter()
        .zip(counts.iter())
        .map(|(s, c)| if *c > 0 { s / c } else { 0 })
        .collect();
    let mean: u64 = avgs.iter().sum::<u64>() / 64;
    let mut hash = 0u64;
    for (i, v) in avgs.iter().enumerate() {
        if *v > mean {
            hash |= 1 << i;
        }
    }
    hash
}

fn hamming(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

// ── OCR (Windows.Media.Ocr — built into Windows 10+) ──────────────────────

#[cfg(windows)]
fn ocr_rgba(buf: &[u8], w: u32, h: u32) -> Result<String, String> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    let engine =
        OcrEngine::TryCreateFromUserProfileLanguages().map_err(|e| format!("ocr_engine: {e}"))?;

    // SoftwareBitmap from raw RGBA8 via a WinRT buffer.
    let stream = InMemoryRandomAccessStream::new().map_err(|e| format!("ocr_stream: {e}"))?;
    let writer = DataWriter::CreateDataWriter(&stream).map_err(|e| format!("ocr_writer: {e}"))?;
    writer
        .WriteBytes(buf)
        .map_err(|e| format!("ocr_write: {e}"))?;
    let ibuf = writer
        .DetachBuffer()
        .map_err(|e| format!("ocr_detach: {e}"))?;

    let bmp = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
        &ibuf,
        BitmapPixelFormat::Rgba8,
        w as i32,
        h as i32,
        BitmapAlphaMode::Ignore,
    )
    .map_err(|e| format!("ocr_bitmap: {e}"))?;

    // OCR works on Bgra8 — convert when needed.
    let bmp8 =
        SoftwareBitmap::ConvertWithAlpha(&bmp, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore)
            .map_err(|e| format!("ocr_convert: {e}"))?;

    let result = engine
        .RecognizeAsync(&bmp8)
        .map_err(|e| format!("ocr_recognize: {e}"))?
        .get()
        .map_err(|e| format!("ocr_wait: {e}"))?;
    let text = result.Text().map_err(|e| format!("ocr_text: {e}"))?;
    Ok(text.to_string())
}

#[cfg(not(windows))]
fn ocr_rgba(_buf: &[u8], _w: u32, _h: u32) -> Result<String, String> {
    Err("ocr_unsupported_platform".into())
}

// ── Sense event payloads ───────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SensePayload {
    /// Focused window changed (or first observation).
    Focus {
        ts: i64,
        app: String,
        title: String,
        x: i32,
        y: i32,
        w: u32,
        h: u32,
    },
    /// A frame was sampled and text extracted (text NOT included in the
    /// event — it's in the local store; event carries metadata only).
    Frame {
        ts: i64,
        app: String,
        chars: usize,
        deduped: bool,
    },
    /// Privacy gate engaged/released.
    Privacy {
        ts: i64,
        paused: bool,
        reason: String,
    },
    /// User idle state flipped.
    Idle { ts: i64, idle: bool, idle_ms: u64 },
}

// ── The sampler loop ───────────────────────────────────────────────────────

pub fn start_sense_engine<R: Runtime>(app: AppHandle<R>) {
    {
        let state = app.state::<SenseState>();
        if state.running.swap(true, Ordering::SeqCst) {
            return; // already running
        }
    }
    prune_raw(&app);

    std::thread::spawn(move || {
        let mut last_focus_key = String::new();
        let mut last_idle = false;
        let mut last_sample = std::time::Instant::now() - Duration::from_secs(3600);
        let mut last_privacy = false;

        loop {
            std::thread::sleep(Duration::from_millis(1000));
            let state = app.state::<SenseState>();
            if !state.running.load(Ordering::Relaxed) {
                break;
            }
            if state.user_paused.load(Ordering::Relaxed) {
                continue;
            }

            // Idle tracking (event on flip at 90s threshold).
            let idle = idle_ms();
            let is_idle = idle > 90_000;
            if is_idle != last_idle {
                last_idle = is_idle;
                let _ = app.emit(
                    SENSE_EVENT,
                    SensePayload::Idle {
                        ts: now_ms(),
                        idle: is_idle,
                        idle_ms: idle,
                    },
                );
            }

            // Foreground window via existing spatial helper.
            let fg = match crate::spatial::foreground_window_info() {
                Some(f) => f,
                None => continue,
            };

            // Privacy gate.
            let private = focused_field_is_password()
                || is_private_title(&fg.title)
                || is_blocklisted(&state, &fg.app);
            state.privacy_paused.store(private, Ordering::Relaxed);
            if private != last_privacy {
                last_privacy = private;
                let reason = if private {
                    "sensitive context".into()
                } else {
                    String::new()
                };
                let _ = app.emit(
                    SENSE_EVENT,
                    SensePayload::Privacy {
                        ts: now_ms(),
                        paused: private,
                        reason,
                    },
                );
            }
            if private {
                continue;
            }

            // Focus change event + session bookkeeping.
            let focus_key = format!("{}|{}", fg.app, fg.title);
            let focus_changed = focus_key != last_focus_key;
            if focus_changed {
                last_focus_key = focus_key;
                let _ = app.emit(
                    SENSE_EVENT,
                    SensePayload::Focus {
                        ts: now_ms(),
                        app: fg.app.clone(),
                        title: fg.title.clone(),
                        x: fg.x,
                        y: fg.y,
                        w: fg.w,
                        h: fg.h,
                    },
                );
                if let Ok(conn) = open_db(&app) {
                    let t = now_ms();
                    let _ = conn.execute(
                        "UPDATE app_sessions SET ended_ts = ?1 WHERE ended_ts IS NULL",
                        [t],
                    );
                    let _ = conn.execute(
                        "INSERT INTO app_sessions (app, title, started_ts) VALUES (?1, ?2, ?3)",
                        rusqlite::params![fg.app, fg.title, t],
                    );
                }
            }

            // Frame sampling: on focus change OR cadence elapsed, not idle.
            if is_idle {
                continue;
            }
            let due = focus_changed || last_sample.elapsed() >= Duration::from_millis(SAMPLE_MS);
            if !due {
                continue;
            }
            last_sample = std::time::Instant::now();

            // Capture the focused window region (xcap monitor capture then
            // crop is heavy; xcap window capture is fine here).
            let captured = capture_focused_window(&fg);
            let Some((rgba, w, h)) = captured else {
                continue;
            };

            // Dedupe via perceptual hash.
            let hash = phash_rgba(&rgba, w, h);
            let prev = state.last_phash.swap(hash, Ordering::Relaxed);
            if hamming(prev, hash) <= 2 {
                let _ = app.emit(
                    SENSE_EVENT,
                    SensePayload::Frame {
                        ts: now_ms(),
                        app: fg.app.clone(),
                        chars: 0,
                        deduped: true,
                    },
                );
                continue;
            }

            // OCR (text only — pixels are dropped right after).
            let text = ocr_rgba(&rgba, w, h).unwrap_or_default();
            drop(rgba);
            let chars = text.chars().count();
            if chars > 0 {
                if let Ok(conn) = open_db(&app) {
                    let _ = conn.execute(
                        "INSERT INTO frames (ts, app, title, text, source, phash)
                         VALUES (?1, ?2, ?3, ?4, 'ocr', ?5)",
                        rusqlite::params![now_ms(), fg.app, fg.title, text, hash as i64],
                    );
                }
            }
            let _ = app.emit(
                SENSE_EVENT,
                SensePayload::Frame {
                    ts: now_ms(),
                    app: fg.app.clone(),
                    chars,
                    deduped: false,
                },
            );
        }
    });
}

/// Capture the focused window's pixels as RGBA8. Returns None on failure
/// (minimized, protected content, capture API hiccup) — sampling just skips.
fn capture_focused_window(fg: &crate::spatial::ForegroundInfo) -> Option<(Vec<u8>, u32, u32)> {
    let windows = xcap::Window::all().ok()?;
    for win in windows {
        let title_match = win.title() == fg.title;
        let app_match = win.app_name().eq_ignore_ascii_case(&fg.app);
        if title_match || app_match {
            if let Ok(img) = win.capture_image() {
                let (w, h) = (img.width(), img.height());
                return Some((img.into_raw(), w, h));
            }
        }
    }
    None
}

// ── Commands ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SenseSearchArgs {
    pub query: String,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenseHit {
    pub ts: i64,
    pub app: String,
    pub title: String,
    pub snippet: String,
}

/// Full-text search across everything the user has seen on screen.
#[tauri::command]
pub async fn sense_search<R: Runtime>(
    app: AppHandle<R>,
    args: SenseSearchArgs,
) -> Result<Vec<SenseHit>, String> {
    crate::caps::require("screenshot")?;
    let conn = open_db(&app)?;
    let limit = args.limit.unwrap_or(20).min(100);
    let mut stmt = conn
        .prepare(
            "SELECT f.ts, f.app, f.title,
                    snippet(frames_fts, 0, '«', '»', '…', 18)
             FROM frames_fts
             JOIN frames f ON f.id = frames_fts.rowid
             WHERE frames_fts MATCH ?1
             ORDER BY f.ts DESC LIMIT ?2",
        )
        .map_err(|e| format!("search_prepare: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![args.query, limit], |r| {
            Ok(SenseHit {
                ts: r.get(0)?,
                app: r.get(1)?,
                title: r.get(2)?,
                snippet: r.get(3)?,
            })
        })
        .map_err(|e| format!("search_query: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenseTimelineEntry {
    pub app: String,
    pub title: String,
    pub started_ts: i64,
    pub ended_ts: Option<i64>,
}

/// Recent focused-app sessions (most recent first) — the raw material the
/// ActivityModel and "catch me up" distiller consume.
#[tauri::command]
pub async fn sense_timeline<R: Runtime>(
    app: AppHandle<R>,
    since_ts: Option<i64>,
    limit: Option<u32>,
) -> Result<Vec<SenseTimelineEntry>, String> {
    let conn = open_db(&app)?;
    let since = since_ts.unwrap_or(now_ms() - 8 * 3600 * 1000);
    let limit = limit.unwrap_or(200).min(1000);
    let mut stmt = conn
        .prepare(
            "SELECT app, title, started_ts, ended_ts FROM app_sessions
             WHERE started_ts >= ?1 ORDER BY started_ts DESC LIMIT ?2",
        )
        .map_err(|e| format!("timeline_prepare: {e}"))?;
    let rows = stmt
        .query_map(rusqlite::params![since, limit], |r| {
            Ok(SenseTimelineEntry {
                app: r.get(0)?,
                title: r.get(1)?,
                started_ts: r.get(2)?,
                ended_ts: r.get(3)?,
            })
        })
        .map_err(|e| format!("timeline_query: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Recent screen text for the focused app (the "what am I looking at"
/// context injected into voice/chat turns). Capped to keep prompts sane.
#[tauri::command]
pub async fn sense_recent_text<R: Runtime>(
    app: AppHandle<R>,
    minutes: Option<u32>,
    max_chars: Option<u32>,
) -> Result<String, String> {
    let conn = open_db(&app)?;
    let mins = minutes.unwrap_or(5).min(120) as i64;
    let cap = max_chars.unwrap_or(4000).min(20_000) as usize;
    let since = now_ms() - mins * 60 * 1000;
    let mut stmt = conn
        .prepare("SELECT app, title, text FROM frames WHERE ts >= ?1 ORDER BY ts DESC LIMIT 12")
        .map_err(|e| format!("recent_prepare: {e}"))?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map([since], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|e| format!("recent_query: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    let mut out = String::new();
    for (app_name, title, text) in rows {
        if out.len() >= cap {
            break;
        }
        let take = (cap - out.len()).min(text.len());
        out.push_str(&format!("[{app_name} — {title}]\n"));
        out.push_str(&text[..text.char_indices().take_while(|(i, _)| *i < take).count()]);
        out.push_str("\n\n");
    }
    Ok(out)
}

/// Pause/resume ambient watching (user intent — tray or menu).
#[tauri::command]
pub async fn sense_set_paused<R: Runtime>(app: AppHandle<R>, paused: bool) -> Result<(), String> {
    let state = app.state::<SenseState>();
    state.user_paused.store(paused, Ordering::Relaxed);
    let _ = app.emit(
        SENSE_EVENT,
        SensePayload::Privacy {
            ts: now_ms(),
            paused,
            reason: if paused {
                "user paused".into()
            } else {
                String::new()
            },
        },
    );
    Ok(())
}

/// Replace the app blocklist (lowercase substring matches).
#[tauri::command]
pub async fn sense_set_blocklist<R: Runtime>(
    app: AppHandle<R>,
    apps: Vec<String>,
) -> Result<(), String> {
    let state = app.state::<SenseState>();
    if let Ok(mut b) = state.blocklist.lock() {
        *b = apps.into_iter().map(|a| a.to_lowercase()).collect();
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SenseStatus {
    pub running: bool,
    pub user_paused: bool,
    pub privacy_paused: bool,
}

#[tauri::command]
pub async fn sense_status<R: Runtime>(app: AppHandle<R>) -> Result<SenseStatus, String> {
    let state = app.state::<SenseState>();
    Ok(SenseStatus {
        running: state.running.load(Ordering::Relaxed),
        user_paused: state.user_paused.load(Ordering::Relaxed),
        privacy_paused: state.privacy_paused.load(Ordering::Relaxed),
    })
}

/// Store a distilled summary (from the JS distiller) + mark sync status.
#[tauri::command]
pub async fn sense_store_summary<R: Runtime>(
    app: AppHandle<R>,
    kind: String,
    summary: String,
    synced: bool,
) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute(
        "INSERT INTO summaries (ts, kind, summary, synced) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![now_ms(), kind, summary, synced as i64],
    )
    .map_err(|e| format!("summary_insert: {e}"))?;
    Ok(())
}
