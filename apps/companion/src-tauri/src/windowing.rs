//! Window enumeration + native focus/move — cross-platform via `xcap` for
//! enumeration; per-OS native APIs for focus/move.
//!
//! The `id` field on `WindowInfo` is `xcap::Window::id()` rendered as a
//! decimal string. On Windows that's the HWND; on macOS the
//! `kCGWindowNumber`; on Linux (X11) the X window id (XID). The Conductor
//! uses that opaque id in a single turn — list_windows, then focus/move.
//!
//! Per-platform implementation:
//! - **Windows** (slice 7b): `windows = "0.56"` crate —
//!   `SetForegroundWindow` + `ShowWindow(SW_RESTORE)` + `SetWindowPos`.
//! - **Linux** (slice 7c): shells out to `wmctrl -i` (the de-facto EWMH
//!   tool). Requires `wmctrl` on PATH and an X11 / XWayland session.
//!   Native Wayland is intentionally out of scope (no compositor-agnostic
//!   protocol exists for foreign window placement). Returns a helpful
//!   error if `wmctrl` is missing.
//! - **macOS** (slice 7c): shells out to `osascript` driving System
//!   Events. Looks the window up by id in `xcap` to recover the owning
//!   app name, then targets that app's frontmost window. Requires the
//!   user to grant Accessibility + Automation permissions to the
//!   companion. Targeting a specific non-frontmost window by
//!   `kCGWindowNumber` is not feasible from AppleScript, so this is a
//!   best-effort surface — call `focus_window` first, then `move_window`.

use serde::Serialize;
use xcap::Window;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: String,
    pub title: String,
    pub app: String,
    pub bounds: WindowBounds,
    pub focused: bool,
    pub minimized: bool,
}

pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let windows = Window::all().map_err(|e| format!("window_enum_failed: {e}"))?;
    let mut out: Vec<WindowInfo> = Vec::with_capacity(windows.len());
    for w in windows.iter() {
        let title = w.title().to_string();
        let app = w.app_name().to_string();
        let x = w.x();
        let y = w.y();
        let width = w.width();
        let height = w.height();
        let minimized = w.is_minimized();
        if title.is_empty() && app.is_empty() {
            continue;
        }
        out.push(WindowInfo {
            id: w.id().to_string(),
            title,
            app,
            bounds: WindowBounds {
                x,
                y,
                w: width,
                h: height,
            },
            // xcap doesn't expose focused state; on Windows we could query
            // GetForegroundWindow() and compare HWNDs — leaving as `false`
            // until a Conductor flow actually depends on it.
            focused: false,
            minimized,
        });
    }
    Ok(out)
}

fn parse_id(id: &str) -> Result<u32, String> {
    id.parse::<u32>()
        .map_err(|_| format!("invalid_window_id: {id}"))
}

#[cfg(windows)]
pub fn focus_window(id: &str) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        IsWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    let raw = parse_id(id)?;
    let hwnd = HWND(raw as isize);
    unsafe {
        if !IsWindow(hwnd).as_bool() {
            return Err(format!("window_not_found: {id}"));
        }
        let _ = ShowWindow(hwnd, SW_RESTORE);
        if !SetForegroundWindow(hwnd).as_bool() {
            return Err("set_foreground_failed".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn focus_window(id: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        return linux::focus(id);
    }
    #[cfg(target_os = "macos")]
    {
        return macos::focus(id);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = id;
        Err(format!("unsupported_on_platform: {}", std::env::consts::OS))
    }
}

#[cfg(windows)]
pub fn move_window(id: &str, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        IsWindow, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
    };
    if w == 0 || h == 0 {
        return Err("invalid_bounds: w and h must be > 0".into());
    }
    if w > 16_384 || h > 16_384 {
        return Err("invalid_bounds: w/h exceed 16384".into());
    }
    let raw = parse_id(id)?;
    let hwnd = HWND(raw as isize);
    unsafe {
        if !IsWindow(hwnd).as_bool() {
            return Err(format!("window_not_found: {id}"));
        }
        SetWindowPos(
            hwnd,
            HWND(0),
            x,
            y,
            w as i32,
            h as i32,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|e| format!("set_window_pos_failed: {e}"))?;
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn move_window(id: &str, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
    if w == 0 || h == 0 {
        return Err("invalid_bounds: w and h must be > 0".into());
    }
    if w > 16_384 || h > 16_384 {
        return Err("invalid_bounds: w/h exceed 16384".into());
    }
    #[cfg(target_os = "linux")]
    {
        return linux::move_(id, x, y, w, h);
    }
    #[cfg(target_os = "macos")]
    {
        return macos::move_(id, x, y, w, h);
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (id, x, y, w, h);
        Err(format!("unsupported_on_platform: {}", std::env::consts::OS))
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::process::Command;

    fn xid_hex(id: &str) -> Result<String, String> {
        let n: u32 = id.parse().map_err(|_| format!("invalid_window_id: {id}"))?;
        Ok(format!("0x{n:08x}"))
    }

    fn run_wmctrl(args: &[&str]) -> Result<(), String> {
        let out = Command::new("wmctrl").args(args).output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "wmctrl_not_installed: install `wmctrl` (apt/dnf/pacman) and ensure an X11 / XWayland session".into()
            } else {
                format!("wmctrl_spawn_failed: {e}")
            }
        })?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            return Err(format!("wmctrl_failed: {} ({})", stderr.trim(), out.status));
        }
        Ok(())
    }

    pub fn focus(id: &str) -> Result<(), String> {
        let xid = xid_hex(id)?;
        run_wmctrl(&["-i", "-a", &xid])
    }

    pub fn move_(id: &str, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
        let xid = xid_hex(id)?;
        // wmctrl -e gravity,x,y,w,h — gravity 0 = use the window's gravity.
        let geom = format!("0,{x},{y},{w},{h}");
        run_wmctrl(&["-i", "-r", &xid, "-e", &geom])
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::process::Command;
    use xcap::Window;

    fn app_for_id(id: &str) -> Result<String, String> {
        let target: u32 = id.parse().map_err(|_| format!("invalid_window_id: {id}"))?;
        let windows = Window::all().map_err(|e| format!("window_enum_failed: {e}"))?;
        for w in windows.iter() {
            if w.id() == target {
                let app = w.app_name().to_string();
                if app.is_empty() {
                    return Err(format!("window_has_no_app: {id}"));
                }
                return Ok(app);
            }
        }
        Err(format!("window_not_found: {id}"))
    }

    fn run_osascript(script: &str) -> Result<(), String> {
        let out = Command::new("osascript")
            .args(["-e", script])
            .output()
            .map_err(|e| format!("osascript_spawn_failed: {e}"))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            // The most common failure is the user not having granted
            // Accessibility / Automation permission to the companion.
            return Err(format!(
                "osascript_failed: {} ({}). Grant Accessibility + Automation permission to the companion in System Settings.",
                stderr.trim(),
                out.status
            ));
        }
        Ok(())
    }

    fn escape(s: &str) -> String {
        s.replace('\\', "\\\\").replace('"', "\\\"")
    }

    pub fn focus(id: &str) -> Result<(), String> {
        let app = app_for_id(id)?;
        let app_esc = escape(&app);
        let script = format!("tell application \"{app_esc}\" to activate");
        run_osascript(&script)
    }

    pub fn move_(id: &str, x: i32, y: i32, w: u32, h: u32) -> Result<(), String> {
        let app = app_for_id(id)?;
        let app_esc = escape(&app);
        // Targets the app's frontmost window — addressing a specific
        // window by kCGWindowNumber from AppleScript isn't feasible.
        // Callers should `focus_window` first if they need a specific one.
        let script = format!(
            "tell application \"System Events\" to tell process \"{app_esc}\"\n\
             set position of window 1 to {{{x}, {y}}}\n\
             set size of window 1 to {{{w}, {h}}}\n\
             end tell"
        );
        run_osascript(&script)
    }
}
