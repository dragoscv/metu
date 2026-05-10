//! Synthetic input — keyboard + mouse via `enigo`.
//!
//! Three Conductor-callable operations:
//!   * `type_text` — type a Unicode string into the focused field.
//!   * `send_keys` — press an allowlisted key combo.
//!   * `click`     — move the cursor and click at absolute screen coords.
//!
//! Hard caps: text length ≤ 10_000 chars, key combo size ≤ 8, cursor coords
//! must be non-negative. Anything outside those bounds is rejected before
//! we touch the OS so the agent gets an immediate error in chat.

use enigo::{
    Axis, Button as EButton, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings,
};
use serde::{Deserialize, Serialize};

const MAX_TEXT_LEN: usize = 10_000;
const MAX_KEYS: usize = 8;

#[derive(Debug, Deserialize)]
pub struct TypeTextArgs {
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct SendKeysArgs {
    pub keys: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClickArgs {
    pub x: i32,
    pub y: i32,
    /// "left" | "right" | "middle" — defaults to left.
    #[serde(default = "default_button")]
    pub button: String,
}

fn default_button() -> String {
    "left".to_string()
}

#[derive(Debug, Deserialize)]
pub struct MediaKeyArgs {
    /// One of play|pause|next|prev|volup|voldn|mute. Web zod schema enforces
    /// the same set; we re-validate so an out-of-band caller still gets a
    /// crisp error.
    pub key: String,
}

#[derive(Debug, Serialize)]
pub struct InputOk {
    pub ok: bool,
}

pub fn type_text(args: TypeTextArgs) -> Result<InputOk, String> {
    if args.text.is_empty() {
        return Err("text_empty".into());
    }
    if args.text.len() > MAX_TEXT_LEN {
        return Err(format!(
            "text_too_long: {} > {MAX_TEXT_LEN}",
            args.text.len()
        ));
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo_init: {e}"))?;
    enigo
        .text(&args.text)
        .map_err(|e| format!("type_failed: {e}"))?;
    Ok(InputOk { ok: true })
}

pub fn send_keys(args: SendKeysArgs) -> Result<InputOk, String> {
    if args.keys.is_empty() || args.keys.len() > MAX_KEYS {
        return Err(format!("invalid_key_count: {}", args.keys.len()));
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo_init: {e}"))?;
    let parsed: Vec<Key> = args
        .keys
        .iter()
        .map(|k| parse_key(k))
        .collect::<Result<_, _>>()?;

    // Press all in order, then release in reverse — classic combo semantics.
    for k in &parsed {
        enigo
            .key(*k, Direction::Press)
            .map_err(|e| format!("press_failed: {e}"))?;
    }
    for k in parsed.iter().rev() {
        enigo
            .key(*k, Direction::Release)
            .map_err(|e| format!("release_failed: {e}"))?;
    }
    Ok(InputOk { ok: true })
}

pub fn click(args: ClickArgs) -> Result<InputOk, String> {
    if args.x < 0 || args.y < 0 {
        return Err(format!("invalid_coords: ({},{})", args.x, args.y));
    }
    let button = match args.button.as_str() {
        "left" => EButton::Left,
        "right" => EButton::Right,
        "middle" => EButton::Middle,
        other => return Err(format!("invalid_button: {other}")),
    };
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo_init: {e}"))?;
    enigo
        .move_mouse(args.x, args.y, Coordinate::Abs)
        .map_err(|e| format!("move_failed: {e}"))?;
    enigo
        .button(button, Direction::Click)
        .map_err(|e| format!("click_failed: {e}"))?;
    // No-op axis read so the rustc doesn't strip Axis import in future trims.
    let _ = Axis::Vertical;
    Ok(InputOk { ok: true })
}

/// Press an OS media key. The seven valid names match the web zod schema
/// (`device.media_key`); `play` and `pause` both map to MediaPlayPause
/// because the OS exposes a single toggle key — there is no separate
/// dedicated "play" or "pause" scancode on virtually any keyboard.
pub fn media_key(args: MediaKeyArgs) -> Result<InputOk, String> {
    let key = match args.key.as_str() {
        "play" | "pause" => Key::MediaPlayPause,
        "next" => Key::MediaNextTrack,
        "prev" => Key::MediaPrevTrack,
        "volup" => Key::VolumeUp,
        "voldn" => Key::VolumeDown,
        "mute" => Key::VolumeMute,
        other => return Err(format!("invalid_media_key: {other}")),
    };
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo_init: {e}"))?;
    enigo
        .key(key, Direction::Click)
        .map_err(|e| format!("media_key_failed: {e}"))?;
    Ok(InputOk { ok: true })
}

/// Maps a string token to `enigo::Key`. The allowlist intentionally covers
/// only well-known modifier + navigation + function keys; anything else is
/// rejected so a confused planner can't paste arbitrary key names.
fn parse_key(name: &str) -> Result<Key, String> {
    let n = name.trim();
    // Single character → Unicode key.
    if n.chars().count() == 1 {
        let c = n.chars().next().unwrap();
        return Ok(Key::Unicode(c));
    }
    let key = match n.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Key::Control,
        "shift" => Key::Shift,
        "alt" | "option" => Key::Alt,
        "cmd" | "meta" | "win" | "super" => Key::Meta,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "pgup" => Key::PageUp,
        "pagedown" | "pgdn" => Key::PageDown,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        other => return Err(format!("unknown_key: {other}")),
    };
    Ok(key)
}
