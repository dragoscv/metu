/**
 * AssistantControls — main-window controls for the floating desktop
 * assistant. The real animated character lives in the always-on-top
 * `assistant` window; here the user toggles its visibility and picks its
 * personality. Avatar appearance is chosen in the Avatar view.
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  loadPersonality,
  PERSONALITIES,
  savePersonality,
  type PersonalityId,
} from '../avatar/personality';

const VISIBLE_KEY = 'metu.companion.assistantVisible';
/** Pre-rename key — migrated on first read. */
const LEGACY_VISIBLE_KEY = 'metu.companion.petVisible';

function loadVisible(): boolean {
  try {
    const v = localStorage.getItem(VISIBLE_KEY) ?? localStorage.getItem(LEGACY_VISIBLE_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

export function AssistantControls() {
  const [visible, setVisible] = useState<boolean>(loadVisible);
  const [personality, setPersonality] = useState<PersonalityId>(() => loadPersonality());

  // Reflect persisted state to the actual window on mount.
  useEffect(() => {
    void invoke(visible ? 'presence_assistant_show' : 'presence_assistant_hide').catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleVisible = () => {
    const next = !visible;
    setVisible(next);
    try {
      localStorage.setItem(VISIBLE_KEY, next ? '1' : '0');
      localStorage.removeItem(LEGACY_VISIBLE_KEY);
    } catch {
      /* ignore */
    }
    void invoke(next ? 'presence_assistant_show' : 'presence_assistant_hide').catch(() => {});
  };

  const choose = (id: PersonalityId) => {
    setPersonality(id);
    savePersonality(id);
  };

  return (
    <div className="glass-card glass-card--mini assistant-controls">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>
          Desktop assistant
        </p>
        <button
          type="button"
          className={`chip ${visible ? 'chip--on' : ''}`}
          onClick={toggleVisible}
        >
          {visible ? '👁 Showing' : '✨ Show assistant'}
        </button>
      </div>
      <div className="assistant-controls__personas">
        {Object.values(PERSONALITIES).map((p) => (
          <button
            key={p.id}
            type="button"
            className={`persona-pick ${personality === p.id ? 'persona-pick--active' : ''}`}
            onClick={() => choose(p.id)}
            title={p.description}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
