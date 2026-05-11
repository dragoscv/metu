//! Capability gate.
//!
//! Single source of truth for "is this Tauri command allowed to run?".
//! Reads `METU_CAPABILITIES` (comma-separated, e.g.
//! `screenshot,a11y_read,a11y_invoke,input,shell`). Default-deny —
//! omitting the env var means *every* gated command rejects.
//!
//! Capability names are intentionally coarse so users can reason about
//! risk without per-command opt-ins. Mapping:
//!
//!   | capability   | commands                                            |
//!   | screenshot   | device_screenshot, device_see                       |
//!   | windows_read | device_list_windows                                 |
//!   | a11y_read    | device_a11y_tree, device_a11y_find                  |
//!   | a11y_invoke  | device_a11y_invoke, device_a11y_set_value           |
//!   | input        | device_type_text, device_send_keys, device_click,   |
//!   |              | device_media_key                                    |
//!   | shell        | device_shell_exec (also requires METU_SHELL_ALLOWLIST) |
//!   | mdns         | device_mdns_*                                       |
//!
//! The companion UI surfaces a settings panel that writes this env into
//! the Tauri `store` plugin and re-launches; we read it at command
//! invocation time so toggling does not require a process restart.

use std::env;

const CAPS_ENV: &str = "METU_CAPABILITIES";

/// Returns Ok(()) when the capability is enabled, otherwise an error
/// message safe to forward to the calling JS side. The error name
/// (`capability_disabled:<cap>`) is parsed by the frontend to render
/// the upgrade-permissions modal.
pub fn require(cap: &str) -> Result<(), String> {
    if is_enabled(cap) {
        return Ok(());
    }
    Err(format!("capability_disabled:{cap}"))
}

pub fn is_enabled(cap: &str) -> bool {
    let raw = match env::var(CAPS_ENV) {
        Ok(v) => v,
        Err(_) => return false,
    };
    raw.split(',')
        .map(|s| s.trim())
        .any(|s| !s.is_empty() && s.eq_ignore_ascii_case(cap))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_deny_when_env_missing() {
        // SAFETY: tests run single-threaded under the default cargo runner;
        // even if not, removing an env var only races with other tests
        // that touch the same var, of which we have none.
        unsafe {
            env::remove_var(CAPS_ENV);
        }
        assert!(!is_enabled("screenshot"));
        assert!(require("screenshot").is_err());
    }

    #[test]
    fn matches_case_insensitive_with_whitespace() {
        unsafe {
            env::set_var(CAPS_ENV, " Screenshot , a11y_read ,Input ");
        }
        assert!(is_enabled("screenshot"));
        assert!(is_enabled("INPUT"));
        assert!(is_enabled("a11y_read"));
        assert!(!is_enabled("shell"));
    }
}
