import type { AuthState } from '../state/auth';
import type { HubStatus } from '../state/useHubConnection';

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
}: {
  auth: AuthState;
  status: HubStatus;
  onSignOut: () => Promise<void>;
}) {
  const ok = status === 'open';
  return (
    <div className="shell">
      <h1 className="title">METU Companion</h1>
      <div className="card">
        <div className="row">
          <div className={`dot${ok ? '' : 'off'}`} />
          <span>{labels[status]}</span>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          {auth.apiBase}
        </p>
      </div>
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Workspace
        </p>
        <code style={{ fontSize: 11 }}>{auth.workspaceId}</code>
      </div>
      <div style={{ marginTop: 'auto' }}>
        <button className="btn ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
