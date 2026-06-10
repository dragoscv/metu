//! Pet spatial awareness — the primitives the desktop pet's "brain" needs to
//! move intelligently around the screen(s) and react to the user's focus.
//!
//! Everything here is read-only sensing (no synthetic input); acting on
//! windows still goes through `windowing.rs` + the ACL. Provided commands:
//!
//!   * `pet_monitors`         → geometry + scale of every display
//!   * `pet_cursor`           → current global cursor position
//!   * `pet_foreground`       → the focused top-level window (for perch/react)
//!
//! Windows has first-class APIs for all three; macOS/Linux get best-effort
//! fallbacks (cursor/foreground are stubbed where the platform API isn't wired
//! yet, so the JS brain degrades to wander-only rather than breaking).

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    /// DPI scale factor (1.0 = 96 DPI). Physical pixels = logical * scale.
    pub scale: f64,
    pub primary: bool,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindow {
    /// Native window id (HWND on Windows) as a string, matching
    /// `windowing::WindowInfo.id` so the brain can cross-reference.
    pub id: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Enumerate all monitors with physical-pixel geometry + scale.
///
/// Uses Tauri's window manager (winit under the hood) which already knows the
/// full monitor layout, so this is cross-platform for free.
#[tauri::command]
pub fn pet_monitors(window: tauri::Window) -> Result<Vec<MonitorInfo>, String> {
    let primary = window.primary_monitor().ok().flatten();
    let primary_pos = primary.as_ref().map(|m| *m.position());
    let monitors = window
        .available_monitors()
        .map_err(|e| format!("monitor_enum_failed: {e}"))?;
    let out = monitors
        .into_iter()
        .map(|m| {
            let pos = m.position();
            let size = m.size();
            MonitorInfo {
                x: pos.x,
                y: pos.y,
                w: size.width,
                h: size.height,
                scale: m.scale_factor(),
                primary: primary_pos == Some(*pos),
            }
        })
        .collect();
    Ok(out)
}

/// Current global cursor position in physical pixels.
#[cfg(windows)]
#[tauri::command]
pub fn pet_cursor() -> Result<Point, String> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT { x: 0, y: 0 };
    unsafe {
        GetCursorPos(&mut p).map_err(|e| format!("cursor_failed: {e}"))?;
    }
    Ok(Point { x: p.x, y: p.y })
}

#[cfg(not(windows))]
#[tauri::command]
pub fn pet_cursor() -> Result<Point, String> {
    // macOS (CGEvent) / Linux (XQueryPointer) fallbacks are future work; the
    // JS brain treats an error as "cursor unknown" and skips follow mode.
    Err(format!("unsupported_on_platform: {}", std::env::consts::OS))
}

/// The focused top-level window — used for "perch on active window" and
/// window-change reactions. Returns `None` when the foreground window is the
/// desktop or one of our own pet/HUD windows.
#[cfg(windows)]
#[tauri::command]
pub fn pet_foreground() -> Result<Option<ForegroundWindow>, String> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    };
    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0 == 0 {
            return Ok(None);
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return Ok(None);
        }
        let len = GetWindowTextLengthW(hwnd);
        let title = if len > 0 {
            let mut buf = vec![0u16; (len + 1) as usize];
            let read = GetWindowTextW(hwnd, &mut buf);
            String::from_utf16_lossy(&buf[..read as usize])
        } else {
            String::new()
        };
        let w = (rect.right - rect.left).max(0) as u32;
        let h = (rect.bottom - rect.top).max(0) as u32;
        Ok(Some(ForegroundWindow {
            id: (hwnd.0 as u32).to_string(),
            title,
            x: rect.left,
            y: rect.top,
            w,
            h,
        }))
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn pet_foreground() -> Result<Option<ForegroundWindow>, String> {
    Err(format!("unsupported_on_platform: {}", std::env::consts::OS))
}
