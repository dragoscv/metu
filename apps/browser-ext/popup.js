const $ = (id) => document.getElementById(id);

(async () => {
  const cfg = await chrome.storage.sync.get(['apiUrl', 'token']);
  $('apiUrl').value = cfg.apiUrl ?? '';
  $('token').value = cfg.token ?? '';
})();

$('saveCfg').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    apiUrl: $('apiUrl').value.trim() || 'https://app.metu.ro',
    token: $('token').value.trim(),
  });
  $('saveCfg').textContent = 'Saved';
  setTimeout(() => ($('saveCfg').textContent = 'Save config'), 1200);
});

$('save').addEventListener('click', async () => {
  const content = $('content').value.trim();
  if (!content) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await chrome.runtime.sendMessage({
    type: 'metu.capture',
    payload: {
      kind: 'text',
      content,
      source: 'browser-ext',
      metadata: { url: tab?.url, title: tab?.title },
    },
  });
  if (r?.ok) {
    $('content').value = '';
    $('save').textContent = 'Captured ✓';
    setTimeout(() => ($('save').textContent = 'Capture'), 1200);
  } else {
    $('save').textContent = r?.error ?? 'Error';
  }
});
