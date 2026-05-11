import { useEffect, useState } from 'react';
import type { AuthState } from '../state/auth';
import type { HubStatus } from '../state/useHubConnection';
import { PresencePanel } from '../forms/Panel';
import { ObservingBadge } from './ObservingBadge';
import { ClipboardRing } from './ClipboardRing';
import { OnboardingWizard, shouldShowOnboarding } from './OnboardingWizard';
import { SensorsPanel } from './SensorsPanel';
import { UpdateBanner } from '../state/useUpdater';

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
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (shouldShowOnboarding(auth.workspaceId)) setShowOnboarding(true);
  }, [auth.workspaceId]);
  return (
    <div className="shell">
      <div className="shell__header">
        <h1 className="title">METU Companion</h1>
        <ObservingBadge auth={auth} />
      </div>
      <UpdateBanner />
      <div className="card">
        <div className="row">
          <div className={`dot${ok ? '' : 'off'}`} />
          <span>{labels[status]}</span>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          {auth.apiBase}
        </p>
      </div>
      {ok && <PresencePanel auth={auth} />}
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
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
      {showOnboarding && <OnboardingWizard auth={auth} onClose={() => setShowOnboarding(false)} />}
    </div>
  );
}
