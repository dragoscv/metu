/* metu content script — surfaces a tiny floating capture button on selection */
let pill;
function show(x, y, text) {
  if (!pill) {
    pill = document.createElement('button');
    pill.textContent = '+ metu';
    pill.style.cssText =
      'position:fixed;z-index:2147483647;background:oklch(0.71 0.18 290);color:white;border:0;border-radius:999px;padding:6px 12px;font:600 12px system-ui;cursor:pointer;box-shadow:0 6px 24px -8px rgba(0,0,0,.3)';
    document.body.appendChild(pill);
  }
  pill.style.left = `${x}px`;
  pill.style.top = `${y}px`;
  pill.style.display = 'block';
  pill.onclick = () => {
    chrome.runtime.sendMessage({
      type: 'metu.capture',
      payload: {
        kind: 'text',
        content: text,
        source: 'browser-ext',
        metadata: { url: location.href, title: document.title },
      },
    });
    pill.style.display = 'none';
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
  show(rect.right + 8, rect.top - 8, text);
});
document.addEventListener('mousedown', hide);
