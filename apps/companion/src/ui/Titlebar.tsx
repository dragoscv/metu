/**
 * Custom frameless titlebar.
 *
 * The native window has `decorations: false`, so this provides the drag region
 * and window controls. Dragging is delegated to Rust (`win_start_drag`) which
 * calls the platform's `start_dragging`. Minimize hides to a small footprint;
 * close hides to tray (so the companion keeps observing in the background).
 */
import { invoke } from '@tauri-apps/api/core';

export function Titlebar({
  title = 'metu',
  onOpenDebug,
}: {
  title?: string;
  onOpenDebug?: () => void;
}) {
  const startDrag = (e: React.PointerEvent) => {
    // Ignore drags that start on a control button.
    if ((e.target as HTMLElement).closest('.tb-btn')) return;
    invoke('win_start_drag').catch(() => {});
  };

  return (
    <div className="titlebar" onPointerDown={startDrag}>
      <div className="titlebar__brand">
        <span className="titlebar__spark" aria-hidden />
        <span className="titlebar__name">{title}</span>
      </div>
      <div className="titlebar__controls">
        {onOpenDebug ? (
          <button
            className="tb-btn"
            title="Diagnostics (Ctrl+Shift+D)"
            onClick={onOpenDebug}
            aria-label="Diagnostics"
          >
            ⚙
          </button>
        ) : null}
        <button
          className="tb-btn"
          title="Minimize"
          onClick={() => invoke('win_minimize').catch(() => {})}
          aria-label="Minimize"
        >
          –
        </button>
        <button
          className="tb-btn tb-btn--close"
          title="Hide to tray"
          onClick={() => invoke('win_hide').catch(() => {})}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
