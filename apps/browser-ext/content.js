/* metu content script — surfaces a tiny floating capture button on selection */

let pill;

function ensurePill() {
  if (pill) return pill;
  pill = document.createElement('button');
  pill.type = 'button';
  pill.textContent = '+ metu';
  pill.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'background:oklch(0.71 0.18 290)',
    'color:white',
    'border:0',
    'border-radius:999px',
    'padding:6px 12px',
    'font:600 12px system-ui,-apple-system,Segoe UI,sans-serif',
    'cursor:pointer',
    'box-shadow:0 6px 24px -8px rgba(0,0,0,.3)',
    'display:none',
  ].join(';');
  document.body.appendChild(pill);
  return pill;
}

function show(x, y, text) {
  const el = ensurePill();
  el.style.left = `${Math.max(8, Math.min(window.innerWidth - 80, x))}px`;
  el.style.top = `${Math.max(8, y)}px`;
  el.style.display = 'block';
  el.textContent = '+ metu';
  el.onclick = async () => {
    el.textContent = 'Saving…';
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'metu.capture',
        payload: {
          kind: 'text',
          content: text,
          source: 'browser-ext',
          sourceUrl: location.href,
          metadata: { url: location.href, title: document.title },
        },
      });
    } catch (e) {
      console.warn('[metu] sendMessage failed', e);
    }
    if (resp?.ok) {
      el.textContent = 'Saved ✓';
      setTimeout(() => (el.style.display = 'none'), 900);
    } else {
      el.textContent = 'Error';
      setTimeout(() => (el.style.display = 'none'), 1200);
    }
  };
}

function hide() {
  if (pill) pill.style.display = 'none';
}

document.addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text || text.length < 8) return hide();
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  show(rect.right + 8, Math.max(8, rect.top - 36), text);
});
document.addEventListener('mousedown', (e) => {
  if (pill && e.target === pill) return;
  hide();
});
document.addEventListener('scroll', hide, { passive: true });

/* ── Privacy-gated ambient capture ──────────────────────────────────────────
 * Only fires when chrome.storage.local.ambientCapture === true. Two streams:
 *   - Selection-copy: detect Ctrl/Cmd+C while a selection ≥ 12 chars exists,
 *     ship as a 'copy' event so the Conductor can correlate later pastes.
 *   - Form submit: capture a privacy-safe descriptor (form action URL,
 *     method, field-name list) on submit. Never sends field VALUES.
 * Both auto-skip on <input type=password>, on inputs marked autocomplete=off,
 * and on hosts on the user's blocklist (chrome.storage.local.ambientBlocklist).
 */
let ambientEnabled = false;
let ambientBlocklist = [];
function loadAmbient() {
  try {
    chrome.storage.local.get(['ambientCapture', 'ambientBlocklist'], (out) => {
      ambientEnabled = out?.ambientCapture === true;
      ambientBlocklist = Array.isArray(out?.ambientBlocklist) ? out.ambientBlocklist : [];
    });
  } catch {
    /* extension reload */
  }
}
loadAmbient();
try {
  chrome.storage.onChanged?.addListener(loadAmbient);
} catch {
  /* */
}

function hostBlocked() {
  const h = location.hostname;
  return ambientBlocklist.some((b) => typeof b === 'string' && b && h.includes(b));
}

document.addEventListener(
  'keydown',
  (e) => {
    if (!ambientEnabled || hostBlocked()) return;
    const isCopy = (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C');
    if (!isCopy) return;
    const text = window.getSelection()?.toString().trim();
    if (!text || text.length < 12) return;
    chrome.runtime
      .sendMessage({
        type: 'metu.capture',
        payload: {
          kind: 'event',
          content: text.slice(0, 500),
          source: 'browser-ext.copy',
          sourceUrl: location.href,
          metadata: { url: location.href, title: document.title, len: text.length },
        },
      })
      .catch(() => {});
  },
  { passive: true },
);

document.addEventListener(
  'submit',
  (e) => {
    if (!ambientEnabled || hostBlocked()) return;
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    // Skip forms with any password field.
    const fields = Array.from(form.elements).filter(
      (el) =>
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement,
    );
    if (fields.some((f) => f.type === 'password')) return;
    const fieldNames = fields
      .map((f) => f.name || f.id || null)
      .filter((n) => typeof n === 'string' && n.length > 0)
      .slice(0, 30);
    const action = form.getAttribute('action') || location.pathname;
    chrome.runtime
      .sendMessage({
        type: 'metu.capture',
        payload: {
          kind: 'event',
          content: `Submitted form ${action}`,
          source: 'browser-ext.form-submit',
          sourceUrl: location.href,
          metadata: {
            url: location.href,
            title: document.title,
            method: (form.method || 'get').toLowerCase(),
            action,
            fieldNames,
          },
        },
      })
      .catch(() => {});
  },
  { passive: true, capture: true },
);
