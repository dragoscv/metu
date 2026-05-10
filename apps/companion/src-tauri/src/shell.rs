//! Allowlisted shell execution.
//!
//! The Conductor never picks the executable. The user defines an allowlist
//! of binary basenames (no path, no shell metacharacters) at companion
//! startup via `METU_SHELL_ALLOWLIST` (comma-separated, e.g.
//! `git,docker,pnpm,npm`). If the env var is absent or empty, every call is
//! rejected — opt-in by design. Args are passed verbatim to `Command::args`,
//! never expanded by a shell, so `&&`, `;`, redirects, etc. cannot inject.
//!
//! Output is capped at 64 KB stdout + 16 KB stderr to keep WS envelopes
//! sane; longer output is truncated with a `[truncated]` suffix.

use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;

const STDOUT_CAP: usize = 64 * 1024;
const STDERR_CAP: usize = 16 * 1024;
const MAX_ARGS: usize = 32;
const TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Deserialize)]
pub struct ShellExecArgs {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellExecResult {
    pub command: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated_stdout: bool,
    pub truncated_stderr: bool,
}

pub fn exec(args: ShellExecArgs) -> Result<ShellExecResult, String> {
    let allowlist = read_allowlist();
    if allowlist.is_empty() {
        return Err("shell_allowlist_empty: set METU_SHELL_ALLOWLIST to opt in".into());
    }
    let cmd = args.command.trim();
    if cmd.is_empty() {
        return Err("command_empty".into());
    }
    // No path separators, no shell metacharacters — basename only.
    if cmd.contains([
        '/', '\\', ' ', '\t', ';', '&', '|', '<', '>', '`', '$', '"', '\'',
    ]) {
        return Err(format!("command_not_basename: {cmd}"));
    }
    if !allowlist.iter().any(|a| a == cmd) {
        return Err(format!("command_not_allowlisted: {cmd}"));
    }
    if args.args.len() > MAX_ARGS {
        return Err(format!("too_many_args: {} > {MAX_ARGS}", args.args.len()));
    }

    // Spawn — Command runs the binary directly, no shell expansion.
    let mut child = Command::new(cmd)
        .args(&args.args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn_failed: {e}"))?;

    // Crude timeout: poll wait_timeout via wait + thread; std doesn't have
    // wait_timeout. We approximate by sleeping in a loop with try_wait.
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if started.elapsed() > TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("timeout_after_{}_sec", TIMEOUT.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("wait_failed: {e}")),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("collect_failed: {e}"))?;
    let (out, out_trunc) = cap_string(&output.stdout, STDOUT_CAP);
    let (err, err_trunc) = cap_string(&output.stderr, STDERR_CAP);

    Ok(ShellExecResult {
        command: cmd.into(),
        exit_code: output.status.code(),
        stdout: out,
        stderr: err,
        truncated_stdout: out_trunc,
        truncated_stderr: err_trunc,
    })
}

fn read_allowlist() -> Vec<String> {
    std::env::var("METU_SHELL_ALLOWLIST")
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn cap_string(bytes: &[u8], cap: usize) -> (String, bool) {
    if bytes.len() <= cap {
        (String::from_utf8_lossy(bytes).into_owned(), false)
    } else {
        let mut s = String::from_utf8_lossy(&bytes[..cap]).into_owned();
        s.push_str("\n[truncated]");
        (s, true)
    }
}
