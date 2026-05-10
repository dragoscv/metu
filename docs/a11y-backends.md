# A11y backends — Linux (AT-SPI) & macOS (AXUIElement)

The Windows backend in [`a11y.rs`](../apps/companion/src-tauri/src/a11y.rs)
ships today via the `uiautomation` crate. The Linux + macOS slots fall back
to `windowing::list_windows()` so the Conductor still gets _something_. This
doc captures the exact integration plan for the two OS backends so a
developer with a Linux or macOS box can finish each one in ~30 minutes.

> **Why this isn't shipped yet:** primary dev environment is Windows. Rust
> for the unfinished platforms requires either the host OS or a fully
> configured sysroot to validate. Shipping unverified `unsafe`/FFI code
> against `atspi` or `objc2` is worse than the current honest fallback.

---

## Linux — AT-SPI 2 via the `atspi` crate

### Add to `apps/companion/src-tauri/Cargo.toml`

```toml
[target.'cfg(target_os = "linux")'.dependencies]
atspi = { version = "0.22", features = ["proxies-tokio"] }
zbus = "4"
tokio = { version = "1", features = ["rt", "sync"] }
```

### Replace the `cfg(not(windows))` fallbacks in `a11y.rs`

Add a sibling module gated on Linux:

```rust
#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use atspi::proxy::accessible::AccessibleProxy;
    use atspi::AccessibilityConnection;

    pub fn read(args: A11yArgs) -> Result<A11yTree, String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        rt.block_on(async {
            let conn = AccessibilityConnection::new().await.map_err(|e| e.to_string())?;
            let registry = conn.root_accessible_to_accessible().await.map_err(|e| e.to_string())?;
            // Find focused window: walk apps → top windows → focused.
            // Bound recursion via args.max_depth (default 6) and
            // args.max_nodes (default 500). Mirror the Windows truncation
            // semantics — set `truncated = true` when caps hit.
            // ... (walk children, build A11yNode tree)
            Ok(A11yTree::default())
        })
    }

    pub fn find(_args: A11yFindArgs) -> Result<A11yFindResult, String> {
        // Walk the tree from `read` then filter by role/name predicates.
        Ok(A11yFindResult { matches: vec![], truncated: false })
    }

    pub fn invoke(_args: A11yActionArgs) -> Result<A11yActionResult, String> {
        // AT-SPI: `org.a11y.atspi.Action` interface, `DoAction(0)`.
        Err("a11y_invoke_linux_todo".into())
    }

    pub fn set_value(_args: A11yActionArgs) -> Result<A11yActionResult, String> {
        // AT-SPI: `org.a11y.atspi.EditableText.SetTextContents`.
        Err("a11y_set_value_linux_todo".into())
    }
}
```

Then change each top-level dispatcher (currently `#[cfg(not(windows))]`) to:

```rust
#[cfg(target_os = "linux")]
pub fn read(args: A11yArgs) -> Result<A11yTree, String> { linux::read(args) }

#[cfg(not(any(windows, target_os = "linux")))]
pub fn read(_args: A11yArgs) -> Result<A11yTree, String> { /* current fallback */ }
```

### Runtime requirements

- AT-SPI bus must be running. On GNOME this is automatic; on KDE/sway it
  may need `at-spi-bus-launcher` service active.
- Target apps must export accessibility (most GTK4/Qt6 apps do).
- Headless/wayland-only sessions: AT-SPI still works over D-Bus.

### Test plan (on a Linux box)

```bash
sudo apt install at-spi2-core libatspi2.0-dev
cd apps/companion/src-tauri
cargo check --target x86_64-unknown-linux-gnu
cargo test --target x86_64-unknown-linux-gnu --lib a11y
```

---

## macOS — AXUIElement via `objc2`

### Add to `apps/companion/src-tauri/Cargo.toml`

```toml
[target.'cfg(target_os = "macos")'.dependencies]
objc2 = "0.5"
objc2-foundation = "0.2"
core-foundation = "0.10"
accessibility-sys = "0.1"
```

### Critical: app must be granted Accessibility permission

The macOS implementation requires the user to add the companion to
**System Settings → Privacy & Security → Accessibility**. Without that
grant, every `AXUIElementCopyAttributeValue` call returns
`kAXErrorAPIDisabled`. Surface this clearly in the UI.

### Module shape (in `a11y.rs`)

```rust
#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use accessibility_sys::*;
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;

    pub fn read(args: A11yArgs) -> Result<A11yTree, String> {
        unsafe {
            let system = AXUIElementCreateSystemWide();
            let mut focused: *mut std::ffi::c_void = std::ptr::null_mut();
            let attr = CFString::new("AXFocusedUIElement");
            let err = AXUIElementCopyAttributeValue(
                system,
                attr.as_concrete_TypeRef(),
                &mut focused,
            );
            if err == kAXErrorAPIDisabled {
                return Err("a11y_macos_permission_required".into());
            }
            if err != kAXErrorSuccess || focused.is_null() {
                return Err(format!("a11y_macos_no_focus (err={err})"));
            }
            // Walk via AXChildren / AXTitle / AXValue / AXRole, etc.
            // Bound by args.max_depth/max_nodes.
            // Convert each AXUIElement to A11yNode.
            let _ = args;
            Ok(A11yTree::default())
        }
    }

    pub fn find(_args: A11yFindArgs) -> Result<A11yFindResult, String> {
        Ok(A11yFindResult { matches: vec![], truncated: false })
    }

    pub fn invoke(_args: A11yActionArgs) -> Result<A11yActionResult, String> {
        // AXPress action: AXUIElementPerformAction(elem, "AXPress").
        Err("a11y_invoke_macos_todo".into())
    }

    pub fn set_value(_args: A11yActionArgs) -> Result<A11yActionResult, String> {
        // AXUIElementSetAttributeValue(elem, "AXValue", CFString::new(value)).
        Err("a11y_set_value_macos_todo".into())
    }
}
```

Update top-level dispatchers exactly like the Linux pattern above, with
`#[cfg(target_os = "macos")]` arms before the catch-all fallback.

### Bundle entitlement

Add to `apps/companion/src-tauri/tauri.conf.json` macOS entitlements:

```jsonc
{
  "bundle": {
    "macOS": {
      "entitlements": "./entitlements.plist",
    },
  },
}
```

…and create `entitlements.plist` with `com.apple.security.automation.apple-events`
plus a request prompt on first run via `AXIsProcessTrustedWithOptions`.

### Test plan (on a Mac)

```bash
cargo check --target aarch64-apple-darwin
# Manual: grant Accessibility permission, then run companion and call
# the a11y.read tool from the Conductor UI.
```

---

## Why these aren't auto-shipped

Both backends touch `unsafe` FFI surfaces (CFString lifetimes on macOS,
zbus async runtime semantics on Linux) where a single misplaced `&` causes
runtime panics rather than compile errors. Without runtime validation
on the target OS the code-by-pattern-match approach used for the rest of
the codebase is unreliable here.

When you have access to either OS, copy the relevant module above into
[`a11y.rs`](../apps/companion/src-tauri/src/a11y.rs) above the existing
`#[cfg(not(windows))]` fallbacks, fill in the body of `read` (~50 LoC each),
then unblock `find`/`invoke`/`set_value` one tool at a time.
