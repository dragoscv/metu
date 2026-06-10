/**
 * HomeView — the landing pane. Shows the live connection hero, quick toggles
 * (observe mute / pin-to-top), the presence panel, and the voice capture
 * button. This is the "at a glance" surface.
 */
import { useMemo } from 'react';
import type { AuthState } from '../../state/auth';
import type { HubStatus } from '../../state/useHubConnection';
import { AvatarHost } from '../../avatar/AvatarHost';
import type { AvatarState } from '../../avatar/types';
import { PresencePanel } from '../../forms/Panel';
import { VoiceCaptureButton } from '../VoiceCaptureButton';
import { ObservingBadge } from '../ObservingBadge';
import { UpdateBanner } from '../../state/useUpdater';
import { usePinToTop } from '../../state/usePinToTop';
import { useObserverMuted } from '../../state/useObserverMuted';

const labels: Record<HubStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Reconnecting…',
  error: 'Error',
};

export function HomeView({ auth, status }: { auth: AuthState; status: HubStatus }) {
  const ok = status === 'open';
  const { pinned, toggle: togglePin } = usePinToTop();
  const { muted: observerMuted, toggle: toggleObserver } = useObserverMuted();

  const avatarState: AvatarState = useMemo(
    () => (status === 'connecting' || status === 'closed' ? 'thinking' : 'idle'),
    [status],
  );

  return (
    <div className="view view--home">
      <div className="home-hero">
        <div className="home-hero__orb">
          <AvatarHost state={avatarState} size={120} />
        </div>
        <div className="home-hero__meta">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className={`status-pill status-pill--${ok ? 'on' : 'off'}`}>
              <span className="status-pill__dot" />
              {labels[status]}
            </span>
            <ObservingBadge auth={auth} />
          </div>
          <a
            className="hero__host"
            href={auth.apiBase}
            target="_blank"
            rel="noreferrer"
            title="Open metu in browser"
          >
            {auth.apiBase.replace(/^https?:\/\//, '')}
          </a>
          <div className="quick-row">
            <button
              type="button"
              className={`chip ${observerMuted ? 'chip--warn' : 'chip--on'}`}
              onClick={toggleObserver}
              title={
                observerMuted
                  ? 'Resume presence/clipboard events'
                  : 'Pause presence/clipboard events'
              }
            >
              {observerMuted ? '🔇 Muted' : '🔊 Live'}
            </button>
            <button
              type="button"
              className={`chip ${pinned ? 'chip--on' : ''}`}
              onClick={togglePin}
              title={pinned ? 'Unpin from top' : 'Keep above others'}
            >
              {pinned ? '★ Pinned' : '☆ Pin'}
            </button>
          </div>
        </div>
      </div>

      <UpdateBanner />

      {ok ? (
        <div className="home-grid">
          <PresencePanel auth={auth} />
          <VoiceCaptureButton auth={auth} />
        </div>
      ) : (
        <div className="glass-card empty-card">
          <p className="muted" style={{ margin: 0 }}>
            Waiting for the hub connection… presence and voice appear here once metu is connected.
          </p>
        </div>
      )}
    </div>
  );
}
