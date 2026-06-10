/**
 * PetControls — main-window controls for the detached desktop pet. The real
 * animated character lives in the always-on-top `pet` window; here the user
 * only toggles its visibility and picks its personality. Avatar appearance is
 * chosen in the Avatar view.
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  loadPersonality,
  PERSONALITIES,
  savePersonality,
  type PersonalityId,
} from '../avatar/personality';

const PET_VISIBLE_KEY = 'metu.companion.petVisible';

export function PetControls() {
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PET_VISIBLE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [personality, setPersonality] = useState<PersonalityId>(() => loadPersonality());

  // Reflect persisted state to the actual window on mount.
  useEffect(() => {
    void invoke(visible ? 'presence_pet_show' : 'presence_pet_hide').catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleVisible = () => {
    const next = !visible;
    setVisible(next);
    try {
      localStorage.setItem(PET_VISIBLE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    void invoke(next ? 'presence_pet_show' : 'presence_pet_hide').catch(() => {});
  };

  const choose = (id: PersonalityId) => {
    setPersonality(id);
    savePersonality(id);
  };

  return (
    <div className="glass-card glass-card--mini pet-controls">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>
          Desktop pet
        </p>
        <button
          type="button"
          className={`chip ${visible ? 'chip--on' : ''}`}
          onClick={toggleVisible}
        >
          {visible ? '👁 Showing' : '🐾 Show pet'}
        </button>
      </div>
      <div className="pet-controls__personas">
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
