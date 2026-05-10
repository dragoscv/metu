//! Window-form management — show/hide/toggle the HUD and Pet windows and
//! flip click-through on the Pet so the user can drag it (and clicks pass
//! through the transparent margin when locked).
//!
//! Live2D / VRM rendering happens in the React layer; this module is purely
//! about positioning and input transparency.

use tauri::{Manager, Runtime, WebviewWindow};

const HUD_LABEL: &str = "hud";
const PET_LABEL: &str = "pet";

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
pub async fn presence_pet_show<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let w = lookup(&app, PET_LABEL)?;
    w.show().map_err(|e| format!("show_failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn presence_pet_hide<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let w = lookup(&app, PET_LABEL)?;
    w.hide().map_err(|e| format!("hide_failed: {e}"))?;
    Ok(())
}

/// Toggle whether mouse events pass through transparent regions of the Pet
/// window. When `enabled = true`, clicks fall through to the desktop; the
/// pet stops receiving pointer events. The React side flips this on/off
/// around interactive zones (character body, speech bubble) so the user
/// can still pet/drag/right-click without breaking workflow.
#[tauri::command]
pub async fn presence_pet_set_clickthrough<R: Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    let w = lookup(&app, PET_LABEL)?;
    w.set_ignore_cursor_events(enabled)
        .map_err(|e| format!("ignore_cursor_failed: {e}"))?;
    Ok(())
}
