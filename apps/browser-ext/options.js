/**
 * metu browser-ext — options page controller. Fuller settings surface
 * than the action popup (default-kind, hotkey reminder, clear-token).
 */
const $ = (id) => document.getElementById(id);

async function load() {
  const cfg = await chrome.storage.local.get(['apiUrl', 'token', 'defaultKind']);
  $('apiUrl').value = cfg.apiUrl ?? 'https://app.metu.ro';
  $('token').value = cfg.token ?? '';
  $('defaultKind').value = cfg.defaultKind ?? 'note';
}

async function save() {
  const apiUrl = $('apiUrl').value.trim();
  const token = $('token').value.trim();
  const defaultKind = $('defaultKind').value;
  if (!apiUrl) {
    $('status').textContent = 'API URL is required';
    return;
  }
  await chrome.storage.local.set({ apiUrl, token, defaultKind });
  $('status').textContent = 'Saved.';
  setTimeout(() => ($('status').textContent = ''), 1500);
}

async function clearToken() {
  await chrome.storage.local.remove('token');
  $('token').value = '';
  $('status').textContent = 'Token cleared.';
  setTimeout(() => ($('status').textContent = ''), 1500);
}

document.addEventListener('DOMContentLoaded', () => {
  load();
  $('save').addEventListener('click', save);
  $('clear').addEventListener('click', clearToken);
});
