//! Window-form management — show/hide/toggle the HUD and Assistant windows
//! and flip click-through on the Assistant so the user can drag it (and
//! clicks pass through the transparent margin when locked).
//!
//! Live2D / VRM rendering happens in the React layer; this module is purely
//! about positioning and input transparency.

use tauri::{Manager, Runtime, WebviewWindow};

const HUD_LABEL: &str = "hud";
const ASSISTANT_LABEL: &str = "assistant";
const OVERLAY_LABEL: &str = "overlay";

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
