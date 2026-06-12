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
import { ObservingBadge } from '../ObservingBadge';
import { UpdateBanner } from '../../state/useUpdater';
import { HomeDashboard } from './HomeDashboard';

const labels: Record<HubStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Reconnecting…',
  error: 'Error',
};

export function HomeView({ auth, status }: { auth: AuthState; status: HubStatus }) {
  const ok = status === 'open';

  const avatarState: AvatarState = useMemo(
    () => (status === 'connecting' || status === 'closed' ? 'thinking' : 'idle'),
    [status],
  );

  return (
    <div className="view view--home">
      <div className="home-hero">
        <div className="home-hero__orb">
          <AvatarHost state={avatarState} size={96} />
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
        </div>
      </div>

      <UpdateBanner />

      {/* Jarvis v9: Home = your day at a glance. Presence/voice moved to
          the Assistant page; quick toggles moved to Settings. */}
      <HomeDashboard auth={auth} />
    </div>
  );
}
