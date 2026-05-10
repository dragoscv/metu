//! Jailed filesystem access for the Conductor.
//!
//! The Conductor never picks the root. The user defines an allowlist of
//! absolute root directories at companion startup via `METU_FS_ROOTS`
//! (OS-pathlist-separated: `;` on Windows, `:` on Unix; commas accepted as
//! a fallback). If the env var is absent or empty, every call is rejected
//! — opt-in by design.
//!
//! Path safety: the requested path is canonicalized (or, for `fs_write`'s
//! `create` mode, its parent is canonicalized) and we verify it sits under
//! one of the canonical roots. Symlinks resolve before the check, so a
//! symlink-out-of-jail attack also fails.
//!
//! Caps: `fs_read` returns at most 256 KiB and refuses non-UTF-8 files
//! (the Conductor reasons over text). `fs_write` accepts at most 1 MiB.
//! Three modes: `overwrite` (default), `append`, `create` (fail-if-exists).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const READ_CAP: usize = 256 * 1024;
const WRITE_CAP: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct FsReadArgs {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct FsWriteArgs {
    pub path: String,
    pub content: String,
    /// "overwrite" | "append" | "create" — defaults to overwrite.
    #[serde(default = "default_mode")]
    pub mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadResult {
    pub path: String,
    pub content: String,
    pub bytes: usize,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteResult {
    pub path: String,
    pub bytes: usize,
    pub mode: String,
}

#[derive(Debug, Serialize)]
pub struct FsRootsResult {
    pub roots: Vec<String>,
}

fn default_mode() -> String {
    "overwrite".into()
}

pub fn read(args: FsReadArgs) -> Result<FsReadResult, String> {
    let roots = read_roots()?;
    let target = canonicalize_existing(&args.path)?;
    ensure_jailed(&target, &roots)?;

    let bytes = fs::read(&target).map_err(|e| format!("read_failed: {e}"))?;
    let truncated = bytes.len() > READ_CAP;
    let slice = if truncated {
        &bytes[..READ_CAP]
    } else {
        &bytes[..]
    };
    let content = std::str::from_utf8(slice)
        .map_err(|_| "non_utf8_content".to_string())?
        .to_string();

    Ok(FsReadResult {
        path: target.to_string_lossy().into_owned(),
        content,
        bytes: bytes.len(),
        truncated,
    })
}

pub fn write(args: FsWriteArgs) -> Result<FsWriteResult, String> {
    let roots = read_roots()?;
    if args.content.len() > WRITE_CAP {
        return Err(format!(
            "content_too_large: {} > {WRITE_CAP}",
            args.content.len()
        ));
    }
    let mode = args.mode.as_str();
    if !matches!(mode, "overwrite" | "append" | "create") {
        return Err(format!("invalid_mode: {mode}"));
    }

    let target_path = PathBuf::from(&args.path);
    if !target_path.is_absolute() {
        return Err("path_must_be_absolute".into());
    }

    // For `create` and `overwrite`, the file may not exist yet — canonicalize
    // the parent and append the basename. For `append`, the file must exist.
    let target = if matches!(mode, "create" | "overwrite") && !target_path.exists() {
        let parent = target_path
            .parent()
            .ok_or_else(|| "path_has_no_parent".to_string())?;
        let canon_parent = canonicalize_existing(parent.to_string_lossy().as_ref())?;
        let basename = target_path
            .file_name()
            .ok_or_else(|| "path_has_no_basename".to_string())?;
        canon_parent.join(basename)
    } else {
        canonicalize_existing(&args.path)?
    };

    ensure_jailed(&target, &roots)?;

    if mode == "create" && target.exists() {
        return Err("file_already_exists".into());
    }

    match mode {
        "overwrite" | "create" => {
            fs::write(&target, args.content.as_bytes())
                .map_err(|e| format!("write_failed: {e}"))?;
        }
        "append" => {
            let mut f = fs::OpenOptions::new()
                .append(true)
                .open(&target)
                .map_err(|e| format!("open_for_append_failed: {e}"))?;
            f.write_all(args.content.as_bytes())
                .map_err(|e| format!("append_failed: {e}"))?;
        }
        _ => unreachable!(),
    }

    Ok(FsWriteResult {
        path: target.to_string_lossy().into_owned(),
        bytes: args.content.len(),
        mode: mode.into(),
    })
}

pub fn list_roots() -> Result<FsRootsResult, String> {
    let roots = read_roots().unwrap_or_default();
    Ok(FsRootsResult {
        roots: roots
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
    })
}

fn read_roots() -> Result<Vec<PathBuf>, String> {
    let raw = std::env::var("METU_FS_ROOTS").unwrap_or_default();
    if raw.trim().is_empty() {
        return Err("fs_roots_empty: set METU_FS_ROOTS to opt in".into());
    }
    // Accept either OS path separator or a comma — easier in .env files.
    let separators: &[char] = &[std::path::MAIN_SEPARATOR, ';', ':', ','];
    // On Windows ':' appears in drive letters (C:\…), so don't split on ':'.
    // We still accept ';' and ','.
    let parts: Vec<&str> = if cfg!(windows) {
        raw.split(|c: char| c == ';' || c == ',').collect()
    } else {
        raw.split(|c: char| c == ':' || c == ';' || c == ',')
            .collect()
    };
    let _ = separators; // silence unused on non-windows
    let mut roots: Vec<PathBuf> = Vec::new();
    for part in parts {
        let s = part.trim();
        if s.is_empty() {
            continue;
        }
        let p = PathBuf::from(s);
        if !p.is_absolute() {
            return Err(format!("fs_root_not_absolute: {s}"));
        }
        let canon = p
            .canonicalize()
            .map_err(|e| format!("fs_root_unreadable: {s} ({e})"))?;
        roots.push(canon);
    }
    if roots.is_empty() {
        return Err("fs_roots_empty: set METU_FS_ROOTS to opt in".into());
    }
    Ok(roots)
}

fn canonicalize_existing(p: &str) -> Result<PathBuf, String> {
    let pb = PathBuf::from(p);
    if !pb.is_absolute() {
        return Err("path_must_be_absolute".into());
    }
    pb.canonicalize()
        .map_err(|e| format!("path_not_found: {p} ({e})"))
}

fn ensure_jailed(target: &Path, roots: &[PathBuf]) -> Result<(), String> {
    for root in roots {
        if target.starts_with(root) {
            return Ok(());
        }
    }
    Err(format!(
        "path_outside_jail: {} not under any of {} root(s)",
        target.to_string_lossy(),
        roots.len()
    ))
}

// ─── tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn with_roots<F: FnOnce()>(roots: &str, f: F) {
        let prev = std::env::var("METU_FS_ROOTS").ok();
        std::env::set_var("METU_FS_ROOTS", roots);
        f();
        match prev {
            Some(v) => std::env::set_var("METU_FS_ROOTS", v),
            None => std::env::remove_var("METU_FS_ROOTS"),
        }
    }

    #[test]
    fn read_rejects_when_no_roots_set() {
        std::env::remove_var("METU_FS_ROOTS");
        let r = read(FsReadArgs {
            path: "/tmp/whatever".into(),
        });
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("fs_roots_empty"));
    }

    #[test]
    fn read_rejects_path_outside_jail() {
        let dir = std::env::temp_dir();
        let canon = dir.canonicalize().unwrap();
        with_roots(canon.to_str().unwrap(), || {
            let outside = if cfg!(windows) {
                "C:\\Windows\\System32\\drivers\\etc\\hosts".to_string()
            } else {
                "/etc/hosts".to_string()
            };
            let r = read(FsReadArgs { path: outside });
            // Either path-not-found or path-outside-jail is acceptable —
            // both refuse the read.
            assert!(r.is_err());
        });
    }

    #[test]
    fn write_then_read_roundtrip() {
        let dir = std::env::temp_dir().join("metu-fs-test");
        let _ = fs::create_dir_all(&dir);
        let canon = dir.canonicalize().unwrap();
        let target = canon.join("hello.txt");
        let _ = fs::remove_file(&target);

        with_roots(canon.to_str().unwrap(), || {
            let w = write(FsWriteArgs {
                path: target.to_string_lossy().into_owned(),
                content: "hello metu".into(),
                mode: "create".into(),
            });
            assert!(w.is_ok(), "write failed: {:?}", w);

            let r = read(FsReadArgs {
                path: target.to_string_lossy().into_owned(),
            });
            let r = r.unwrap();
            assert_eq!(r.content, "hello metu");
            assert_eq!(r.bytes, "hello metu".len());
            assert!(!r.truncated);

            // create on existing should fail
            let w2 = write(FsWriteArgs {
                path: target.to_string_lossy().into_owned(),
                content: "again".into(),
                mode: "create".into(),
            });
            assert!(w2.is_err());

            // overwrite OK
            let w3 = write(FsWriteArgs {
                path: target.to_string_lossy().into_owned(),
                content: "replaced".into(),
                mode: "overwrite".into(),
            });
            assert!(w3.is_ok());

            // append OK
            let w4 = write(FsWriteArgs {
                path: target.to_string_lossy().into_owned(),
                content: " more".into(),
                mode: "append".into(),
            });
            assert!(w4.is_ok());

            let r2 = read(FsReadArgs {
                path: target.to_string_lossy().into_owned(),
            })
            .unwrap();
            assert_eq!(r2.content, "replaced more");
        });

        let _ = fs::remove_file(&target);
    }
}
