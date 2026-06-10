/**
 * Form E — fullscreen transparent overlay. Click-through always; used by the
 * assistant brain to highlight a region of the screen or draw an arrow pointing at
 * an on-screen element. Driven by `metu:overlay` window events carrying a
 * physical-pixel rect; the window itself is positioned to cover the whole
 * virtual desktop by the brain via the `presence_overlay_show` command.
 *
 * Coordinates arrive in PHYSICAL px relative to the virtual desktop origin.
 * Since this window is maximized on the primary monitor, we translate by the
 * window's own outer position to draw at the right spot.
 */
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { OVERLAY_EVENT, type HighlightRect } from '../assistant/overlay-bridge';

export function PresenceOverlay() {
  const [rect, setRect] = useState<HighlightRect | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number; scale: number }>({
    x: 0,
    y: 0,
    scale: 1,
  });

  useEffect(() => {
    const w = getCurrentWindow();
    void (async () => {
      const [pos, sf] = await Promise.all([
        w.outerPosition().catch(() => null),
        w.scaleFactor().catch(() => 1),
      ]);
      setOrigin({ x: pos?.x ?? 0, y: pos?.y ?? 0, scale: sf });
    })();

    let unlisten: (() => void) | undefined;
    void listen<HighlightRect | null>(OVERLAY_EVENT, (event) => {
      setRect(event.payload ?? null);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  if (!rect) return <div className="overlay-stage" />;

  // Convert physical desktop coords → CSS px within this window.
  const left = (rect.x - origin.x) / origin.scale;
  const top = (rect.y - origin.y) / origin.scale;
  const width = rect.w / origin.scale;
  const height = rect.h / origin.scale;

  return (
    <div className="overlay-stage">
      <div className="overlay-highlight" style={{ left, top, width, height }} aria-hidden>
        {rect.label && <span className="overlay-label">{rect.label}</span>}
      </div>
    </div>
  );
}
