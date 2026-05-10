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
