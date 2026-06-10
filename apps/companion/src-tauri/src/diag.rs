//! Diagnostics + structured logging for the companion.
//!
//! Two responsibilities:
//!   1. A ring-buffered, file-backed log that the frontend can append to via
//!      `diag_log` and read back via `diag_recent` / "Copy diagnostics".
//!   2. A `diag_snapshot` command that bundles app/OS versions + recent logs
//!      into one copy-pasteable blob for bug reports.
//!
//! The log file lives under the OS app-log dir (`%LOCALAPPDATA%/app.metu.
//! companion/logs/companion.log` on Windows). Writes are best-effort: a
//! failure to open the file never breaks the app.

use std::collections::VecDeque;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

const RING_CAP: usize = 500;

#[derive(Clone, serde::Serialize)]
pub struct LogLine {
    pub at: String,
    pub level: String,
    pub scope: String,
    pub msg: String,
}

#[derive(Default)]
pub struct DiagState {
    ring: Mutex<VecDeque<LogLine>>,
    log_path: Mutex<Option<PathBuf>>,
}

impl DiagState {
    pub fn set_path(&self, p: PathBuf) {
        if let Ok(mut guard) = self.log_path.lock() {
            *guard = Some(p);
        }
    }

    fn push(&self, line: LogLine) {
        if let Ok(mut ring) = self.ring.lock() {
            if ring.len() >= RING_CAP {
                ring.pop_front();
            }
            ring.push_back(line.clone());
        }
        // Best-effort append to disk.
        if let Ok(guard) = self.log_path.lock() {
            if let Some(path) = guard.as_ref() {
                if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
                    let _ = writeln!(
                        f,
                        "{} [{}] {}: {}",
                        line.at, line.level, line.scope, line.msg
                    );
                }
            }
        }
    }

    fn recent(&self, limit: usize) -> Vec<LogLine> {
        self.ring
            .lock()
            .map(|r| r.iter().rev().take(limit).rev().cloned().collect())
            .unwrap_or_default()
    }
}

/// Initialise the on-disk log path. Called from `setup`.
pub fn init(app: &tauri::App) {
    let state = app.state::<DiagState>();
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = create_dir_all(&dir);
        state.set_path(dir.join("companion.log"));
    }
}

#[tauri::command]
pub fn diag_log(level: String, scope: String, msg: String, state: tauri::State<'_, DiagState>) {
    state.push(LogLine {
        at: now_iso(),
        level,
        scope,
        msg,
    });
}

#[tauri::command]
pub fn diag_recent(limit: Option<usize>, state: tauri::State<'_, DiagState>) -> Vec<LogLine> {
    state.recent(limit.unwrap_or(200))
}

#[derive(serde::Serialize)]
pub struct Diagnostics {
    pub app_version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub log_path: Option<String>,
    pub recent: Vec<LogLine>,
}

#[tauri::command]
pub fn diag_snapshot(state: tauri::State<'_, DiagState>) -> Diagnostics {
    let log_path = state
        .log_path
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|p| p.display().to_string()));
    Diagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        log_path,
        recent: state.recent(200),
    }
}

fn now_iso() -> String {
    // Lightweight ISO-ish timestamp without pulling chrono. Uses the system
    // clock as epoch millis; the frontend usually supplies its own readable
    // time in `msg`, so this is just a coarse ordering key.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{now}")
}

// ── Window controls (frameless custom titlebar) ─────────────────────────────

#[tauri::command]
pub fn win_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

/// Close = hide to tray (mirrors the CloseRequested handler) so the app keeps
/// running in the background.
#[tauri::command]
pub fn win_hide(window: tauri::Window) {
    let _ = window.hide();
}

#[tauri::command]
pub fn win_toggle_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
pub fn win_start_drag(window: tauri::Window) {
    let _ = window.start_dragging();
}
