/**
 * In-character message strings for the desktop assistant, varied by
 * personality. Kept tiny and deterministic-ish (random pick) — the
 * assistant's substantive messages come from the Conductor over the hub;
 * these are the ambient, local-reaction lines (greetings, idle nudges,
 * window reactions).
 */
import type { PersonalityId } from '../avatar/personality';
import { loadAssistantLanguage } from '../state/language';

type Bank = Record<PersonalityId, string[]>;

const GREETING: Bank = {
  calm: ['Ready when you are.', 'Standing by.', "I'm here if you need me."],
  playful: ['Hey hey! 👋', "Let's get into it!", 'Miss me?'],
  quiet: ['…', 'Here.'],
};
const GREETING_RO: Bank = {
  calm: ['Gata când ești și tu.', 'Sunt aici.', 'Aici, dacă ai nevoie de mine.'],
  playful: ['Hei hei! 👋', 'Hai să-i dăm drumul!', 'Ți-a fost dor de mine?'],
  quiet: ['…', 'Aici.'],
};

const IDLE_NUDGE: Bank = {
  calm: ['Want me to summarize where you left off?', 'Need a hand picking this back up?'],
  playful: ['Still there? 👀', 'Taking a break? I got you when you’re back!'],
  quiet: ['', ''],
};
const IDLE_NUDGE_RO: Bank = {
  calm: ['Vrei un rezumat de unde ai rămas?', 'Te ajut să reiei de unde ai lăsat?'],
  playful: ['Mai ești acolo? 👀', 'Pauză? Te aștept când revii!'],
  quiet: ['', ''],
};

const WINDOW_REACT: Bank = {
  calm: ['Switched context — want notes on this?', 'New window. Tracking it.'],
  playful: ['Ooh, what’s this? 👀', 'New thing! Want me to keep an eye on it?'],
  quiet: ['', ''],
};
const WINDOW_REACT_RO: Bank = {
  calm: ['Ai schimbat contextul — vrei notițe?', 'Fereastră nouă. O urmăresc.'],
  playful: ['Ooo, ce-i asta? 👀', 'Ceva nou! Vrei să fiu cu ochii pe el?'],
  quiet: ['', ''],
};

const ASK_BEFORE_ACT: Bank = {
  calm: ['May I do that for you?', 'Shall I go ahead?'],
  playful: ['Want me to handle it? 😎', 'I can do that — say the word!'],
  quiet: ['Proceed?', 'OK to act?'],
};
const ASK_BEFORE_ACT_RO: Bank = {
  calm: ['Pot să fac asta pentru tine?', 'Să continui?'],
  playful: ['Vrei să mă ocup eu? 😎', 'Pot s-o fac — spune doar!'],
  quiet: ['Continui?', 'OK să acționez?'],
};

/**
 * One-tap quick replies shown as chips under a bubble — for when the user
 * doesn't want to type or speak. `ambient` follows greetings/nudges;
 * `followup` follows an assistant chat reply.
 */
export const QUICK_REPLIES: Record<'ambient' | 'followup', string[]> = {
  ambient: ['Catch me up', "What's next on my plate?", 'Summarize where I left off'],
  followup: ['Tell me more', 'Continue', 'Thanks! 👍'],
};

function pick(bank: Bank, roBank: Bank, p: PersonalityId): string | null {
  // Ambient lines follow the ASSISTANT language (Jarvis v9.1).
  const b = loadAssistantLanguage() === 'ro' ? roBank : bank;
  const arr = b[p].filter(Boolean);
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)] ?? null;
}

export const assistantLines = {
  greeting: (p: PersonalityId) => pick(GREETING, GREETING_RO, p),
  idleNudge: (p: PersonalityId) => pick(IDLE_NUDGE, IDLE_NUDGE_RO, p),
  windowReact: (p: PersonalityId) => pick(WINDOW_REACT, WINDOW_REACT_RO, p),
  askBeforeAct: (p: PersonalityId) => pick(ASK_BEFORE_ACT, ASK_BEFORE_ACT_RO, p),
};
