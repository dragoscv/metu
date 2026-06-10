/**
 * Navigation model for the main companion window. The window is a small
 * horizontal "console": a fixed sidebar of sections on the left and a single
 * animated view pane on the right. Keeping the list declarative makes the
 * Sidebar + view router trivially data-driven.
 */
export type ViewId = 'home' | 'avatar' | 'assistant' | 'sensors' | 'activity' | 'settings';

export interface NavItem {
  id: ViewId;
  label: string;
  /** Single-glyph icon (emoji/unicode) — we avoid bundling an icon lib. */
  icon: string;
  /** Short helper shown under the section title in the view header. */
  hint: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: 'Home', icon: '◎', hint: 'Connection & quick actions' },
  { id: 'avatar', label: 'Avatar', icon: '✦', hint: 'Pick how metu looks' },
  { id: 'assistant', label: 'Assistant', icon: '✨', hint: 'Your agent on the desktop' },
  { id: 'sensors', label: 'Sensors', icon: '📡', hint: 'What metu is allowed to observe' },
  { id: 'activity', label: 'Activity', icon: '⚡', hint: 'Live awareness & clipboard' },
  { id: 'settings', label: 'Settings', icon: '⚙', hint: 'Workspace, window & account' },
] as const;
