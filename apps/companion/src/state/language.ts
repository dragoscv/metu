/**
 * Assistant response language — independent of the UI language (which
 * stays English). Controls the language of model replies + spoken TTS.
 * V1: English / Romanian.
 */
export type AssistantLanguage = 'en' | 'ro';

const KEY = 'metu.assistant.language';

export const LANGUAGE_LABELS: Record<AssistantLanguage, string> = {
  en: 'English',
  ro: 'Română',
};

export function loadAssistantLanguage(): AssistantLanguage {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'ro') return v;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function saveAssistantLanguage(lang: AssistantLanguage): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
}
