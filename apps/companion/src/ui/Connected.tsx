import { useEffect, useState } from 'react';
import type { AuthState } from '../state/auth';
import type { HubStatus } from '../state/useHubConnection';
import { PresencePanel } from '../forms/Panel';
import { ObservingBadge } from './ObservingBadge';
import { ClipboardRing } from './ClipboardRing';
import { OnboardingWizard, shouldShowOnboarding } from './OnboardingWizard';
import { SensorsPanel } from './SensorsPanel';
import { UpdateBanner } from '../state/useUpdater';
import { VoiceCaptureButton } from './VoiceCaptureButton';
import { AwarenessStrip } from './AwarenessStrip';
import { usePinToTop } from '../state/usePinToTop';
import { useObserverMuted } from '../state/useObserverMuted';
import { open as openExternal } from '@tauri-apps/plugin-shell';

const labels: Record<HubStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Reconnecting…',
  error: 'Error',
};

export function Connected({
  auth,
  status,
  onSignOut,
  onSensorsChange,
}: {
  auth: AuthState;
  status: HubStatus;
  onSignOut: () => Promise<void>;
  onSensorsChange: () => void;
}) {
  const ok = status === 'open';
  const { pinned, toggle: togglePin } = usePinToTop();
  const { muted: observerMuted, toggle: toggleObserver } = useObserverMuted();
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (shouldShowOnboarding(auth.workspaceId)) setShowOnboarding(true);
  }, [auth.workspaceId]);
  return (
    <div className="shell">
      <div className="shell__header">
        <h1 className="title">METU Companion</h1>
        <ObservingBadge auth={auth} />
        <button
          type="button"
          className="btn ghost"
          onClick={toggleObserver}
          title={
            observerMuted
              ? 'Resume sending presence/clipboard events'
              : 'Pause sending presence/clipboard events'
          }
          style={{ marginLeft: 'auto', fontSize: 11 }}
        >
          {observerMuted ? '🔇 Muted' : '🔊 Live'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={togglePin}
          title={pinned ? 'Unpin window from top' : 'Keep window above others'}
          style={{ fontSize: 11 }}
        >
          {pinned ? '★ Pinned' : '☆ Pin'}
        </button>
      </div>
      <UpdateBanner />
      <div className="card">
        <div className="row">
          <div className={`dot${ok ? '' : 'off'}`} />
          <span>{labels[status]}</span>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          <a
            href={auth.apiBase}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'inherit', textDecoration: 'underline' }}
            title="Open metu in browser"
          >
            {auth.apiBase}
          </a>
        </p>
      </div>
      {ok && <PresencePanel auth={auth} />}
      {ok && <VoiceCaptureButton auth={auth} />}
      {ok && <AwarenessStrip />}
      {ok && <ClipboardRing auth={auth} />}
      <SensorsPanel onChange={onSensorsChange} />
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Workspace
        </p>
        <code style={{ fontSize: 11 }}>{auth.workspaceId}</code>
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
        <button className="btn ghost" onClick={() => setShowOnboarding(true)}>
          Show onboarding
        </button>
        <button
          className="btn ghost"
          onClick={() => window.location.reload()}
          title="Reload window"
        >
          Reload
        </button>
        <button
          className="btn ghost"
          onClick={() => void openExternal(auth.apiBase)}
          title="Open metu.app in your browser"
        >
          Open web
        </button>
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      <p
        className="muted"
        style={{
          margin: '6px 0 0',
          fontSize: 10,
          textAlign: 'center',
          opacity: 0.7,
        }}
      >
        ⌘⇧V voice capture · ⌘⇧C clipboard ring
      </p>
      <p
        className="muted"
        style={{
          margin: '2px 0 0',
          fontSize: 10,
          textAlign: 'center',
          opacity: 0.5,
        }}
      >
        v{__APP_VERSION__}
      </p>
      {showOnboarding && <OnboardingWizard auth={auth} onClose={() => setShowOnboarding(false)} />}
    </div>
  );
}
