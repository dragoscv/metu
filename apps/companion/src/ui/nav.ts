/**
 * Navigation model for the main companion window. The window is a small
 * horizontal "console": a fixed sidebar of sections on the left and a single
 * animated view pane on the right. Keeping the list declarative makes the
 * Sidebar + view router trivially data-driven.
 */
import { t } from '../state/locale';

export type ViewId = 'home' | 'avatar' | 'assistant' | 'sensors' | 'activity' | 'settings';

export interface NavItem {
  id: ViewId;
  label: string;
  /** Single-glyph icon (emoji/unicode) — we avoid bundling an icon lib. */
  icon: string;
  /** Short helper shown under the section title in the view header. */
  hint: string;
}

/** Localized nav items (Jarvis v9) — call per render; labels react to the
 *  UI locale via useT() in consumers, this getter for static call sites. */
export function getNavItems(): readonly NavItem[] {
  return [
    { id: 'home', label: t('nav.home'), icon: '◎', hint: t('nav.home.hint') },
    { id: 'avatar', label: t('nav.avatar'), icon: '✦', hint: t('nav.avatar.hint') },
    { id: 'assistant', label: t('nav.assistant'), icon: '✨', hint: t('nav.assistant.hint') },
    { id: 'sensors', label: t('nav.sensors'), icon: '📡', hint: t('nav.sensors.hint') },
    { id: 'activity', label: t('nav.activity'), icon: '⚡', hint: t('nav.activity.hint') },
    { id: 'settings', label: t('nav.settings'), icon: '⚙', hint: t('nav.settings.hint') },
  ] as const;
}

/** Back-compat static export (English) — prefer getNavItems(). */
export const NAV_ITEMS: readonly NavItem[] = getNavItems();
