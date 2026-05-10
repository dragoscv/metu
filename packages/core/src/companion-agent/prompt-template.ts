/**
 * Persona prompt template renderer.
 *
 * Replaces `{{var}}` placeholders inside persona system prompts. Unknown
 * variables are left untouched (so a typo doesn't silently delete text)
 * and we never throw — a broken template just sends through with a
 * couple of unfilled tags rather than blowing up the turn.
 *
 * Always-available variables:
 *   {{currentDate}}    e.g. "2025-03-14"
 *   {{currentTime}}    e.g. "09:42 UTC"
 *   {{currentDateTime}} ISO string
 *   {{personaName}}    persona display name passed in
 *
 * Caller-supplied (from CompanionTurnInput.promptContext):
 *   {{userName}}       human name of the active user
 *   {{language}}       preferred language code/name
 *   {{recentDigest}}   short paragraph from memory
 */

export interface RenderVars {
  personaName?: string;
  userName?: string;
  language?: string;
  recentDigest?: string;
  /** Override clock for tests. */
  now?: Date;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderPersonaPrompt(template: string, vars: RenderVars = {}): string {
  const now = vars.now ?? new Date();
  const map: Record<string, string | undefined> = {
    currentDate: now.toISOString().slice(0, 10),
    currentTime: `${now.toISOString().slice(11, 16)} UTC`,
    currentDateTime: now.toISOString(),
    personaName: vars.personaName,
    userName: vars.userName,
    language: vars.language,
    recentDigest: vars.recentDigest,
  };
  return template.replace(PLACEHOLDER, (match, key: string) => {
    const v = map[key];
    return v == null ? match : v;
  });
}
