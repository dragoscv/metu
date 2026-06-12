/**
 * AssistantView — controls for the floating desktop assistant (visibility +
 * personality). The actual animated character lives in the always-on-top
 * `assistant` window; this is its control surface.
 */
import { useState } from 'react';
import { AssistantControls } from '../AssistantControls';
import { ViewHeader } from '../ViewHeader';
import { PresencePanel } from '../../forms/Panel';
import { VoiceCaptureButton } from '../VoiceCaptureButton';
import type { AuthState } from '../../state/auth';
import {
  loadAssistantLanguage,
  saveAssistantLanguage,
  LANGUAGE_LABELS,
  type AssistantLanguage,
} from '../../state/language';
import { useT } from '../../state/locale';
import {
  loadProactivity,
  saveProactivity,
  type ProactivityMode,
} from '../../assistant/proactivity';
import { loadAppearance, saveAppearance } from '../../state/appearance';

/**
 * AssistantView (Jarvis v9) — the FULL control surface for the desktop
 * assistant: visibility/personality (existing controls), languages
 * (conversation ≠ interface — explicitly independent), proactivity,
 * appearance sliders, and presence/voice (moved from Home).
 */
export function AssistantView({ auth }: { auth: AuthState | null }) {
  const t = useT();
  const [lang, setLang] = useState<AssistantLanguage>(() => loadAssistantLanguage());
  const [proactivity, setProactivity] = useState<ProactivityMode>(() => loadProactivity());
  const [appearance, setAppearance] = useState(() => loadAppearance());

  const pickLang = (l: AssistantLanguage) => {
    setLang(l);
    saveAssistantLanguage(l);
  };
  const pickProactivity = (m: ProactivityMode) => {
    setProactivity(m);
    saveProactivity(m);
  };
  const slide = (key: 'avatarOpacity' | 'glassIntensity', v: number) => {
    setAppearance(saveAppearance({ [key]: v }));
  };

  return (
    <div className="view">
      <ViewHeader id="assistant" />
      <AssistantControls />

      {/* Languages — UI and conversation are independent by design. */}
      <div className="glass-card settings-block">
        <p className="settings-block__label">{t('assistant.language')}</p>
        <div className="settings-actions">
          {(Object.keys(LANGUAGE_LABELS) as AssistantLanguage[]).map((l) => (
            <button
              key={l}
              type="button"
              className={`chip ${lang === l ? 'chip--on' : ''}`}
              onClick={() => pickLang(l)}
            >
              {LANGUAGE_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      {/* Behavior */}
      <div className="glass-card settings-block">
        <p className="settings-block__label">{t('assistant.behavior')}</p>
        <div className="settings-actions">
          {(['silent', 'aware', 'chatty'] as ProactivityMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`chip ${proactivity === m ? 'chip--on' : ''}`}
              onClick={() => pickProactivity(m)}
            >
              {t(`assistant.proactivity.${m}` as 'assistant.proactivity.silent')}
            </button>
          ))}
        </div>
      </div>

      {/* Appearance sliders */}
      <div className="glass-card settings-block">
        <p className="settings-block__label">{t('assistant.appearance')}</p>
        <label className="slider-row">
          <span>{t('assistant.opacity')}</span>
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.05}
            value={appearance.avatarOpacity}
            onChange={(e) => slide('avatarOpacity', Number(e.target.value))}
          />
          <span className="slider-row__val">{Math.round(appearance.avatarOpacity * 100)}%</span>
        </label>
        <label className="slider-row">
          <span>{t('assistant.glass')}</span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={appearance.glassIntensity}
            onChange={(e) => slide('glassIntensity', Number(e.target.value))}
          />
          <span className="slider-row__val">{Math.round(appearance.glassIntensity * 100)}%</span>
        </label>
      </div>

      {/* Presence & voice (moved from Home) */}
      {auth && (
        <div className="glass-card settings-block">
          <p className="settings-block__label">{t('assistant.presence')}</p>
          <PresencePanel auth={auth} />
          <VoiceCaptureButton auth={auth} />
        </div>
      )}

      <div className="glass-card glass-card--mini">
        <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
          Click the assistant to open the chat — it answers with your workspace's AI, can read
          context, and hands bigger jobs to the Conductor. Drag it anywhere; double-click opens
          chat; right-click for the full menu.
        </p>
      </div>
    </div>
  );
}
