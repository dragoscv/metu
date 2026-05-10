/* metu popup — capture / recall / notify, settings, signed-in indicator */

const $ = (id) => document.getElementById(id);
const API_URL_DEFAULT = 'https://app.metu.ro';

(async () => {
  const cfg = await chrome.storage.local.get(['apiUrl', 'token']);
  $('apiUrl').value = cfg.apiUrl ?? '';
  // Token is loaded into the input as `password` type; never display it
  // anywhere else in the popup.
  $('token').value = cfg.token ?? '';
  refreshDot();
  await prefillFromSelection();
})();

// Best-effort: if the user opened the popup with text selected on the
// active tab, paste it into the capture textarea. Avoids the friction
// of copy-paste for the most common save-this-quote use case.
async function prefillFromSelection() {
  try {
    const ta = $('content');
    if (!ta || ta.value.trim().length > 0) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;
    // Skip chrome:// / chrome-extension:// where scripting is forbidden.
    if (!/^https?:/i.test(tab.url)) return;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.getSelection ? String(window.getSelection() ?? '') : ''),
    });
    const text = (results?.[0]?.result ?? '').trim();
    if (!text) return;
    ta.value = text;
    const hint = $('prefillHint');
    if (hint) hint.style.display = '';
  } catch {
    // Permission denied on this origin, or tab gone — silent.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const clearBtn = $('prefillClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      $('content').value = '';
      $('prefillHint').style.display = 'none';
      $('content').focus();
    });
  }
});

function refreshDot() {
  chrome.storage.local.get(['token']).then(({ token }) => {
    const dot = $('dot');
    dot.classList.remove('ok', 'err');
    if (token) {
      dot.classList.add('ok');
      dot.title = 'Signed in';
    } else {
      dot.title = 'Not signed in';
    }
  });
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`pane-${btn.dataset.pane}`).classList.add('active');
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────

$('saveCfg').addEventListener('click', async () => {
  const apiUrl = ($('apiUrl').value.trim() || API_URL_DEFAULT).replace(/\/$/, '');
  const token = $('token').value.trim();
  await chrome.storage.local.set({ apiUrl, token });
  $('saveCfg').textContent = 'Saved';
  setTimeout(() => ($('saveCfg').textContent = 'Save'), 1200);
  refreshDot();
});

$('signOut').addEventListener('click', async () => {
  await chrome.storage.local.remove('token');
  $('token').value = '';
  $('signOut').textContent = 'Signed out';
  setTimeout(() => ($('signOut').textContent = 'Sign out'), 1200);
  refreshDot();
});

// ─── Capture ──────────────────────────────────────────────────────────────

$('save').addEventListener('click', async () => {
  const content = $('content').value.trim();
  const status = $('captureStatus');
  status.textContent = '';
  if (!content) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await chrome.runtime.sendMessage({
    type: 'metu.capture',
    payload: {
      kind: 'text',
      content,
      source: 'browser-ext',
      sourceUrl: tab?.url,
      metadata: { url: tab?.url, title: tab?.title },
    },
  });
  if (r?.ok) {
    $('content').value = '';
    $('save').textContent = 'Captured ✓';
    setTimeout(() => ($('save').textContent = 'Capture'), 1200);
  } else {
    status.textContent = r?.error ?? 'Error';
  }
});

// ─── Recall ───────────────────────────────────────────────────────────────

$('recallGo').addEventListener('click', runRecall);
$('recallQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runRecall();
});

async function runRecall() {
  const query = $('recallQuery').value.trim();
  const status = $('recallStatus');
  const hits = $('hits');
  hits.innerHTML = '';
  status.textContent = '';
  if (!query) return;
  status.textContent = 'Searching…';
  const r = await chrome.runtime.sendMessage({
    type: 'metu.recall',
    payload: { query, k: 10 },
  });
  if (!r?.ok) {
    status.textContent = r?.error ?? 'Error';
    return;
  }
  const list = Array.isArray(r.result) ? r.result : [];
  status.textContent = list.length === 0 ? 'No memories matched.' : `${list.length} hits`;
  for (const h of list) {
    const li = document.createElement('li');
    li.className = 'hit';
    const score = Number.isFinite(h.score) ? Math.round(h.score * 100) : null;
    const text = (h.content || '').slice(0, 200);
    li.innerHTML = `<div>${escapeHtml(text)}${
      score !== null ? `<span class="score">${score}%</span>` : ''
    }</div>`;
    li.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(h.content || '');
        li.style.opacity = '0.6';
        status.textContent = 'Copied to clipboard.';
      } catch {
        status.textContent = 'Clipboard write failed.';
      }
    });
    hits.appendChild(li);
  }
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Notify ───────────────────────────────────────────────────────────────

$('notifyGo').addEventListener('click', async () => {
  const title = $('notifyTitle').value.trim();
  const body = $('notifyBody').value.trim();
  const status = $('notifyStatus');
  status.textContent = '';
  if (!title) {
    status.textContent = 'Title is required.';
    return;
  }
  const r = await chrome.runtime.sendMessage({
    type: 'metu.notify',
    payload: { title, body: body || undefined, source: 'browser-ext', urgency: 'normal' },
  });
  if (r?.ok) {
    $('notifyTitle').value = '';
    $('notifyBody').value = '';
    status.textContent = 'Sent.';
  } else {
    status.textContent = r?.error ?? 'Error';
  }
});

// ─── Ask (companion-agent turn) ───────────────────────────────────────────

$('askGo').addEventListener('click', async () => {
  const personaSlug = ($('askPersona').value.trim() || 'metu').toLowerCase();
  const rawUtterance = $('askUtterance').value.trim();
  const includeTab = $('askIncludeTab').checked;
  const status = $('askStatus');
  const reply = $('askReply');
  reply.textContent = '';
  status.textContent = '';
  if (!rawUtterance) {
    status.textContent = 'Type a question first.';
    return;
  }
  let utterance = rawUtterance;
  if (includeTab) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        utterance = `${rawUtterance}\n\n[context: ${tab.title ?? ''} — ${tab.url}]`;
      }
    } catch {
      // Tabs permission may be missing — proceed without context.
    }
  }
  status.textContent = 'Thinking…';
  const r = await chrome.runtime.sendMessage({
    type: 'metu.companionTurn',
    payload: { personaSlug, utterance, surface: 'browser', history: [] },
  });
  if (r?.ok) {
    status.textContent = r.kind === 'local' ? 'Done.' : 'Escalated to conductor.';
    reply.textContent = r.kind === 'local' ? r.text : `${r.ack}\n\n(check metu for the full reply)`;
  } else {
    status.textContent = r?.error ?? 'Error';
  }
});
