/**
 * UI locale (Jarvis v9) — EN/RO dictionaries for the companion UI.
 *
 * SEPARATE from the assistant conversation language (state/language.ts):
 * the user explicitly wants "UI in English, assistant in Romanian" to be
 * possible. `useT()` re-renders on switch via a window event.
 */
import { useSyncExternalStore } from 'react';

export type UiLocale = 'en' | 'ro';
const KEY = 'metu.companion.uiLocale';

export function loadUiLocale(): UiLocale {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'ro' ? 'ro' : 'en';
  } catch {
    return 'en';
  }
}

export function saveUiLocale(l: UiLocale): void {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('metu:uiLocale'));
}

const DICT = {
  en: {
    // nav
    'nav.home': 'Home',
    'nav.home.hint': 'Your day at a glance',
    'nav.avatar': 'Avatar',
    'nav.avatar.hint': 'Pick how metu looks',
    'nav.assistant': 'Assistant',
    'nav.assistant.hint': 'Desktop companion settings',
    'nav.sensors': 'Sensors',
    'nav.sensors.hint': 'What metu may observe',
    'nav.activity': 'Activity',
    'nav.activity.hint': 'What metu is seeing now',
    'nav.settings': 'Settings',
    'nav.settings.hint': 'Workspace, window & account',
    // home
    'home.today': 'Today',
    'home.activeTime': 'Active time',
    'home.topApps': 'Top apps',
    'home.spend': 'Agent spend',
    'home.suggestions': 'Recommendations',
    'home.noSuggestions': 'Nothing urgent — all clear.',
    'home.conversations': 'Recent conversations',
    'home.noConversations': 'No conversations yet — say hi to your assistant.',
    'home.streak': 'Streak',
    'home.days': 'days',
    'home.energy': 'Energy',
    'home.refresh': 'Refresh',
    // assistant page
    'assistant.show': 'Show desktop assistant',
    'assistant.language': 'Conversation language',
    'assistant.uiLanguage': 'Interface language',
    'assistant.personality': 'Personality',
    'assistant.proactivity': 'Proactivity',
    'assistant.proactivity.silent': 'Silent',
    'assistant.proactivity.aware': 'Aware',
    'assistant.proactivity.chatty': 'Chatty',
    'assistant.opacity': 'Avatar opacity',
    'assistant.glass': 'Bubble glass intensity',
    'assistant.presence': 'Presence & voice',
    'assistant.appearance': 'Appearance',
    'assistant.behavior': 'Behavior',
    // settings
    'settings.workspace': 'Workspace',
    'settings.window': 'Window & app',
    'settings.windowOpacity': 'Window opacity',
    'settings.account': 'Account',
    'settings.signout': 'Sign out',
    'settings.onboarding': 'Onboarding',
    'settings.reload': 'Reload',
    'settings.openWeb': 'Open web',
    'settings.appVersion': 'App',
    'settings.serverVersion': 'Server',
  },
  ro: {
    'nav.home': 'Acasă',
    'nav.home.hint': 'Ziua ta dintr-o privire',
    'nav.avatar': 'Avatar',
    'nav.avatar.hint': 'Alege cum arată metu',
    'nav.assistant': 'Asistent',
    'nav.assistant.hint': 'Setările companionului desktop',
    'nav.sensors': 'Senzori',
    'nav.sensors.hint': 'Ce poate observa metu',
    'nav.activity': 'Activitate',
    'nav.activity.hint': 'Ce vede metu acum',
    'nav.settings': 'Setări',
    'nav.settings.hint': 'Spațiu de lucru, fereastră și cont',
    'home.today': 'Astăzi',
    'home.activeTime': 'Timp activ',
    'home.topApps': 'Aplicații de top',
    'home.spend': 'Cost agenți',
    'home.suggestions': 'Recomandări',
    'home.noSuggestions': 'Nimic urgent — totul e în regulă.',
    'home.conversations': 'Conversații recente',
    'home.noConversations': 'Nicio conversație încă — salută-ți asistentul.',
    'home.streak': 'Serie',
    'home.days': 'zile',
    'home.energy': 'Energie',
    'home.refresh': 'Reîmprospătează',
    'assistant.show': 'Arată asistentul pe desktop',
    'assistant.language': 'Limba conversației',
    'assistant.uiLanguage': 'Limba interfeței',
    'assistant.personality': 'Personalitate',
    'assistant.proactivity': 'Proactivitate',
    'assistant.proactivity.silent': 'Tăcut',
    'assistant.proactivity.aware': 'Atent',
    'assistant.proactivity.chatty': 'Vorbăreț',
    'assistant.opacity': 'Opacitate avatar',
    'assistant.glass': 'Intensitate sticlă bule',
    'assistant.presence': 'Prezență și voce',
    'assistant.appearance': 'Aspect',
    'assistant.behavior': 'Comportament',
    'settings.workspace': 'Spațiu de lucru',
    'settings.window': 'Fereastră și aplicație',
    'settings.windowOpacity': 'Opacitate fereastră',
    'settings.account': 'Cont',
    'settings.signout': 'Deconectare',
    'settings.onboarding': 'Introducere',
    'settings.reload': 'Reîncarcă',
    'settings.openWeb': 'Deschide web',
    'settings.appVersion': 'Aplicație',
    'settings.serverVersion': 'Server',
  },
} as const;

export type UiKey = keyof (typeof DICT)['en'];

function subscribe(cb: () => void): () => void {
  window.addEventListener('metu:uiLocale', cb);
  return () => window.removeEventListener('metu:uiLocale', cb);
}

/** Reactive translate hook — re-renders on locale switch. */
export function useT(): (key: UiKey) => string {
  const locale = useSyncExternalStore(subscribe, loadUiLocale, () => 'en' as const);
  return (key: UiKey) => DICT[locale][key] ?? DICT.en[key] ?? key;
}

/** Non-hook translate for non-React call sites. */
export function t(key: UiKey): string {
  const locale = loadUiLocale();
  return DICT[locale][key] ?? DICT.en[key] ?? key;
}
