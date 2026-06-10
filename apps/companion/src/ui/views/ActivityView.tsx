/**
 * ActivityView — live awareness strip + clipboard ring. Surfaces what metu is
 * currently seeing. Requires an open hub connection.
 */
import type { AuthState } from '../../state/auth';
import type { HubStatus } from '../../state/useHubConnection';
import { AwarenessStrip } from '../AwarenessStrip';
import { ClipboardRing } from '../ClipboardRing';
import { ViewHeader } from '../ViewHeader';

export function ActivityView({ auth, status }: { auth: AuthState; status: HubStatus }) {
  const ok = status === 'open';
  return (
    <div className="view">
      <ViewHeader id="activity" />
      {ok ? (
        <>
          <AwarenessStrip />
          <ClipboardRing auth={auth} />
        </>
      ) : (
        <div className="glass-card empty-card">
          <p className="muted" style={{ margin: 0 }}>
            Activity appears once metu is connected to the hub.
          </p>
        </div>
      )}
    </div>
  );
}
