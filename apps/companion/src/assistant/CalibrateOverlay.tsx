/**
 * Foot calibration overlay — answers "why are the feet floating?" visually.
 *
 * Draws two horizontal lines across the assistant window:
 *   • green  = where the physics believes the FLOOR is (window bottom −
 *              measured foot offset − user tune). The character's feet
 *              should sit EXACTLY on this line — and this line should sit
 *              exactly on the taskbar top.
 *   • amber  = the raw measured feet projection (pre-tune), for comparison.
 *
 * The ± buttons nudge a persisted fine-tune offset (logical px) that
 * getFootOffsetPhysical() applies — a one-time visual calibration instead
 * of iterating blind from screenshots.
 */
import { useEffect, useState } from 'react';
import { getFootOffsetLogical, getFootTune, setFootTune } from '../avatar/footAnchor';

export function CalibrateOverlay({ winH, onClose }: { winH: number; onClose: () => void }) {
  const [tune, setTune] = useState(getFootTune());
  const [measured, setMeasured] = useState(getFootOffsetLogical());

  useEffect(() => {
    const t = setInterval(() => setMeasured(getFootOffsetLogical()), 500);
    return () => clearInterval(t);
  }, []);

  const nudge = (d: number) => {
    setFootTune(getFootTune() + d);
    setTune(getFootTune());
    // Re-dock so the window re-positions with the new offset immediately.
    window.dispatchEvent(new Event('metu:assistant-dock'));
  };

  const floorY = winH - (measured + tune);
  const rawY = winH - measured;

  const lineStyle = (y: number, color: string): React.CSSProperties => ({
    position: 'absolute',
    left: 0,
    right: 0,
    top: y,
    height: 0,
    borderTop: `1.5px dashed ${color}`,
    pointerEvents: 'none',
  });

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, pointerEvents: 'none' }}>
      <div style={lineStyle(rawY, 'rgba(251,191,36,0.9)')} />
      <div style={lineStyle(floorY, 'rgba(74,222,128,0.95)')} />
      <div
        className="assistant-panel"
        style={{
          position: 'absolute',
          left: 8,
          top: 8,
          padding: '8px 10px',
          borderRadius: 10,
          background: 'rgba(10,12,18,0.92)',
          border: '1px solid rgba(255,255,255,0.14)',
          color: '#e5e7eb',
          fontSize: 11,
          lineHeight: 1.5,
          pointerEvents: 'auto',
          userSelect: 'none',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Foot calibration</div>
        <div>
          <span style={{ color: 'rgba(251,191,36,0.9)' }}>—</span> measured feet:{' '}
          {measured.toFixed(1)}px
        </div>
        <div>
          <span style={{ color: 'rgba(74,222,128,0.95)' }}>—</span> floor line (tune{' '}
          {tune >= 0 ? '+' : ''}
          {tune}px)
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {[-5, -1, +1, +5].map((d) => (
            <button
              key={d}
              onClick={() => nudge(d)}
              style={{
                padding: '2px 8px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.08)',
                color: '#e5e7eb',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {d > 0 ? `+${d}` : d}
            </button>
          ))}
          <button
            onClick={onClose}
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.08)',
              color: '#e5e7eb',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Done
          </button>
        </div>
        <div style={{ marginTop: 4, opacity: 0.65 }}>
          Green line should sit on the taskbar top. Nudge until feet touch it.
        </div>
      </div>
    </div>
  );
}
