/**
 * Slash-command vocabulary for the Conductor composer.
 *
 * Pure functions, no React imports — kept separate from the chat
 * component so they're trivially testable.
 */
export interface SlashCommand {
  name: string;
  description: string;
  /** Transform the raw input (excluding the leading slash) into the
   *  natural-language prompt the conductor should see. */
  expand: (rest: string) => string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'recall',
    description: 'Search memory and quote relevant chunks',
    expand: (rest) =>
      rest.trim().length > 0
        ? `Recall everything you remember relevant to: ${rest.trim()}`
        : 'Recall what you remember from the last few days.',
  },
  {
    name: 'restore',
    description: "I'm back — catch me up on where I left off",
    expand: (rest) => {
      const scope = rest.trim();
      if (scope.length > 0) {
        return `I'm back. Catch me up on ${scope}. Use \`recall\` to ground yourself, then summarize: where I left off, why, and the single smallest next step.`;
      }
      return "I'm back. Catch me up: what's the state across my active projects, what's blocked, and what's the single smallest next step I should take right now?";
    },
  },
  {
    name: 'decision',
    description: 'Record a decision in the project log',
    expand: (rest) =>
      rest.trim().length > 0
        ? `Record this as a decision in the most relevant project's decision log, with rationale and alternatives if obvious: ${rest.trim()}`
        : 'Help me articulate and record a decision I just made. Ask one clarifying question first if needed.',
  },
  {
    name: 'focus',
    description: 'Set or inspect what I should focus on',
    expand: (rest) =>
      rest.trim().length > 0
        ? `Set my current focus to: ${rest.trim()}. Update the focus engine and acknowledge briefly.`
        : 'What should I focus on for the next hour? Consider momentum, blocked tasks, and leverage. Give me exactly one thing.',
  },
  {
    name: 'act',
    description: 'Take an action (subject to my autonomy policy)',
    expand: (rest) =>
      rest.trim().length > 0
        ? `Take this action now, routing through the ACL: ${rest.trim()}. If it requires approval, post the ask. If it's auto, execute and report.`
        : 'What action would have the highest leverage right now? Propose one and ask for approval.',
  },
  {
    name: 'notify',
    description: 'Send a notification to my devices',
    expand: (rest) =>
      rest.trim().length > 0
        ? `Send a push notification to my devices saying: ${rest.trim()}`
        : 'Send me a quick test notification.',
  },
  {
    name: 'goal',
    description: 'Create a new goal',
    expand: (rest) =>
      rest.trim().length > 0
        ? `Create a new goal titled: ${rest.trim()}`
        : 'Help me draft a new goal.',
  },
  {
    name: 'help',
    description: 'List what you can do',
    expand: () =>
      'List the tools you have access to and the categories of work you can do for me. Be concise.',
  },
];

export function matchSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];
  const firstWord = input.slice(1).split(/\s/)[0]?.toLowerCase() ?? '';
  if (firstWord.length === 0) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(firstWord));
}

export function expandSlashCommand(input: string): string {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return input;
  const match = trimmed.slice(1).match(/^(\w+)(?:\s+([\s\S]*))?$/);
  if (!match) return input;
  const [, name = '', rest = ''] = match;
  const cmd = SLASH_COMMANDS.find((c) => c.name === name.toLowerCase());
  if (!cmd) return input;
  return cmd.expand(rest);
}
