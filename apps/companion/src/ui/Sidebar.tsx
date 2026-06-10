/**
 * Sidebar — left navigation rail for the main window console. Renders the
 * declarative {@link NAV_ITEMS} list, highlights the active view, and surfaces
 * the live connection status at the bottom.
 *
 * The active indicator is a plain CSS highlight (NOT a framer-motion shared
 * `layoutId`). On React 19 + framer-motion, a shared `layoutId` across
 * conditionally-rendered siblings reliably throws `removeChild` NotFoundError,
 * so we deliberately avoid it here.
 */
import { AvatarHost } from '../avatar/AvatarHost';
import type { AvatarState } from '../avatar/types';
import type { HubStatus } from '../state/useHubConnection';
import { NAV_ITEMS, type ViewId } from './nav';

const statusLabels: Record<HubStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting…',
  open: 'Connected',
  closed: 'Reconnecting…',
  error: 'Error',
};

export function Sidebar({
  active,
  onSelect,
  status,
  avatarState,
}: {
  active: ViewId;
  onSelect: (id: ViewId) => void;
  status: HubStatus;
  avatarState: AvatarState;
}) {
  const ok = status === 'open';

  return (
    <nav className="sidebar">
      <div className="sidebar__brand">
        <div className="sidebar__orb">
          <AvatarHost state={avatarState} size={52} />
        </div>
        <div className="sidebar__brandmeta">
          <span className="sidebar__name">metu</span>
          <span className="sidebar__tag">companion</span>
        </div>
      </div>

      <div className="sidebar__items">
        {NAV_ITEMS.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              className={`navitem ${isActive ? 'navitem--active' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              <span className="navitem__icon">{item.icon}</span>
              <span className="navitem__label">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className={`sidebar__status sidebar__status--${ok ? 'on' : 'off'}`}>
        <span className="sidebar__statusdot" />
        {statusLabels[status]}
      </div>
    </nav>
  );
}
