//! mDNS / DNS-SD presence beacon.
//!
//! Advertises this companion on the local network as `_metu._tcp.local`
//! so other devices on the same LAN (mobile, browser, another desktop)
//! can discover the workspace + hub URL the user is currently paired to.
//! No HTTP server is bound — this is a pure presence beacon. Discovering
//! peers can use the `hub` and `workspace` TXT records to bootstrap their
//! own pairing flow against the user's chosen hub.
//!
//! Lifecycle:
//!   * Frontend calls `mdns_announce(hub, workspace, name)` after a
//!     successful pairing.
//!   * Frontend calls `mdns_stop()` on sign-out or quit.
//!
//! We deliberately use a port of `0` because we are not exposing a real
//! TCP listener — the TXT record is what consumers care about. Most
//! resolvers (avahi-browse, dns-sd, mdns_browser tools) handle port 0
//! gracefully by treating the entry as informational.
//!
//! Errors on the announce path are best-effort: a LAN without multicast
//! support (corporate VPN, container) shouldn't break the app.

use std::collections::HashMap;
use std::sync::Mutex;

use mdns_sd::{ServiceDaemon, ServiceInfo};

const SERVICE_TYPE: &str = "_metu._tcp.local.";

static STATE: Mutex<Option<Beacon>> = Mutex::new(None);

struct Beacon {
    daemon: ServiceDaemon,
    fullname: String,
}

fn local_hostname() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "metu-companion".to_string())
}

fn sanitize_instance(name: &str) -> String {
    // mDNS instance names tolerate a lot but avoid dots / leading-dashes
    // for the friendliest browser output.
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == ' ' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(|c: char| c == '-' || c.is_whitespace());
    if trimmed.is_empty() {
        "metu-companion".to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub fn mdns_announce(hub: String, workspace: String, name: Option<String>) -> Result<(), String> {
    // Stop any previous instance so re-pairing replaces the broadcast.
    mdns_stop()?;

    let daemon = ServiceDaemon::new().map_err(|e| format!("mdns_init: {e}"))?;

    let host = local_hostname();
    let instance = sanitize_instance(&name.unwrap_or_else(|| host.clone()));

    let mut props: HashMap<String, String> = HashMap::new();
    props.insert("hub".to_string(), hub);
    props.insert("workspace".to_string(), workspace);
    props.insert("kind".to_string(), "companion".to_string());
    props.insert("v".to_string(), env!("CARGO_PKG_VERSION").to_string());

    // 0.0.0.0 = let the daemon enumerate interfaces. Port 0 = informational.
    let info = ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &format!("{host}.local."),
        "0.0.0.0",
        0u16,
        props,
    )
    .map_err(|e| format!("mdns_info: {e}"))?
    .enable_addr_auto();

    let fullname = info.get_fullname().to_string();
    daemon
        .register(info)
        .map_err(|e| format!("mdns_register: {e}"))?;

    *STATE.lock().unwrap() = Some(Beacon { daemon, fullname });
    Ok(())
}

#[tauri::command]
pub fn mdns_stop() -> Result<(), String> {
    let prev = STATE.lock().unwrap().take();
    if let Some(beacon) = prev {
        // Best-effort unregister; if it fails we still drop the daemon.
        let _ = beacon.daemon.unregister(&beacon.fullname);
        // Daemon shuts down on drop.
    }
    Ok(())
}

#[tauri::command]
pub fn mdns_status() -> bool {
    STATE.lock().unwrap().is_some()
}
