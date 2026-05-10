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
  } catch (e) {
    console.error('[metu] capture failed', e);
    flashBadge('!', '#ef4444');
  }
}

function flashBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
}

// ─── Message bridge from popup + content script ───────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'metu.capture') {
        return sendResponse({ ok: true, result: await sdk.capture(msg.payload) });
      }
      if (msg?.type === 'metu.recall') {
        return sendResponse({ ok: true, result: await sdk.recall(msg.payload) });
      }
      if (msg?.type === 'metu.notify') {
        return sendResponse({ ok: true, result: await sdk.notify(msg.payload) });
      }
      if (msg?.type === 'metu.companionTurn') {
        const result = await sdk.companionTurn(msg.payload);
        return sendResponse({ ok: true, ...result });
      }
      sendResponse({ ok: false, error: 'unknown_message' });
    } catch (e) {
      sendResponse({ ok: false, error: e?.message ?? String(e) });
    }
  })();
  return true; // async
});
