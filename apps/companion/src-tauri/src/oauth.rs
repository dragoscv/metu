//! Loopback OAuth callback listener (RFC 8252 §7.3).
//!
//! The pairing flow is a standard authorization-code + PKCE grant that avoids
//! a custom URI scheme (deep link) entirely:
//!
//!   1. Frontend calls `oauth_loopback_start` → we bind an ephemeral port on
//!      127.0.0.1 and return `http://127.0.0.1:<port>/callback`.
//!   2. Frontend opens the system browser at `/api/oauth/authorize?...&
//!      redirect_uri=<that loopback uri>&code_challenge=...`.
//!   3. After the user signs in (and the trusted companion client is
//!      auto-approved server-side), the browser 302-redirects to the loopback
//!      URI with `?code=…&state=…`. Our one-shot HTTP server captures it.
//!   4. Frontend calls `oauth_loopback_wait` to receive the code, then
//!      exchanges it at `/api/oauth/token` with the PKCE verifier.
//!
//! Only the local process that started the listener can receive the code, so
//! interception by another app (the classic custom-scheme weakness) is not
//! possible.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Hard ceiling on how long a spawned listener thread lives before giving up,
/// even if the frontend never calls `oauth_loopback_wait` (prevents leaks).
const LISTENER_MAX_LIFETIME_SECS: u64 = 600;

#[derive(serde::Serialize, Clone)]
pub struct LoopbackStart {
    pub port: u16,
    pub redirect_uri: String,
}

#[derive(serde::Serialize, Clone)]
pub struct LoopbackResult {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

/// Pending one-shot listeners, keyed by the ephemeral port handed to the
/// frontend. The receiver is removed by `oauth_loopback_wait`.
#[derive(Default)]
pub struct LoopbackState {
    pending: Mutex<HashMap<u16, Receiver<LoopbackResult>>>,
}

#[tauri::command]
pub fn oauth_loopback_start(
    state: tauri::State<'_, LoopbackState>,
) -> Result<LoopbackStart, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr failed: {e}"))?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("nonblocking failed: {e}"))?;

    let (tx, rx) = mpsc::channel::<LoopbackResult>();
    let deadline = Instant::now() + Duration::from_secs(LISTENER_MAX_LIFETIME_SECS);
    std::thread::spawn(move || {
        let result = accept_one(&listener, deadline);
        let _ = tx.send(result);
    });

    state
        .pending
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .insert(port, rx);

    Ok(LoopbackStart {
        port,
        redirect_uri: format!("http://127.0.0.1:{port}/callback"),
    })
}

#[tauri::command]
pub async fn oauth_loopback_wait(
    port: u16,
    timeout_secs: u64,
    state: tauri::State<'_, LoopbackState>,
) -> Result<LoopbackResult, String> {
    let rx = {
        let mut map = state
            .pending
            .lock()
            .map_err(|_| "state poisoned".to_string())?;
        map.remove(&port)
            .ok_or_else(|| "no pending listener for that port".to_string())?
    };
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(
            timeout_secs.clamp(1, LISTENER_MAX_LIFETIME_SECS),
        ))
        .map_err(|_| "timed out waiting for OAuth callback".to_string())
    })
    .await
    .map_err(|e| format!("join_failed: {e}"))?
}

/// Cancel a pending listener (e.g. user closed the pairing screen). Dropping
/// the receiver lets the spawned thread's `tx.send` fail silently; the thread
/// also self-terminates at its deadline.
#[tauri::command]
pub fn oauth_loopback_cancel(port: u16, state: tauri::State<'_, LoopbackState>) {
    if let Ok(mut map) = state.pending.lock() {
        map.remove(&port);
    }
}

// ─── Token exchange (done in Rust to bypass webview CORS) ───────────────────
//
// The OAuth token/userinfo endpoints are not CORS-enabled (they're meant for
// server-to-server / native callers), so a webview `fetch` to them fails with
// "Failed to fetch". Performing the exchange from Rust via reqwest sidesteps
// the browser same-origin policy entirely and keeps the raw code + tokens out
// of the JS layer until they're ready to persist.

use tauri_plugin_http::reqwest;

#[derive(serde::Deserialize)]
struct TokenResp {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(serde::Deserialize)]
struct UserInfoResp {
    sub: String,
    metu_workspace_id: String,
}

#[derive(serde::Serialize)]
pub struct PairedAuth {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub workspace_id: String,
    pub user_id: String,
}

#[tauri::command]
pub async fn oauth_exchange(
    api_base: String,
    code: String,
    verifier: String,
    redirect_uri: String,
    client_id: String,
) -> Result<PairedAuth, String> {
    let base = api_base.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("http client init failed: {e}"))?;

    // ── Token exchange ──
    let token_url = format!("{base}/api/oauth/token");
    let res = client
        .post(&token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", client_id.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    let tok: TokenResp =
        serde_json::from_str(&body).map_err(|e| format!("bad token response: {e} — {body}"))?;
    if !status.is_success() {
        return Err(tok
            .error
            .unwrap_or_else(|| format!("token exchange failed ({status})")));
    }

    // ── Userinfo ──
    let ui_url = format!("{base}/api/oauth/userinfo");
    let ui = client
        .get(&ui_url)
        .bearer_auth(&tok.access_token)
        .send()
        .await
        .map_err(|e| format!("userinfo request failed: {e}"))?;
    let ui_status = ui.status();
    let ui_body = ui.text().await.unwrap_or_default();
    if !ui_status.is_success() {
        return Err(format!("userinfo failed ({ui_status})"));
    }
    let u: UserInfoResp = serde_json::from_str(&ui_body)
        .map_err(|e| format!("bad userinfo response: {e} — {ui_body}"))?;

    Ok(PairedAuth {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_in: tok.expires_in.unwrap_or(3600),
        workspace_id: u.metu_workspace_id,
        user_id: u.sub,
    })
}

/// Refreshed credentials. `refresh_token` may be rotated server-side (the web
/// OAuth provider rotates the refresh family), so callers MUST persist the new
/// value when present and fall back to the old one when absent.
#[derive(serde::Serialize)]
pub struct RefreshedAuth {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

/// Exchange a refresh token for a fresh access token (RFC 6749 §6).
///
/// Runs in Rust (like `oauth_exchange`) so it bypasses the webview's CORS
/// same-origin restriction — the `/api/oauth/token` endpoint sends no
/// `Access-Control-Allow-Origin`, so a webview `fetch` would fail.
#[tauri::command]
pub async fn oauth_refresh(
    api_base: String,
    refresh_token: String,
    client_id: String,
) -> Result<RefreshedAuth, String> {
    let base = api_base.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("http client init failed: {e}"))?;

    let token_url = format!("{base}/api/oauth/token");
    let res = client
        .post(&token_url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("refresh request failed: {e}"))?;
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    let tok: TokenResp =
        serde_json::from_str(&body).map_err(|e| format!("bad refresh response: {e} — {body}"))?;
    if !status.is_success() {
        return Err(tok
            .error
            .unwrap_or_else(|| format!("token refresh failed ({status})")));
    }

    Ok(RefreshedAuth {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_in: tok.expires_in.unwrap_or(3600),
    })
}

fn accept_one(listener: &TcpListener, deadline: Instant) -> LoopbackResult {
    loop {
        if Instant::now() > deadline {
            return LoopbackResult {
                code: None,
                state: None,
                error: Some("listener_timeout".to_string()),
            };
        }
        match listener.accept() {
            Ok((mut stream, _)) => return handle_conn(&mut stream),
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => {
                return LoopbackResult {
                    code: None,
                    state: None,
                    error: Some(format!("accept_failed: {e}")),
                }
            }
        }
    }
}

fn handle_conn(stream: &mut TcpStream) -> LoopbackResult {
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]);
    // First line: "GET /callback?code=...&state=... HTTP/1.1"
    let target = req
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("");

    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut error: Option<String> = None;
    if let Some(q) = target.split('?').nth(1) {
        for pair in q.split('&') {
            let mut it = pair.splitn(2, '=');
            let k = it.next().unwrap_or("");
            let v = it.next().unwrap_or("");
            match k {
                "code" => code = Some(percent_decode(v)),
                "state" => state = Some(percent_decode(v)),
                "error" => error = Some(percent_decode(v)),
                _ => {}
            }
        }
    }
    if code.is_none() && error.is_none() {
        error = Some("missing_code".to_string());
    }

    let ok = error.is_none();
    let body = result_html(ok);
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();

    LoopbackResult { code, state, error }
}

/// Minimal percent-decoder. OAuth codes/state are base64url (URL-safe), but a
/// browser may still encode `+`/`=` padding, so decode defensively.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn result_html(ok: bool) -> String {
    let (title, msg, color) = if ok {
        (
            "You're connected",
            "METU Companion is now paired. You can close this tab and return to the app.",
            "#34d399",
        )
    } else {
        (
            "Pairing failed",
            "Something went wrong. Return to METU Companion and try again.",
            "#fca5a5",
        )
    };
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><title>METU</title>
<style>
  html,body{{height:100%;margin:0}}
  body{{display:flex;align-items:center;justify-content:center;
    font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    background:#0b0b0f;color:#e5e7eb}}
  .card{{max-width:420px;text-align:center;padding:40px 32px;border-radius:16px;
    background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)}}
  .dot{{width:14px;height:14px;border-radius:50%;background:{color};
    display:inline-block;margin-bottom:16px}}
  h1{{font-size:20px;margin:0 0 8px}}
  p{{font-size:14px;color:#9ca3af;margin:0;line-height:1.5}}
</style></head>
<body><div class="card"><span class="dot"></span><h1>{title}</h1><p>{msg}</p></div>
<script>setTimeout(function(){{window.close()}},1500)</script>
</body></html>"#,
        color = color,
        title = title,
        msg = msg
    )
}
