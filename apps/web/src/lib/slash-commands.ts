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
