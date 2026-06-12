/**
 * SettingsView — workspace identity, window actions, onboarding, and account
 * sign-out. The "danger" sign-out clears the persisted auth and drops back to
 * pairing.
 */
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useEffect, useState } from 'react';
import type { AuthState } from '../../state/auth';
import { ViewHeader } from '../ViewHeader';
import { loadAppearance, saveAppearance } from '../../state/appearance';
import { usePinToTop } from '../../state/usePinToTop';
import { useObserverMuted } from '../../state/useObserverMuted';
import { loadUiLocale, saveUiLocale, useT, type UiLocale } from '../../state/locale';

export function SettingsView({
  auth,
  onSignOut,
  onShowOnboarding,
}: {
  auth: AuthState;
  onSignOut: () => Promise<void>;
  onShowOnboarding: () => void;
}) {
  const t = useT();
  const [appearance, setAppearance] = useState(() => loadAppearance());
  const [uiLocale, setUiLocale] = useState<UiLocale>(() => loadUiLocale());
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const { pinned, toggle: togglePin } = usePinToTop();
  const { muted: observerMuted, toggle: toggleObserver } = useObserverMuted();

  // Server version: tiny public health probe — best-effort.
  useEffect(() => {
    void fetch(`${auth.apiBase.replace(/\/$/, '')}/api/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { version?: string; ok?: boolean } | null) =>
        setServerVersion(j?.version ?? (j?.ok ? 'ok' : null)),
      )
      .catch(() => setServerVersion(null));
  }, [auth.apiBase]);

  return (
    <div className="view">
      <ViewHeader id="settings" />

      <div className="glass-card settings-block">
        <p className="settings-block__label">{t('settings.workspace')}</p>
        <code className="settings-block__value">{auth.workspaceId}</code>
        <a
          className="hero__host"
          href={auth.apiBase}
          target="_blank"
          rel="noreferrer"
          title="Open metu in browser"
        >
          {auth.apiBase.replace(/^https?:\/\//, '')}
        </a>
      </div>

      <div className="glass-card settings-block">
        <p className="settings-block__label">{t('settings.window')}</p>
        <p className="settings-block__label" style={{ marginTop: 2 }}>
          {t('assistant.uiLanguage')}
        </p>
        <div className="settings-actions">
          {(['en', 'ro'] as UiLocale[]).map((l) => (
            <button
              key={l}
              type="button"
              className={`chip ${uiLocale === l ? 'chip--on' : ''}`}
              onClick={() => {
                setUiLocale(l);
                saveUiLocale(l);
              }}
            >
              {l === 'en' ? 'English' : 'Română'}
            </button>
          ))}
        </div>
        <div className="settings-actions">
          <button className="chip" onClick={onShowOnboarding}>
            {t('settings.onboarding')}
          </button>
          <button className="chip" onClick={() => window.location.reload()} title="Reload window">
            {t('settings.reload')}
          </button>
          <button
            className="chip"
            onClick={() => void openExternal(auth.apiBase)}
            title="Open metu web"
          >
            {t('settings.openWeb')}
          </button>
          <button
            type="button"
            className={`chip ${observerMuted ? 'chip--warn' : 'chip--on'}`}
            onClick={toggleObserver}
          >
            {observerMuted ? '🔇 Muted' : '🔊 Live'}
          </button>
          <button type="button" className={`chip ${pinned ? 'chip--on' : ''}`} onClick={togglePin}>
            {pinned ? '★ Pinned' : '☆ Pin'}
          </button>
        </div>
        <label className="slider-row" style={{ marginTop: 10 }}>
          <span>{t('settings.windowOpacity')}</span>
          <input
            type="range"
            min={0.7}
            max={1}
            step={0.05}
            value={appearance.windowOpacity}
            onChange={(e) =>
              setAppearance(saveAppearance({ windowOpacity: Number(e.target.value) }))
            }
          />
          <span className="slider-row__val">{Math.round(appearance.windowOpacity * 100)}%</span>
        </label>
      </div>

      <div className="glass-card settings-block">
        <p className="settings-block__label">{t('settings.account')}</p>
        <button
          className="chip chip--danger"
          onClick={onSignOut}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('settings.signout')}
        </button>
      </div>

      <div className="settings-foot">
        <p className="hint">⌘⇧V voice · ⌘⇧C clipboard · ⌘⇧D diagnostics</p>
        <p className="hint hint--dim">
          {t('settings.appVersion')} v{__APP_VERSION__}
          {serverVersion ? ` · ${t('settings.serverVersion')} ${serverVersion}` : ''}
        </p>
      </div>
    </div>
  );
}
