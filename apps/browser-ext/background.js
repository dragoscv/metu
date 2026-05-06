/* metu browser extension — background service worker */

const API_URL_DEFAULT = 'https://app.metu.ro';

async function getCfg() {
  const { apiUrl, token } = await chrome.storage.sync.get(['apiUrl', 'token']);
  return { apiUrl: apiUrl || API_URL_DEFAULT, token: token || '' };
}

async function postCapture(payload) {
  const { apiUrl, token } = await getCfg();
  if (!token) throw new Error('No metu token. Open the popup to sign in.');
  const r = await fetch(`${apiUrl}/api/captures`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`metu ${r.status}`);
  return r.json();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'metu-capture',
    title: 'Capture to metu',
    contexts: ['selection', 'page', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'metu-capture') return;
  await postCapture({
    kind: 'text',
    content: info.selectionText || info.linkUrl || tab?.title || '',
    source: 'browser-ext',
    metadata: { url: tab?.url, title: tab?.title },
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-selection') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.getSelection()?.toString() ?? '',
  });
  if (!result) return;
  await postCapture({
    kind: 'text',
    content: result,
    source: 'browser-ext',
    metadata: { url: tab.url, title: tab.title },
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'metu.capture') {
    postCapture(msg.payload).then(
      (r) => sendResponse({ ok: true, r }),
      (e) => sendResponse({ ok: false, error: e.message }),
    );
    return true; // async
  }
});
