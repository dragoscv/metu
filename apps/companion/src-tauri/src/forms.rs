//! Window-form management — show/hide/toggle the HUD and Assistant windows
//! and flip click-through on the Assistant so the user can drag it (and
//! clicks pass through the transparent margin when locked).
//!
//! Live2D / VRM rendering happens in the React layer; this module is purely
//! about positioning and input transparency.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, Runtime, WebviewWindow};

const HUD_LABEL: &str = "hud";
const ASSISTANT_LABEL: &str = "assistant";
const OVERLAY_LABEL: &str = "overlay";

/// Shared input state for the assistant window. `lock_interactive` is set by
/// the JS layer whenever an interactive surface is engaged (chat open, drag
/// in progress, pointer over body/bubble/menu) and forces click-through OFF
/// regardless of cursor position.
#[derive(Default)]
pub struct AssistantInput {
    pub lock_interactive: AtomicBool,
}

fn lookup<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window(label)
        .ok_or_else(|| format!("window_not_found: {label}"))
}

#[tauri::command]
pub async fn presence_hud_show<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let w = lookup(&app, HUD_LABEL)?;
    w.show().map_err(|e| format!("show_failed: {e}"))?;
    w.set_focus().map_err(|e| format!("focus_failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn presence_hud_hide<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let w = lookup(&app, HUD_LABEL)?;
    w.hide().map_err(|e| format!("hide_failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn presence_hud_toggle<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
    let w = lookup(&app, HUD_LABEL)?;
    let visible = w.is_visible().map_err(|e| format!("vis_failed: {e}"))?;
    if visible {
        w.hide().map_err(|e| format!("hide_failed: {e}"))?;
        Ok(false)
    } else {
        w.show().map_err(|e| format!("show_failed: {e}"))?;
        w.set_focus().map_err(|e| format!("focus_failed: {e}"))?;
        Ok(true)
    }
}

#[tauri::command]
pub async fn presence_assistant_show<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let w = lookup(&app, ASSISTANT_LABEL)?;
    w.show().map_err(|e| format!("show_failed: {e}"))?;
    // Tell the assistant webview it just became visible so it can greet.
    // The webview mounts (and runs effects) long before the window is shown,
    // so any "greet on mount" bubble would have expired before being seen.
    use tauri::Emitter;
    let _ = w.emit("metu://assistant-shown", ());
    Ok(())
}

#[tauri::command]
pub async fn presence_assistant_hide<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let w = lookup(&app, ASSISTANT_LABEL)?;
    w.hide().map_err(|e| format!("hide_failed: {e}"))?;
    Ok(())
}

/// Toggle whether mouse events pass through transparent regions of the
/// Assistant window. When `enabled = true`, clicks fall through to the
/// desktop; the assistant stops receiving pointer events. The React side
/// flips this on/off around interactive zones (character body, speech
/// bubble, chat panel) so the user can interact without breaking workflow.
#[tauri::command]
pub async fn presence_assistant_set_clickthrough<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    let w = lookup(&app, ASSISTANT_LABEL)?;
    w.set_ignore_cursor_events(enabled)
        .map_err(|e| format!("ignore_cursor_failed: {e}"))?;
    Ok(())
}

/// Set the interactive lock for the assistant window. While locked (chat
/// open, drag in progress, pointer over an interactive zone) the native
/// watcher keeps click-through OFF unconditionally.
#[tauri::command]
pub async fn presence_assistant_set_interactive_lock<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AssistantInput>,
    locked: bool,
) -> Result<(), String> {
    state.lock_interactive.store(locked, Ordering::Relaxed);
    if locked {
        // Apply immediately — don't wait for the watcher tick. The user is
        // mid-interaction right now.
        let w = lookup(&app, ASSISTANT_LABEL)?;
        let _ = w.set_ignore_cursor_events(false);
    }
    Ok(())
}

/// Native click-through autopilot for the assistant window.
///
/// Why Rust instead of JS polling: the JS reconciler raced its own IPC
/// (out-of-order `set_ignore_cursor_events` calls), lost state on Vite HMR,
/// and a click-through window receives no DOM events so the JS side was
/// always working with stale data. Here a single OS thread is the only
/// writer: every 50ms it reads the real cursor + the real window rect and
/// flips `ignore_cursor_events` exactly when needed. Every ~1s it re-applies
/// the current state unconditionally so any external toggle self-heals.
pub fn start_assistant_input_watcher<R: Runtime>(app: tauri::AppHandle<R>) {
    std::thread::spawn(move || {
        let mut last: Option<bool> = None;
        let mut ticks: u32 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(50));
            ticks = ticks.wrapping_add(1);
            let Some(w) = app.get_webview_window(ASSISTANT_LABEL) else {
                continue;
            };
            if !w.is_visible().unwrap_or(false) {
                last = None;
                continue;
            }
            let locked = app
                .state::<AssistantInput>()
                .lock_interactive
                .load(Ordering::Relaxed);
            let interactive = locked || cursor_inside(&w);
            let ignore = !interactive;
            // Force re-apply every ~1s so external writers can't strand us.
            let force = ticks % 20 == 0;
            if force || last != Some(ignore) {
                match w.set_ignore_cursor_events(ignore) {
                    Ok(()) => last = Some(ignore),
                    Err(_) => last = None,
                }
            }
        }
    });
}

#[cfg(windows)]
fn cursor_inside<R: Runtime>(w: &WebviewWindow<R>) -> bool {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut p) }.is_err() {
        // Cursor unknown — never go click-through or the window could
        // become permanently unreachable.
        return true;
    }
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) else {
        return true;
    };
    const MARGIN: i32 = 16;
    p.x >= pos.x - MARGIN
        && p.x <= pos.x + size.width as i32 + MARGIN
        && p.y >= pos.y - MARGIN
        && p.y <= pos.y + size.height as i32 + MARGIN
}

#[cfg(not(windows))]
fn cursor_inside<R: Runtime>(_w: &WebviewWindow<R>) -> bool {
    // No native cursor read on this platform yet — stay interactive.
    true
}

/// Show the fullscreen transparent overlay used to highlight a region or
/// point at an on-screen element. Always click-through so it never steals
/// input from the app the user is working in.
#[tauri::command]
pub async fn presence_overlay_show<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let w = lookup(&app, OVERLAY_LABEL)?;
    w.set_ignore_cursor_events(true)
        .map_err(|e| format!("ignore_cursor_failed: {e}"))?;
    w.show().map_err(|e| format!("show_failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn presence_overlay_hide<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let w = lookup(&app, OVERLAY_LABEL)?;
    w.hide().map_err(|e| format!("hide_failed: {e}"))?;
    Ok(())
}
