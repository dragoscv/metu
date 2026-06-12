/**
 * ViewHeader — consistent title + hint block at the top of every view pane.
 * Pulls its label/hint from the declarative nav model so the sidebar and the
 * view header never drift.
 */
import { getNavItems, type ViewId } from './nav';
import { useT } from '../state/locale';

export function ViewHeader({ id, actions }: { id: ViewId; actions?: React.ReactNode }) {
  // useT() subscribes to locale switches so the header re-renders.
  useT();
  const item = getNavItems().find((n) => n.id === id);
  if (!item) return null;
  return (
    <header className="view__header">
      <div className="view__heading">
        <h1 className="view__title">{item.label}</h1>
        <p className="view__hint">{item.hint}</p>
      </div>
      {actions ? <div className="view__actions">{actions}</div> : null}
    </header>
  );
}
