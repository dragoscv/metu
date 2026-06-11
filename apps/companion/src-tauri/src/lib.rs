//! METU Companion — Tauri application shell.
//!
//! Responsibilities of the Rust side (everything user-visible lives in the
//! React frontend):
//!   * Single-instance enforcement.
//!   * System tray icon with Show/Quit actions.
//!   * Global hotkey to toggle the main window.
//!   * Hide-to-tray on close instead of exiting.
//!   * Plugin wiring: shell (open external URL during OAuth), notification,
//!     store (encrypted persistent KV), OS info, deep-link, global-shortcut.

use tauri::{
    menu::{Menu, MenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::ShellExt;

mod a11y;
mod caps;
mod diag;
mod forms;
mod fs;
mod input;
mod mdns;
mod oauth;
mod screenshot;
mod see;
mod sense;
mod sensors;
mod shell;
mod spatial;
mod windowing;

// ── Tauri commands (slice 6) ───────────────────────────────────────────────

#[tauri::command]
async fn device_screenshot(
    args: screenshot::ScreenshotArgs,
) -> Result<screenshot::ScreenshotResult, String> {
    caps::require("screenshot")?;
    // xcap is sync + may block; punt to a blocking thread so we don't stall
    // the Tauri event loop.
    tauri::async_runtime::spawn_blocking(move || screenshot::capture(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_list_windows() -> Result<Vec<windowing::WindowInfo>, String> {
    caps::require("windows_read")?;
    tauri::async_runtime::spawn_blocking(windowing::list_windows)
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_a11y_tree(args: a11y::A11yArgs) -> Result<a11y::A11yTree, String> {
    caps::require("a11y_read")?;
    tauri::async_runtime::spawn_blocking(move || a11y::read(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

/// Ungated UIA read for USER-INITIATED local analysis ("Analyze my
/// screen" in the avatar menu). The `device_a11y_tree` command above stays
/// capability-gated because the REMOTE Conductor calls it; this one is
/// only invoked by the local skill lane in direct response to a click,
/// and reads the same data the sense engine already captures via OCR.
#[tauri::command]
async fn sense_ui_outline(args: a11y::A11yArgs) -> Result<a11y::A11yTree, String> {
    tauri::async_runtime::spawn_blocking(move || a11y::read(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

/// Ungated window enumeration for the avatar's screen-world model (the
/// platformer level: window tops = platforms). Geometry only — titles are
/// already captured by the sense engine; remote callers keep using the
/// gated `device_list_windows`.
#[tauri::command]
async fn sense_window_map() -> Result<Vec<windowing::WindowInfo>, String> {
    tauri::async_runtime::spawn_blocking(windowing::list_windows)
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

/// Ungated UIA actions for USER-CONFIRMED local act-skill steps. The
/// remote-facing `device_a11y_invoke`/`device_a11y_set_value` stay
/// capability-gated; these run ONLY after the user pressed the confirm
/// button in the ask-before-act bubble (the JS side never calls them
/// without an explicit confirmation gesture).
#[tauri::command]
async fn sense_ui_invoke(args: a11y::A11yActionArgs) -> Result<a11y::A11yActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || a11y::invoke(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn sense_ui_set_value(args: a11y::A11yActionArgs) -> Result<a11y::A11yActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || a11y::set_value(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

// ── Companion-Agent slice 1 — semantic a11y actions ────────────────────────

#[tauri::command]
async fn device_a11y_find(args: a11y::A11yFindArgs) -> Result<a11y::A11yFindResult, String> {
    caps::require("a11y_read")?;
    tauri::async_runtime::spawn_blocking(move || a11y::find(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_a11y_invoke(args: a11y::A11yActionArgs) -> Result<a11y::A11yActionResult, String> {
    caps::require("a11y_invoke")?;
    tauri::async_runtime::spawn_blocking(move || a11y::invoke(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_a11y_set_value(
    args: a11y::A11yActionArgs,
) -> Result<a11y::A11yActionResult, String> {
    caps::require("a11y_invoke")?;
    tauri::async_runtime::spawn_blocking(move || a11y::set_value(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

// ── Companion-Agent slice 5 — vision composition ───────────────────────────

#[tauri::command]
async fn device_see(args: see::SeeArgs) -> Result<see::SeeResult, String> {
    caps::require("screenshot")?;
    tauri::async_runtime::spawn_blocking(move || see::see(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

// ── Slice 7 — synthetic input + shell allowlist ────────────────────────────

#[tauri::command]
async fn device_type_text(args: input::TypeTextArgs) -> Result<input::InputOk, String> {
    caps::require("input")?;
    tauri::async_runtime::spawn_blocking(move || input::type_text(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_send_keys(args: input::SendKeysArgs) -> Result<input::InputOk, String> {
    caps::require("input")?;
    tauri::async_runtime::spawn_blocking(move || input::send_keys(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_click(args: input::ClickArgs) -> Result<input::InputOk, String> {
    caps::require("input")?;
    tauri::async_runtime::spawn_blocking(move || input::click(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_media_key(args: input::MediaKeyArgs) -> Result<input::InputOk, String> {
    caps::require("input")?;
    tauri::async_runtime::spawn_blocking(move || input::media_key(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

// ── Slice (D14b) — jailed filesystem (METU_FS_ROOTS allowlist) ───────────

#[tauri::command]
async fn device_fs_read(args: fs::FsReadArgs) -> Result<fs::FsReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || fs::read(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_fs_write(args: fs::FsWriteArgs) -> Result<fs::FsWriteResult, String> {
    tauri::async_runtime::spawn_blocking(move || fs::write(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_fs_list_roots() -> Result<fs::FsRootsResult, String> {
    tauri::async_runtime::spawn_blocking(fs::list_roots)
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

#[tauri::command]
async fn device_shell_exec(args: shell::ShellExecArgs) -> Result<shell::ShellExecResult, String> {
    caps::require("shell")?;
    tauri::async_runtime::spawn_blocking(move || shell::exec(args))
        .await
        .map_err(|e| format!("join_failed: {e}"))?
}

// ── Slice 7b — native window focus / move (Windows only for now) ────────

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FocusWindowArgs {
    window_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveWindowBounds {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveWindowArgs {
    window_id: String,
    bounds: MoveWindowBounds,
}

#[tauri::command]
async fn device_focus_window(args: FocusWindowArgs) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || windowing::focus_window(&args.window_id))
        .await
        .map_err(|e| format!("join_failed: {e}"))??;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn device_move_window(args: MoveWindowArgs) -> Result<serde_json::Value, String> {
    let MoveWindowArgs { window_id, bounds } = args;
    tauri::async_runtime::spawn_blocking(move || {
        windowing::move_window(&window_id, bounds.x, bounds.y, bounds.w, bounds.h)
    })
    .await
    .map_err(|e| format!("join_failed: {e}"))??;
    Ok(serde_json::json!({ "ok": true }))
}

// ── Slice 6 — ambient sensors (window tracker + file watcher) ───────────

#[tauri::command]
async fn device_window_track_start(
    app: tauri::AppHandle,
    args: sensors::WindowTrackStartArgs,
) -> Result<serde_json::Value, String> {
    caps::require("window_track")?;
    sensors::window_track_start(app, args)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn device_window_track_stop() -> Result<serde_json::Value, String> {
    sensors::window_track_stop()?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn device_fs_watch_start(
    app: tauri::AppHandle,
    args: sensors::FsWatchStartArgs,
) -> Result<serde_json::Value, String> {
    caps::require("fs_watch")?;
    sensors::fs_watch_start(app, args)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn device_fs_watch_stop() -> Result<serde_json::Value, String> {
    sensors::fs_watch_stop()?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn device_sensors_status() -> Result<sensors::SensorStatus, String> {
    sensors::status()
}

fn toggle_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// Open a relative path on the configured METU web app in the system browser.
/// Base URL comes from the `METU_WEB_URL` env var; falls back to https://metu.ro.
fn open_web_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: &str) {
    let base = std::env::var("METU_WEB_URL").unwrap_or_else(|_| "https://metu.ro".to_string());
    let trimmed = base.trim_end_matches('/');
    let url = format!("{trimmed}{path}");
    let _ = app.shell().open(url, None);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_shell::init())
        .manage(oauth::LoopbackState::default())
        .manage(diag::DiagState::default())
        .manage(forms::AssistantInput::default())
        .manage(sense::SenseState::default())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            device_screenshot,
            device_list_windows,
            device_a11y_tree,
            device_a11y_find,
            sense_ui_outline,
            sense_ui_invoke,
            sense_ui_set_value,
            sense_window_map,
            device_a11y_invoke,
            device_a11y_set_value,
            device_see,
            device_type_text,
            device_send_keys,
            device_click,
            device_media_key,
            device_fs_read,
            device_fs_write,
            device_fs_list_roots,
            device_shell_exec,
            device_focus_window,
            device_move_window,
            device_window_track_start,
            device_window_track_stop,
            device_fs_watch_start,
            device_fs_watch_stop,
            device_sensors_status,
            forms::presence_hud_show,
            forms::presence_hud_hide,
            forms::presence_hud_toggle,
            forms::presence_assistant_show,
            forms::presence_assistant_hide,
            forms::presence_assistant_set_clickthrough,
            forms::presence_assistant_set_interactive_lock,
            forms::presence_assistant_set_zones,
            forms::presence_overlay_show,
            forms::presence_overlay_hide,
            mdns::mdns_announce,
            mdns::mdns_stop,
            mdns::mdns_status,
            oauth::oauth_loopback_start,
            oauth::oauth_loopback_wait,
            oauth::oauth_loopback_cancel,
            oauth::oauth_exchange,
            oauth::oauth_refresh,
            diag::diag_log,
            diag::diag_recent,
            diag::diag_snapshot,
            diag::win_minimize,
            diag::win_hide,
            diag::win_toggle_maximize,
            diag::win_start_drag,
            spatial::spatial_monitors,
            spatial::spatial_cursor,
            spatial::spatial_foreground,
            sense::sense_search,
            sense::sense_timeline,
            sense::sense_recent_text,
            sense::sense_set_paused,
            sense::sense_set_blocklist,
            sense::sense_status,
            sense::sense_store_summary,
        ])
        .setup(|app| {
            // ── Diagnostics log file ────────────────────────────────────
            diag::init(app);
            // ── Assistant click-through autopilot (native, single writer) ──
            forms::start_assistant_input_watcher(app.handle().clone());
            // ── Jarvis Slice A — ambient sense engine ──────────────────
            sense::start_sense_engine(app.handle().clone());
            // ── Tray ────────────────────────────────────────────────────
            let show_item = MenuItem::with_id(app, "show", "Show METU", true, None::<&str>)?;
            let backlog_item = MenuItem::with_id(
                app,
                "open_backlog",
                "Open conductor backlog…",
                true,
                None::<&str>,
            )?;
            let inbox_item = MenuItem::with_id(
                app,
                "open_inbox",
                "Open notification inbox…",
                true,
                None::<&str>,
            )?;
            let conductor_submenu = Submenu::with_id_and_items(
                app,
                "conductor",
                "Conductor",
                true,
                &[&backlog_item, &inbox_item],
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &conductor_submenu, &quit_item])?;
            let _tray = TrayIconBuilder::with_id("metu-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("METU")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_main_window(app),
                    "open_backlog" => open_web_path(app, "/dashboard?tab=now"),
                    "open_inbox" => open_web_path(app, "/inbox"),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // ── Global hotkey: Ctrl+Alt+M (Cmd+Alt+M on macOS via Super) ──
            let app_handle = app.handle().clone();
            let toggle_shortcut =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM);
            // Slice 8: Ctrl+Alt+Space summons the full-screen HUD.
            let app_handle_hud = app.handle().clone();
            let hud_shortcut =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
            app.global_shortcut()
                .on_shortcut(toggle_shortcut, move |_, _, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main_window(&app_handle);
                    }
                })?;
            app.global_shortcut()
                .on_shortcut(hud_shortcut, move |_, _, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(win) = app_handle_hud.get_webview_window("hud") {
                            let visible = win.is_visible().unwrap_or(false);
                            if visible {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide-to-tray instead of quitting.
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
