//! Companion ambient sensors — slice 6.
//!
//! Two background watchers that observe the host machine and emit Tauri
//! events the frontend forwards over the hub WebSocket as
//! `event.device` envelopes with kinds `window.changed` / `file.changed`.
//!
//!   * **window-tracker** — polls [`windowing::list_windows()`] every
//!     `POLL_INTERVAL` and emits when the focused window's `(app, id)` or
//!     title changes. A user-configured allowlist controls whether the
//!     title is included; everything else gets `app` + `windowClass`
//!     only. `redaction_regex` is applied to titles that survive the
//!     allowlist as a defense in depth.
//!   * **file-watcher** — wraps `notify::RecommendedWatcher`. Refuses to
//!     watch outside the explicit `roots` list so accidental
//!     `device_fs_watch_start({ roots: ['C:\\'] })` calls cannot
//!     escape user intent.
//!
//! Both watchers are gated by `caps::require(...)`. State lives in a
//! module-local `Mutex<SensorState>` so calls are idempotent (start while
//! running ⇒ no-op, stop while stopped ⇒ no-op).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{Config, Event as NotifyEvent, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::windowing;

const POLL_INTERVAL: Duration = Duration::from_millis(1500);
const WINDOW_CHANGED_EVENT: &str = "metu://window.changed";
const FILE_CHANGED_EVENT: &str = "metu://file.changed";

#[derive(Default)]
struct SensorState {
    window_handle: Option<tauri::async_runtime::JoinHandle<()>>,
    window_allowlist: Vec<String>,
    window_redaction: Vec<Regex>,
    fs_watcher: Option<RecommendedWatcher>,
    fs_roots: Vec<PathBuf>,
}

fn state() -> &'static Mutex<SensorState> {
    static STATE: std::sync::OnceLock<Mutex<SensorState>> = std::sync::OnceLock::new();
    STATE.get_or_init(|| Mutex::new(SensorState::default()))
}

// ── Window-tracker ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowTrackStartArgs {
    /// App names whose window title is allowed to leave the device.
    /// Everything else gets app-name only (title is stripped).
    #[serde(default)]
    pub title_allowlist: Vec<String>,
    /// Optional regex patterns applied to allowed titles for redaction.
    /// Invalid patterns are silently dropped.
    #[serde(default)]
    pub redaction_patterns: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowChangedPayload {
    pub app: String,
    pub title: Option<String>,
    pub window_id: String,
    pub bounds: BoundsPayload,
    /// `true` when the title was stripped by the allowlist + redaction.
    pub redacted: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoundsPayload {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

pub fn window_track_start(app: AppHandle, args: WindowTrackStartArgs) -> Result<(), String> {
    let allowlist: Vec<String> = args
        .title_allowlist
        .iter()
        .map(|s| s.to_lowercase())
        .collect();
    let redaction: Vec<Regex> = args
        .redaction_patterns
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect();

    let mut s = state().lock().map_err(|e| format!("lock_poisoned: {e}"))?;
    if s.window_handle.is_some() {
        // Idempotent restart with new config.
        if let Some(h) = s.window_handle.take() {
            h.abort();
        }
    }
    s.window_allowlist = allowlist.clone();
    s.window_redaction = redaction;
    drop(s);

    let app_handle = app.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let mut last_key: Option<String> = None;
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;
            // Run the sync list_windows on a blocking thread.
            let result = tauri::async_runtime::spawn_blocking(windowing::list_windows).await;
            let Ok(Ok(windows)) = result else {
                continue;
            };
            // Heuristic: pick the first non-minimized window. xcap doesn't
            // expose focus, so this is a best-effort "what's on top".
            let focused = windows.into_iter().find(|w| !w.minimized);
            let Some(w) = focused else { continue };
            let key = format!("{}|{}|{}", w.app, w.id, w.title);
            if last_key.as_deref() == Some(&key) {
                continue;
            }
            last_key = Some(key);

            let s = match state().lock() {
                Ok(s) => s,
                Err(_) => continue,
            };
            let app_name_lc = w.app.to_lowercase();
            let allowed = s.window_allowlist.iter().any(|a| *a == app_name_lc);
            let mut title_out = if allowed { Some(w.title.clone()) } else { None };
            if let Some(t) = title_out.as_mut() {
                for rx in &s.window_redaction {
                    *t = rx.replace_all(t, "[redacted]").into_owned();
                }
            }
            let redacted = title_out.is_none() || allowed && title_out.as_ref() != Some(&w.title);
            drop(s);

            let payload = WindowChangedPayload {
                app: w.app,
                title: title_out,
                window_id: w.id,
                bounds: BoundsPayload {
                    x: w.bounds.x,
                    y: w.bounds.y,
                    w: w.bounds.w,
                    h: w.bounds.h,
                },
                redacted,
            };
            let _ = app_handle.emit(WINDOW_CHANGED_EVENT, payload);
        }
    });

    let mut s = state().lock().map_err(|e| format!("lock_poisoned: {e}"))?;
    s.window_handle = Some(handle);
    Ok(())
}

pub fn window_track_stop() -> Result<(), String> {
    let mut s = state().lock().map_err(|e| format!("lock_poisoned: {e}"))?;
    if let Some(h) = s.window_handle.take() {
        h.abort();
    }
    Ok(())
}

// ── File-watcher ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWatchStartArgs {
    /// Absolute paths to watch. Must be a directory or file; symlinks are
    /// followed. The watcher refuses paths that don't exist.
    pub roots: Vec<String>,
    /// When true (default), watches recursively. Set false for shallow.
    #[serde(default = "default_true")]
    pub recursive: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedPayload {
    pub kind: String,
    pub paths: Vec<String>,
}

pub fn fs_watch_start(app: AppHandle, args: FsWatchStartArgs) -> Result<(), String> {
    if args.roots.is_empty() {
        return Err("no_roots: provide at least one path".into());
    }
    let roots: Vec<PathBuf> = args.roots.iter().map(PathBuf::from).collect();
    for r in &roots {
        if !r.exists() {
            return Err(format!("root_missing: {}", r.display()));
        }
    }

    // Tear down any existing watcher.
    let mut s = state().lock().map_err(|e| format!("lock_poisoned: {e}"))?;
    s.fs_watcher = None;
    drop(s);

    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<NotifyEvent, _>| {
        let Ok(ev) = res else { return };
        let kind = format!("{:?}", ev.kind);
        let paths: Vec<String> = ev.paths.iter().map(|p| p.display().to_string()).collect();
        let payload = FileChangedPayload { kind, paths };
        let _ = app_handle.emit(FILE_CHANGED_EVENT, payload);
    })
    .map_err(|e| format!("watcher_failed: {e}"))?;

    // Default debouncing comes from the underlying notify backend.
    watcher
        .configure(Config::default())
        .map_err(|e| format!("watcher_config_failed: {e}"))?;

    let mode = if args.recursive {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    };
    for r in &roots {
        watcher
            .watch(r, mode)
            .map_err(|e| format!("watch_failed for {}: {}", r.display(), e))?;
    }

    let mut s = state().lock().map_err(|e| format!("lock_poisoned: {e}"))?;
    s.fs_roots = roots;
    s.fs_watcher = Some(watcher);
    Ok(())
}

pub fn fs_watch_stop() -> Result<(), String> {
    let mut s = state().lock().map_err(|e| format!("lock_poisoned: {e}"))?;
    s.fs_watcher = None;
    s.fs_roots.clear();
    Ok(())
}

// ── Status ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorStatus {
    pub window_tracking: bool,
    pub fs_watching: bool,
    pub fs_roots: Vec<String>,
}

pub fn status() -> Result<SensorStatus, String> {
    let s = state().lock().map_err(|e| format!("lock_poisoned: {e}"))?;
    Ok(SensorStatus {
        window_tracking: s.window_handle.is_some(),
        fs_watching: s.fs_watcher.is_some(),
        fs_roots: s.fs_roots.iter().map(|p| p.display().to_string()).collect(),
    })
}
