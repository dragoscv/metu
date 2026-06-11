/**
 * Local terminal lane — metu runs commands on your machine like an agent.
 *
 * Policy (the decided model):
 *   • DENYLIST  → never runs, no matter what (destructive/system-altering).
 *   • ALLOWLIST → runs on AUTOPILOT (no confirmation) — full agentic speed.
 *   • everything else → requires an explicit confirm tap (the caller shows
 *     a confirm bubble before calling run()).
 *
 * Hard guarantees live in Rust (sense_shell_exec): basename-only command,
 * no shell expansion (no `&&`, pipes, redirects possible), 32-arg cap,
 * 20s timeout, 64KB/16KB output caps.
 *
 * The allowlist is user-editable and persisted locally.
 */
import { invoke } from '@tauri-apps/api/core';

const ALLOW_KEY = 'metu.terminal.allowlist';

/** Read-only safe defaults — common dev tools whose typical use is benign. */
const DEFAULT_ALLOWLIST = [
  'git',
  'pnpm',
  'npm',
  'node',
  'npx',
  'docker',
  'cargo',
  'python',
  'pip',
  'go',
  'dotnet',
  'kubectl',
  'gh',
];

/** Never executable through metu, even if the user allowlists them. */
const DENYLIST = new Set([
  'format',
  'diskpart',
  'cipher',
  'bcdedit',
  'reg',
  'regedit',
  'shutdown',
  'rd',
  'rmdir',
  'del',
  'rm',
  'mkfs',
  'dd',
  'sudo',
  'runas',
  'schtasks',
  'sc',
  'net',
  'netsh',
  'taskkill',
  'wmic',
  'vssadmin',
]);

export function getAllowlist(): string[] {
  try {
    const raw = localStorage.getItem(ALLOW_KEY);
    if (raw) {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // fall through to defaults
  }
  return [...DEFAULT_ALLOWLIST];
}

export function setAllowlist(list: string[]): void {
  try {
    localStorage.setItem(ALLOW_KEY, JSON.stringify(list.map((s) => s.trim()).filter(Boolean)));
  } catch {
    // ignore
  }
}

export type TerminalVerdict = 'auto' | 'confirm' | 'denied';

/** Classify a command basename against the policy. */
export function classifyCommand(command: string): TerminalVerdict {
  const cmd = command.trim().toLowerCase();
  if (!cmd) return 'denied';
  if (DENYLIST.has(cmd)) return 'denied';
  if (getAllowlist().some((a) => a.toLowerCase() === cmd)) return 'auto';
  return 'confirm';
}

/** Extra guard: args that make an allowlisted tool destructive → confirm. */
const RISKY_ARG = /^(push|reset|clean|rebase|prune|rmi?|rm|down|delete|uninstall|drop)$/i;
const RISKY_FLAG = /^--?(force|hard|delete|prune|rmi|volumes|no-verify|f)$/i;

export function isRiskyInvocation(command: string, args: string[]): boolean {
  return args.some((a) => RISKY_ARG.test(a) || RISKY_FLAG.test(a));
}

export interface TerminalResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncatedStdout: boolean;
  truncatedStderr: boolean;
}

/** Parse a raw command line into basename + args (no shell semantics). */
export function parseCommandLine(line: string): { command: string; args: string[] } | null {
  const parts = line.trim().match(/(?:[^\s"]+|"[^"]*")+/g);
  if (!parts?.length) return null;
  const [command, ...args] = parts.map((p) => p.replace(/^"|"$/g, ''));
  if (!command) return null;
  return { command, args };
}

/** Execute (policy must have been applied by the caller for 'confirm'). */
export async function runTerminal(command: string, args: string[]): Promise<TerminalResult> {
  if (classifyCommand(command) === 'denied') {
    throw new Error(`Refused: "${command}" is on the denylist.`);
  }
  return await invoke<TerminalResult>('sense_shell_exec', {
    args: { command, args, allowlist: [...getAllowlist(), command] },
  });
}
