/**
 * SettingsView — workspace identity, window actions, onboarding, and account
 * sign-out. The "danger" sign-out clears the persisted auth and drops back to
 * pairing.
 */
import { open as openExternal } from '@tauri-apps/plugin-shell';
import type { AuthState } from '../../state/auth';
import { ViewHeader } from '../ViewHeader';

export function SettingsView({
  auth,
  onSignOut,
  onShowOnboarding,
}: {
  auth: AuthState;
  onSignOut: () => Promise<void>;
  onShowOnboarding: () => void;
}) {
  return (
    <div className="view">
      <ViewHeader id="settings" />

      <div className="glass-card settings-block">
        <p className="settings-block__label">Workspace</p>
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
        <p className="settings-block__label">Window & app</p>
        <div className="settings-actions">
          <button className="chip" onClick={onShowOnboarding}>
            Onboarding
          </button>
          <button className="chip" onClick={() => window.location.reload()} title="Reload window">
            Reload
          </button>
          <button
            className="chip"
            onClick={() => void openExternal(auth.apiBase)}
            title="Open metu web"
          >
            Open web
          </button>
        </div>
      </div>

      <div className="glass-card settings-block">
        <p className="settings-block__label">Account</p>
        <button
          className="chip chip--danger"
          onClick={onSignOut}
          style={{ alignSelf: 'flex-start' }}
        >
          Sign out
        </button>
      </div>

      <div className="settings-foot">
        <p className="hint">⌘⇧V voice · ⌘⇧C clipboard · ⌘⇧D diagnostics</p>
        <p className="hint hint--dim">v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}
