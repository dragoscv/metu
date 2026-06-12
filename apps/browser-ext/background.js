/**
 * metu browser extension — background service worker (MV3, ESM).
 *
 * Bridges the browser to the metu SDK at /api/sdk/v1/*:
 *   - chrome.contextMenus → "Capture to metu" on selection / page / link.
 *   - chrome.commands "capture-selection" (default Ctrl+Shift+M).
 *   - chrome.runtime.onMessage → routes 'metu.capture', 'metu.recall',
 *     'metu.notify' from popup + content script.
 *
 * Auth: the access token lives in `chrome.storage.local`. We deliberately
 * avoid `chrome.storage.sync` because it would replicate the bearer to
 * every Chrome profile the user is signed into across machines.
 *
 * Future slices: OAuth device flow, hub WS bridge, autosync of bookmarks.
 */

const API_URL_DEFAULT = 'https://app.metu.ro';

async function getCfg() {
  const stored = await chrome.storage.local.get(['apiUrl', 'token']);
  return {
    apiUrl: (stored.apiUrl || API_URL_DEFAULT).replace(/\/$/, ''),
    token: stored.token || '',
  };
}

async function clearToken() {
  await chrome.storage.local.remove('token');
}

async function api(path, body) {
  const { apiUrl, token } = await getCfg();
  if (!token) throw new Error('No metu token. Open the popup to sign in.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    if (!res.ok) {
      if (res.status === 401) await clearToken();
      const detail =
        (json && typeof json === 'object' && 'error' in json ? String(json.error) : null) ??
        `HTTP ${res.status}`;
      throw new Error(`metu ${path} → ${detail}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const sdk = {
  capture: (input) => api('/api/sdk/v1/capture', input),
  recall: (input) => api('/api/sdk/v1/recall', input),
  notify: (input) => api('/api/sdk/v1/notify', input),
  companionTurn: (input) => api('/api/sdk/v1/companion/turn', input),
  listProjects: () => apiGet('/api/sdk/v1/projects'),
  resume: () => apiGet('/api/sdk/v1/resume'),
};

async function apiGet(path) {
  const { apiUrl, token } = await getCfg();
  if (!token) throw new Error('No metu token. Open the popup to sign in.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      if (res.status === 401) await clearToken();
      throw new Error(`metu ${path} → HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Context menu + keyboard shortcut ─────────────────────────────────────
//
// Menu shape:
//   "Capture to metu"                  ← inbox (default, no projectId)
//   "Capture to metu ▸ Project name"   ← scoped capture, top 8 by momentum
//   "Capture to metu ▸ —"
//   "Capture to metu ▸ Refresh projects"
//
// Project list is fetched on install + on every browser startup + on
// demand via the "Refresh projects" item. Cached in storage.session so
// the service worker can rebuild after suspension without an extra API
// call.

const MENU_ROOT = 'metu-capture';
const MENU_REFRESH = 'metu-capture-refresh';
const MENU_PROJECT_PREFIX = 'metu-capture-project-';
const PROJECT_MENU_LIMIT = 8;

chrome.runtime.onInstalled.addListener(async () => {
  await rebuildContextMenu();
  void refreshProjects();
});

chrome.runtime.onStartup?.addListener(() => {
  void refreshProjects();
});

// Refresh project list when popup writes a new token (sign-in / settings save).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.token || changes.apiUrl) {
    void refreshProjects();
  }
});

async function rebuildContextMenu() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  chrome.contextMenus.create({
    id: MENU_ROOT,
    title: 'Capture to metu',
    contexts: ['selection', 'page', 'link'],
  });

  const { projects = [] } = await chrome.storage.session.get('projects');
  if (projects.length > 0) {
    chrome.contextMenus.create({
      id: `${MENU_ROOT}-inbox`,
      parentId: MENU_ROOT,
      title: 'Inbox (no project)',
      contexts: ['selection', 'page', 'link'],
    });
    chrome.contextMenus.create({
      id: `${MENU_ROOT}-sep1`,
      parentId: MENU_ROOT,
      type: 'separator',
      contexts: ['selection', 'page', 'link'],
    });
    for (const p of projects.slice(0, PROJECT_MENU_LIMIT)) {
      chrome.contextMenus.create({
        id: `${MENU_PROJECT_PREFIX}${p.id}`,
        parentId: MENU_ROOT,
        title: p.name,
        contexts: ['selection', 'page', 'link'],
      });
    }
    chrome.contextMenus.create({
      id: `${MENU_ROOT}-sep2`,
      parentId: MENU_ROOT,
      type: 'separator',
      contexts: ['selection', 'page', 'link'],
    });
  }
  chrome.contextMenus.create({
    id: MENU_REFRESH,
    parentId: projects.length > 0 ? MENU_ROOT : undefined,
    title: projects.length > 0 ? 'Refresh projects' : 'Refresh projects (sign in first)',
    contexts: ['selection', 'page', 'link'],
  });
}

async function refreshProjects() {
  try {
    const projects = await sdk.listProjects();
    await chrome.storage.session.set({ projects });
    await rebuildContextMenu();
  } catch (e) {
    // Silent — menu still works for inbox capture even without project list.
    console.warn('[metu] refreshProjects failed', e?.message ?? e);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  if (id === MENU_REFRESH) {
    await refreshProjects();
    return;
  }
  if (id === MENU_ROOT || id === `${MENU_ROOT}-inbox`) {
    await captureFromTab(info, tab, null);
    return;
  }
  if (id.startsWith(MENU_PROJECT_PREFIX)) {
    const projectId = id.slice(MENU_PROJECT_PREFIX.length);
    await captureFromTab(info, tab, projectId);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  let selection = '';
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString() ?? '',
    });
    selection = result || '';
  } catch (e) {
    console.warn('[metu] selection scripting failed', e);
  }
  await captureFromTab({ selectionText: selection }, tab, null);
});

async function captureFromTab(info, tab, projectId) {
  const content =
    (info.selectionText && info.selectionText.trim()) ||
    info.linkUrl ||
    tab?.title ||
    tab?.url ||
    '';
  if (!content) return;
  const isLink = !info.selectionText && !!info.linkUrl;
  try {
    await sdk.capture({
      kind: isLink ? 'link' : 'text',
      content,
      source: 'browser-ext',
      sourceUrl: tab?.url,
      projectId: projectId || undefined,
      metadata: { url: tab?.url, title: tab?.title, linkUrl: info.linkUrl },
    });
    flashBadge('✓', '#10b981');
    notifyUser('Captured to metu', summarize(content));
  } catch (e) {
    console.error('[metu] capture failed', e);
    flashBadge('!', '#ef4444');
    notifyUser('Capture failed', e?.message ?? String(e), true);
  }
}

function summarize(s) {
  const t = String(s).trim().replace(/\s+/g, ' ');
  return t.length > 120 ? t.slice(0, 117) + '…' : t;
}

function notifyUser(title, message, isError) {
  // chrome.notifications can be missing in some browsers (Firefox MV3
  // shim, certain enterprise policies). Soft-fail.
  try {
    if (!chrome.notifications?.create) return;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message,
      priority: isError ? 1 : 0,
      silent: !isError,
    });
  } catch {
    /* no-op */
  }
}

function flashBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

// ─── Passive observers: downloads + tab groups ────────────────────────────
// Soft-fail when permissions are missing (some browsers, MV3 shims, or
// when the user declines optional perms). Each listener is wrapped so a
// single API throw never crashes the whole service worker.

if (chrome.downloads?.onCreated) {
  chrome.downloads.onCreated.addListener((dl) => {
    if (!dl?.url || dl.url.startsWith('blob:') || dl.url.startsWith('data:')) return;
    sdk
      .capture({
        kind: 'link',
        content: dl.url,
        source: 'browser-ext.download',
        sourceUrl: dl.referrer || dl.url,
        metadata: {
          filename: dl.filename,
          mime: dl.mime,
          totalBytes: dl.totalBytes,
          finalUrl: dl.finalUrl,
        },
      })
      .catch((e) => console.warn('[metu] download capture failed', e));
  });
}

if (chrome.tabGroups?.onUpdated) {
  // Coarse "user reorganized their work" pulse. We only fire when title
  // or color changes (not every tab move) to keep volume low.
  const lastSeen = new Map();
  chrome.tabGroups.onUpdated.addListener((g) => {
    const prev = lastSeen.get(g.id);
    const sig = `${g.title ?? ''}|${g.color ?? ''}|${g.collapsed ?? false}`;
    if (prev === sig) return;
    lastSeen.set(g.id, sig);
    sdk
      .notify({
        title: `Tab group: ${g.title || '(untitled)'}`,
        body: `${g.color ?? ''}${g.collapsed ? ' · collapsed' : ''}`.trim(),
        urgency: 'low',
        source: 'browser-ext.tab-group',
        metadata: { groupId: g.id, color: g.color, collapsed: g.collapsed },
      })
      .catch((e) => console.warn('[metu] tab-group notify failed', e));
  });
}

// ─── Message bridge from popup + content script ───────────────────────────

// Payload guards — content scripts run in untrusted page contexts; a
// compromised page that finds a bug in the content script must not be
// able to relay arbitrary shapes into the SDK. Each handler whitelists
// the fields it forwards instead of passing msg.payload through.
function str(v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function sanitizeCapture(p) {
  if (!p || typeof p !== 'object') return null;
  const content = str(p.content, 100_000);
  if (!content) return null;
  const out = { kind: 'text', content };
  const source = str(p.source, 200);
  const url = str(p.url, 2_048);
  const title = str(p.title, 500);
  if (source) out.source = source;
  if (url) out.url = url;
  if (title) out.title = title;
  return out;
}

function sanitizeRecall(p) {
  if (!p || typeof p !== 'object') return null;
  const query = str(p.query, 2_000);
  if (!query) return null;
  const out = { query };
  if (Number.isInteger(p.limit) && p.limit > 0 && p.limit <= 50) out.limit = p.limit;
  return out;
}

function sanitizeNotify(p) {
  if (!p || typeof p !== 'object') return null;
  const title = str(p.title, 300);
  if (!title) return null;
  const out = { title };
  const body = str(p.body, 2_000);
  if (body) out.body = body;
  if (['low', 'normal', 'high', 'critical'].includes(p.urgency)) out.urgency = p.urgency;
  return out;
}

function sanitizeCompanionTurn(p) {
  if (!p || typeof p !== 'object') return null;
  const text = str(p.text, 8_000);
  if (!text) return null;
  const out = { text };
  const persona = str(p.persona, 100);
  if (persona) out.persona = persona;
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'metu.capture') {
        const payload = sanitizeCapture(msg.payload);
        if (!payload) return sendResponse({ ok: false, error: 'invalid_payload' });
        return sendResponse({ ok: true, result: await sdk.capture(payload) });
      }
      if (msg?.type === 'metu.recall') {
        const payload = sanitizeRecall(msg.payload);
        if (!payload) return sendResponse({ ok: false, error: 'invalid_payload' });
        return sendResponse({ ok: true, result: await sdk.recall(payload) });
      }
      if (msg?.type === 'metu.notify') {
        const payload = sanitizeNotify(msg.payload);
        if (!payload) return sendResponse({ ok: false, error: 'invalid_payload' });
        return sendResponse({ ok: true, result: await sdk.notify(payload) });
      }
      if (msg?.type === 'metu.companionTurn') {
        const payload = sanitizeCompanionTurn(msg.payload);
        if (!payload) return sendResponse({ ok: false, error: 'invalid_payload' });
        const result = await sdk.companionTurn(payload);
        return sendResponse({ ok: true, ...result });
      }
      if (msg?.type === 'metu.resume') {
        return sendResponse({ ok: true, result: await sdk.resume() });
      }
      sendResponse({ ok: false, error: 'unknown_message' });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message ?? String(e) });
    }
  })();
  return true; // async
});

// ─── Ambient page-visit capture ───────────────────────────────────────────
//
// On every tab navigation that completes loading, record a capture so the
// Conductor + projects + focus subsystems see what the user is browsing.
// We never send page content — only URL, title, favicon, hostname.
//
// Privacy posture:
//   - User can disable via `chrome.storage.local.activityEnabled = false`.
//   - URLs matching schemes other than http/https are skipped (chrome://, file://, etc.).
//   - A small in-memory + storage.session dedupe window (30 min per URL)
//     prevents spamming the inbox when the user switches between tabs.
//   - Hosts on PRIVATE_HOSTS (localhost, *.lan, IPv4 RFC1918) are skipped.

const VISIT_DEDUP_MS = 30 * 60_000;
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|.*\.lan|.*\.local)$/i;

async function isActivityEnabled() {
  const { activityEnabled } = await chrome.storage.local.get('activityEnabled');
  // Default ON: the user installed metu to be observed.
  return activityEnabled !== false;
}

function isCapturableUrl(url) {
  if (!url) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (PRIVATE_HOST_RE.test(u.hostname)) return false;
  return true;
}

async function shouldRecordVisit(url) {
  const { recentVisits = {} } = await chrome.storage.session.get('recentVisits');
  const now = Date.now();
  const last = recentVisits[url];
  if (last && now - last < VISIT_DEDUP_MS) return false;
  // Trim entries older than the dedup window.
  for (const k of Object.keys(recentVisits)) {
    if (now - recentVisits[k] > VISIT_DEDUP_MS) delete recentVisits[k];
  }
  recentVisits[url] = now;
  await chrome.storage.session.set({ recentVisits });
  return true;
}

async function recordPageVisit(tab) {
  if (!tab?.url || !isCapturableUrl(tab.url)) return;
  if (!(await isActivityEnabled())) return;
  if (!(await shouldRecordVisit(tab.url))) return;
  const { token } = await getCfg();
  if (!token) return; // not signed in — skip silently
  let host = '';
  try {
    host = new URL(tab.url).hostname;
  } catch {
    /* ignore */
  }
  try {
    await sdk.capture({
      kind: 'link',
      content: tab.title || tab.url,
      source: 'browser-ext',
      sourceUrl: tab.url,
      metadata: {
        kind: 'browser.page.visit',
        url: tab.url,
        title: tab.title,
        host,
        favicon: tab.favIconUrl,
      },
    });
  } catch (e) {
    // Ambient — never surface to the user.
    console.warn('[metu] page-visit capture failed', e?.message ?? e);
  }
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    void recordPageVisit(tab);
  }
});
