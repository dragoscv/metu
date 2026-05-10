//! Accessibility tree — Windows-deep via UI Automation; stub on mac/linux.
//!
//! Companion-Agent slice 1. The Conductor's vision pipeline asks
//! "what is the user looking at?" — answering that requires the structural
//! UI of the active window, not just its title.
//!
//! Design notes
//! -------------
//! * **Windows backend** uses `uiautomation = 0.25` (default features:
//!   `input`, `control`, `pattern`). It walks the focused window with
//!   `get_control_view_walker()` and bounds the recursion at
//!   `max_depth` (default 6) and `max_nodes` (default 500). Both caps are
//!   defensive — a Chrome window can otherwise return thousands of nodes
//!   and blow the WS envelope.
//! * **Other OSes** fall back to a top-level-windows-only response so the
//!   Conductor still gets *something* useful (and so type signatures stay
//!   identical across platforms).
//! * Node ids are best-effort `RuntimeId` strings — stable within one
//!   process lifetime of the target app, which is enough for a Conductor
//!   turn (find → invoke). Across turns, planners re-run `a11y_find`.

use serde::{Deserialize, Serialize};

#[cfg(not(windows))]
use crate::windowing::list_windows;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct A11yArgs {
    pub window_id: Option<String>,
    pub max_depth: Option<u32>,
    pub max_nodes: Option<u32>,
}

#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct A11yBounds {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct A11yNode {
    /// UIA RuntimeId rendered as `"a-b-c-…"`. Empty on non-Windows or
    /// when RuntimeId unavailable.
    pub id: String,
    /// Localized control type ("Button", "Edit", "TabItem", …).
    pub role: String,
    pub name: String,
    pub value: String,
    pub bounds: A11yBounds,
    pub focusable: bool,
    pub enabled: bool,
    pub selected: bool,
    /// Patterns the element supports — useful for the planner to know it
    /// can `invoke` / `set_value` without an extra round trip.
    pub patterns: Vec<String>,
    pub children: Vec<A11yNode>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yTree {
    pub root: Option<A11yNode>,
    pub note: String,
    pub node_count: u32,
    pub truncated: bool,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct A11yFindArgs {
    pub window_id: Option<String>,
    pub role: Option<String>,
    pub name: Option<String>,
    pub name_contains: Option<String>,
    pub value_contains: Option<String>,
    pub max_depth: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yFindResult {
    pub matches: Vec<A11yNode>,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yActionArgs {
    pub window_id: Option<String>,
    pub role: Option<String>,
    pub name: Option<String>,
    pub name_contains: Option<String>,
    /// Required for `set_value`.
    pub value: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yActionResult {
    pub ok: bool,
    pub matched: A11yNode,
}

// ── Windows implementation ────────────────────────────────────────────────

#[cfg(windows)]
mod win {
    use super::*;
    use uiautomation::controls::ControlType;
    use uiautomation::patterns::{UIInvokePattern, UIValuePattern};
    use uiautomation::{UIAutomation, UIElement, UITreeWalker};

    const DEFAULT_MAX_DEPTH: u32 = 6;
    const DEFAULT_MAX_NODES: u32 = 500;
    const DEFAULT_FIND_DEPTH: u32 = 8;
    const DEFAULT_FIND_LIMIT: u32 = 10;
    const HARD_NODE_CEILING: u32 = 5000;

    fn root_element(
        automation: &UIAutomation,
        window_id: Option<&str>,
    ) -> uiautomation::Result<UIElement> {
        if let Some(id) = window_id {
            if let Ok(raw) = id.parse::<isize>() {
                // `uiautomation` bundles its own `windows` crate version; pass
                // the raw HWND as `isize` to dodge the type-version mismatch.
                if let Ok(el) = automation.element_from_handle(raw.into()) {
                    return Ok(el);
                }
            }
        }
        if let Ok(focused) = automation.get_focused_element() {
            let walker = automation.get_control_view_walker()?;
            let mut cur = focused;
            for _ in 0..16 {
                if matches!(cur.get_control_type(), Ok(ControlType::Window)) {
                    return Ok(cur);
                }
                match walker.get_parent(&cur) {
                    Ok(parent) => cur = parent,
                    Err(_) => break,
                }
            }
            return Ok(cur);
        }
        automation.get_root_element()
    }

    fn runtime_id(el: &UIElement) -> String {
        el.get_runtime_id()
            .map(|ids| {
                ids.iter()
                    .map(|n| format!("{:x}", n))
                    .collect::<Vec<_>>()
                    .join("-")
            })
            .unwrap_or_default()
    }

    fn bounds_of(el: &UIElement) -> A11yBounds {
        match el.get_bounding_rectangle() {
            Ok(r) => A11yBounds {
                x: r.get_left(),
                y: r.get_top(),
                w: r.get_width(),
                h: r.get_height(),
            },
            Err(_) => A11yBounds::default(),
        }
    }

    fn role_of(el: &UIElement) -> String {
        el.get_localized_control_type()
            .ok()
            .filter(|s| !s.is_empty())
            .or_else(|| el.get_control_type().ok().map(|c| format!("{:?}", c)))
            .unwrap_or_default()
    }

    fn supported_patterns(el: &UIElement) -> Vec<String> {
        let mut out = Vec::new();
        if el.get_pattern::<UIInvokePattern>().is_ok() {
            out.push("invoke".into());
        }
        if el.get_pattern::<UIValuePattern>().is_ok() {
            out.push("value".into());
        }
        out
    }

    fn snapshot(el: &UIElement) -> A11yNode {
        let value = el
            .get_pattern::<UIValuePattern>()
            .ok()
            .and_then(|p| p.get_value().ok())
            .unwrap_or_default();
        A11yNode {
            id: runtime_id(el),
            role: role_of(el),
            name: el.get_name().unwrap_or_default(),
            value,
            bounds: bounds_of(el),
            focusable: el.is_keyboard_focusable().unwrap_or(false),
            enabled: el.is_enabled().unwrap_or(true),
            selected: false,
            patterns: supported_patterns(el),
            children: Vec::new(),
        }
    }

    fn walk(
        walker: &UITreeWalker,
        el: &UIElement,
        depth: u32,
        max_depth: u32,
        nodes_remaining: &mut u32,
    ) -> A11yNode {
        let mut node = snapshot(el);
        if depth >= max_depth || *nodes_remaining == 0 {
            return node;
        }
        if let Ok(child) = walker.get_first_child(el) {
            let mut current = child;
            loop {
                if *nodes_remaining == 0 {
                    break;
                }
                *nodes_remaining = nodes_remaining.saturating_sub(1);
                let child_node = walk(walker, &current, depth + 1, max_depth, nodes_remaining);
                node.children.push(child_node);
                match walker.get_next_sibling(&current) {
                    Ok(sib) => current = sib,
                    Err(_) => break,
                }
            }
        }
        node
    }

    pub fn read(args: A11yArgs) -> Result<A11yTree, String> {
        let max_depth = args.max_depth.unwrap_or(DEFAULT_MAX_DEPTH).min(16);
        let max_nodes = args
            .max_nodes
            .unwrap_or(DEFAULT_MAX_NODES)
            .min(HARD_NODE_CEILING);

        let automation = UIAutomation::new().map_err(|e| format!("uia_init_failed: {e}"))?;
        let walker = automation
            .get_control_view_walker()
            .map_err(|e| format!("uia_walker_failed: {e}"))?;
        let root = root_element(&automation, args.window_id.as_deref())
            .map_err(|e| format!("uia_root_failed: {e}"))?;

        let mut budget = max_nodes.saturating_sub(1);
        let tree = walk(&walker, &root, 0, max_depth, &mut budget);
        let node_count = max_nodes.saturating_sub(budget);
        Ok(A11yTree {
            root: Some(tree),
            note: format!("uia_v1: max_depth={max_depth} max_nodes={max_nodes}"),
            node_count,
            truncated: budget == 0,
        })
    }

    fn matches_predicate(
        node_role: &str,
        node_name: &str,
        node_value: &str,
        role: Option<&str>,
        name: Option<&str>,
        name_contains: Option<&str>,
        value_contains: Option<&str>,
    ) -> bool {
        if let Some(r) = role {
            if !node_role.eq_ignore_ascii_case(r) {
                return false;
            }
        }
        if let Some(n) = name {
            if node_name != n {
                return false;
            }
        }
        if let Some(nc) = name_contains {
            if !node_name.to_lowercase().contains(&nc.to_lowercase()) {
                return false;
            }
        }
        if let Some(vc) = value_contains {
            if !node_value.to_lowercase().contains(&vc.to_lowercase()) {
                return false;
            }
        }
        true
    }

    fn collect(
        walker: &UITreeWalker,
        el: &UIElement,
        depth: u32,
        max_depth: u32,
        out: &mut Vec<A11yNode>,
        limit: u32,
        role: Option<&str>,
        name: Option<&str>,
        name_contains: Option<&str>,
        value_contains: Option<&str>,
    ) {
        if out.len() as u32 >= limit {
            return;
        }
        let snap = snapshot(el);
        if matches_predicate(
            &snap.role,
            &snap.name,
            &snap.value,
            role,
            name,
            name_contains,
            value_contains,
        ) {
            out.push(snap);
            if out.len() as u32 >= limit {
                return;
            }
        }
        if depth >= max_depth {
            return;
        }
        if let Ok(child) = walker.get_first_child(el) {
            let mut current = child;
            loop {
                collect(
                    walker,
                    &current,
                    depth + 1,
                    max_depth,
                    out,
                    limit,
                    role,
                    name,
                    name_contains,
                    value_contains,
                );
                if out.len() as u32 >= limit {
                    return;
                }
                match walker.get_next_sibling(&current) {
                    Ok(sib) => current = sib,
                    Err(_) => break,
                }
            }
        }
    }

    pub fn find(args: A11yFindArgs) -> Result<A11yFindResult, String> {
        let max_depth = args.max_depth.unwrap_or(DEFAULT_FIND_DEPTH).min(16);
        let limit = args.limit.unwrap_or(DEFAULT_FIND_LIMIT).min(100);

        let automation = UIAutomation::new().map_err(|e| format!("uia_init_failed: {e}"))?;
        let walker = automation
            .get_control_view_walker()
            .map_err(|e| format!("uia_walker_failed: {e}"))?;
        let root = root_element(&automation, args.window_id.as_deref())
            .map_err(|e| format!("uia_root_failed: {e}"))?;

        let mut matches = Vec::with_capacity(limit as usize);
        collect(
            &walker,
            &root,
            0,
            max_depth,
            &mut matches,
            limit,
            args.role.as_deref(),
            args.name.as_deref(),
            args.name_contains.as_deref(),
            args.value_contains.as_deref(),
        );
        let truncated = matches.len() as u32 >= limit;
        Ok(A11yFindResult { matches, truncated })
    }

    fn locate(args: &A11yActionArgs) -> Result<UIElement, String> {
        let automation = UIAutomation::new().map_err(|e| format!("uia_init_failed: {e}"))?;
        let walker = automation
            .get_control_view_walker()
            .map_err(|e| format!("uia_walker_failed: {e}"))?;
        let root = root_element(&automation, args.window_id.as_deref())
            .map_err(|e| format!("uia_root_failed: {e}"))?;

        fn search(
            walker: &UITreeWalker,
            el: &UIElement,
            depth: u32,
            args: &A11yActionArgs,
        ) -> Option<UIElement> {
            let role = role_of(el);
            let name = el.get_name().unwrap_or_default();
            let value = el
                .get_pattern::<UIValuePattern>()
                .ok()
                .and_then(|p| p.get_value().ok())
                .unwrap_or_default();
            if matches_predicate(
                &role,
                &name,
                &value,
                args.role.as_deref(),
                args.name.as_deref(),
                args.name_contains.as_deref(),
                None,
            ) {
                return Some(el.clone());
            }
            if depth >= 16 {
                return None;
            }
            if let Ok(child) = walker.get_first_child(el) {
                let mut current = child;
                loop {
                    if let Some(found) = search(walker, &current, depth + 1, args) {
                        return Some(found);
                    }
                    match walker.get_next_sibling(&current) {
                        Ok(sib) => current = sib,
                        Err(_) => break,
                    }
                }
            }
            None
        }

        search(&walker, &root, 0, args).ok_or_else(|| "no_match".to_string())
    }

    pub fn invoke(args: A11yActionArgs) -> Result<A11yActionResult, String> {
        let el = locate(&args)?;
        let pattern = el
            .get_pattern::<UIInvokePattern>()
            .map_err(|e| format!("invoke_pattern_unavailable: {e}"))?;
        pattern
            .invoke()
            .map_err(|e| format!("invoke_failed: {e}"))?;
        Ok(A11yActionResult {
            ok: true,
            matched: snapshot(&el),
        })
    }

    pub fn set_value(args: A11yActionArgs) -> Result<A11yActionResult, String> {
        let value = args
            .value
            .clone()
            .ok_or_else(|| "missing_value".to_string())?;
        let el = locate(&args)?;
        let pattern = el
            .get_pattern::<UIValuePattern>()
            .map_err(|e| format!("value_pattern_unavailable: {e}"))?;
        pattern
            .set_value(&value)
            .map_err(|e| format!("set_value_failed: {e}"))?;
        Ok(A11yActionResult {
            ok: true,
            matched: snapshot(&el),
        })
    }
}

// ── Public entry points ───────────────────────────────────────────────────

#[cfg(windows)]
pub fn read(args: A11yArgs) -> Result<A11yTree, String> {
    win::read(args)
}

#[cfg(not(windows))]
pub fn read(_args: A11yArgs) -> Result<A11yTree, String> {
    let windows = list_windows()?;
    let children: Vec<A11yNode> = windows
        .into_iter()
        .map(|w| A11yNode {
            id: w.id,
            role: "Window".into(),
            name: format!("{} — {}", w.app, w.title),
            value: String::new(),
            bounds: A11yBounds {
                x: w.bounds.x,
                y: w.bounds.y,
                w: w.bounds.w as i32,
                h: w.bounds.h as i32,
            },
            focusable: !w.minimized,
            enabled: !w.minimized,
            selected: w.focused,
            patterns: Vec::new(),
            children: Vec::new(),
        })
        .collect();
    let count = children.len() as u32;
    Ok(A11yTree {
        root: Some(A11yNode {
            id: "desktop".into(),
            role: "Desktop".into(),
            name: "Desktop".into(),
            value: String::new(),
            bounds: A11yBounds::default(),
            focusable: false,
            enabled: true,
            selected: false,
            patterns: Vec::new(),
            children,
        }),
        note: "stub_a11y_v1: per-OS UIA backend pending".into(),
        node_count: count + 1,
        truncated: false,
    })
}

#[cfg(windows)]
pub fn find(args: A11yFindArgs) -> Result<A11yFindResult, String> {
    win::find(args)
}

#[cfg(not(windows))]
pub fn find(_args: A11yFindArgs) -> Result<A11yFindResult, String> {
    Ok(A11yFindResult {
        matches: Vec::new(),
        truncated: false,
    })
}

#[cfg(windows)]
pub fn invoke(args: A11yActionArgs) -> Result<A11yActionResult, String> {
    win::invoke(args)
}

#[cfg(not(windows))]
pub fn invoke(_args: A11yActionArgs) -> Result<A11yActionResult, String> {
    Err("a11y_invoke_not_implemented_on_this_os".into())
}

#[cfg(windows)]
pub fn set_value(args: A11yActionArgs) -> Result<A11yActionResult, String> {
    win::set_value(args)
}

#[cfg(not(windows))]
pub fn set_value(_args: A11yActionArgs) -> Result<A11yActionResult, String> {
    Err("a11y_set_value_not_implemented_on_this_os".into())
}
