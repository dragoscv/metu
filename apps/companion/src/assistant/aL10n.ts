/**
 * Assistant-language strings (Jarvis v10.1) — every string the AVATAR
 * surface speaks (bubbles, progress, errors, proactive cards, menus)
 * follows the ASSISTANT language, not the UI locale.
 *
 * `aT(key, vars?)` — template-aware lookup with {var} interpolation.
 * Chips inside proactive cards stay CANONICAL English here and get
 * localized at render via localizeChip() — routing keys stay stable.
 */
import { loadAssistantLanguage } from '../state/language';

const STRINGS = {
  en: {
    // progress narration
    'progress.readingScreen': 'Reading your screen…',
    'progress.gatheringContext': 'Gathering context…',
    'progress.thinking': 'Thinking it through…',
    'progress.writing': 'Writing the answer…',
    'progress.planningAct': 'Working out how to do that…',
    // tool activity labels
    'tool.recall': 'Searching memory',
    'tool.list_projects': 'Reading projects',
    'tool.list_tasks': 'Reading tasks',
    'tool.restore_continuity': 'Restoring context',
    'tool.briefing_generate': 'Generating your briefing',
    'tool.summarize_day': 'Summarizing the day',
    'tool.device.screenshot': 'Taking a screenshot',
    'tool.device.list_windows': 'Listing windows',
    'tool.device.a11y_tree': 'Reading the UI',
    'tool.device.a11y_find': 'Finding elements',
    'tool.device.observe_window': 'Observing the window',
    'tool.device.see': 'Looking at the screen',
    // act lane
    'act.noSafeWay': "I couldn't find a safe way to do that.",
    'act.done': 'Done.',
    'act.doneSteps': 'Done — all {n} steps.',
    'act.unverified': "(I couldn't confirm the app reacted — check it.)",
    'act.failed': "That didn't work.",
    // desktop actions
    'open.ok': 'Opened {label}.',
    'open.fail': "Couldn't open {label}.",
    'clipboard.empty': 'Your clipboard is empty.',
    // errors
    'err.budget': 'Voice/agent budget reached for this workspace.',
    'err.generic': 'Something went wrong.',
    'err.network': 'Network error.',
    'err.request': 'Request failed ({status}).',
    // escalation
    'escalate.ack': "On it — I've handed this to your Conductor and will follow up here.",
    'escalate.hint': 'Handed to your Conductor — running in the background.',
    // proactive cards
    'card.agentDone': 'Looks like one of your agents just finished its run.',
    'card.circling': 'You keep circling "{term}" — I can dig through my memory for it.',
    'card.eod': 'Winding down? I can wrap the day and note where to pick up tomorrow.',
    'card.noticed': "I noted that {label} you scrolled past — it's in your inbox.",
    'card.errorStuck': 'That error has been on screen for a bit — want me to look at it?',
    'card.welcomeBack': 'Welcome back. Want a quick catch-up on where you left off?',
    'card.thrash': 'Lots of context switching — looking for something? I can help.',
    // chat panel chrome
    'panel.drop': '📎 Drop files to attach',
    'panel.conversations': 'Conversations',
    'panel.newConversation': 'New conversation',
    'panel.empty': 'No previous conversations.',
    'menu.copy': 'Copy',
    'menu.copyMessage': 'Copy message',
    'menu.cut': 'Cut',
    'menu.paste': 'Paste',
    'menu.copyConversation': 'Copy conversation',
    'menu.selectAll': 'Select all',
    'menu.searchHistory': '🔎 Search screen history',
    'menu.copyBubble': '📋 Copy bubble text',
  },
  ro: {
    'progress.readingScreen': 'Îți citesc ecranul…',
    'progress.gatheringContext': 'Adun contextul…',
    'progress.thinking': 'Mă gândesc…',
    'progress.writing': 'Scriu răspunsul…',
    'progress.planningAct': 'Mă gândesc cum să fac asta…',
    'tool.recall': 'Caut în memorie',
    'tool.list_projects': 'Citesc proiectele',
    'tool.list_tasks': 'Citesc sarcinile',
    'tool.restore_continuity': 'Restaurez contextul',
    'tool.briefing_generate': 'Îți generez briefingul',
    'tool.summarize_day': 'Rezum ziua',
    'tool.device.screenshot': 'Fac o captură de ecran',
    'tool.device.list_windows': 'Listez ferestrele',
    'tool.device.a11y_tree': 'Citesc interfața',
    'tool.device.a11y_find': 'Caut elemente',
    'tool.device.observe_window': 'Observ fereastra',
    'tool.device.see': 'Mă uit la ecran',
    'act.noSafeWay': 'N-am găsit o cale sigură să fac asta.',
    'act.done': 'Gata.',
    'act.doneSteps': 'Gata — toți cei {n} pași.',
    'act.unverified': '(N-am putut confirma că aplicația a reacționat — verifică.)',
    'act.failed': 'N-a mers.',
    'open.ok': 'Am deschis {label}.',
    'open.fail': 'N-am putut deschide {label}.',
    'clipboard.empty': 'Clipboardul tău e gol.',
    'err.budget': 'Bugetul de voce/agent al spațiului de lucru a fost atins.',
    'err.generic': 'Ceva n-a mers bine.',
    'err.network': 'Eroare de rețea.',
    'err.request': 'Cererea a eșuat ({status}).',
    'escalate.ack': 'Mă ocup — am predat asta Conductorului și revin aici.',
    'escalate.hint': 'Predat Conductorului — rulează în fundal.',
    'card.agentDone': 'Se pare că unul dintre agenții tăi tocmai a terminat.',
    'card.circling': 'Tot revii la „{term}" — pot săpa prin memoria mea.',
    'card.eod': 'Închei ziua? Pot face un rezumat și notez de unde reiei mâine.',
    'card.noticed': 'Am notat acel {label} peste care ai trecut — e în inbox.',
    'card.errorStuck': 'Eroarea aia e pe ecran de ceva vreme — vrei să mă uit?',
    'card.welcomeBack': 'Bine ai revenit. Vrei un rezumat rapid de unde ai rămas?',
    'card.thrash': 'Multe schimbări de context — cauți ceva? Te pot ajuta.',
    'panel.drop': '📎 Trage fișierele aici',
    'panel.conversations': 'Conversații',
    'panel.newConversation': 'Conversație nouă',
    'panel.empty': 'Nicio conversație anterioară.',
    'menu.copy': 'Copiază',
    'menu.copyMessage': 'Copiază mesajul',
    'menu.cut': 'Decupează',
    'menu.paste': 'Lipește',
    'menu.copyConversation': 'Copiază conversația',
    'menu.selectAll': 'Selectează tot',
    'menu.searchHistory': '🔎 Caută în istoricul ecranului',
    'menu.copyBubble': '📋 Copiază textul',
  },
} as const;

export type AKey = keyof (typeof STRINGS)['en'];

/** Assistant-language translate with {var} interpolation. */
export function aT(key: AKey, vars?: Record<string, string | number>): string {
  const lang = loadAssistantLanguage() === 'ro' ? 'ro' : 'en';
  let s: string = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** Friendly localized label for a tool name (falls back to the raw name). */
export function toolLabel(name: string): string {
  const key = `tool.${name}` as AKey;
  const lang = loadAssistantLanguage() === 'ro' ? 'ro' : 'en';
  const hit = (STRINGS[lang] as Record<string, string>)[key];
  return hit ?? name.replace(/_/g, ' ');
}
