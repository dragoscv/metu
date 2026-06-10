/**
 * Ask-before-act proposal bus. The assistant never acts on a window
 * autonomously — per the user's "ask before every action (default deny)"
 * choice. Any code (hub conductor handler, local heuristic) that wants the
 * assistant to perform a window action calls `proposeAction(...)`; the
 * assistant window shows a confirm bubble; only on explicit confirm does the
 * executor run.
 *
 * Runs within a single window (the assistant window) so a plain in-process
 * pub/sub is sufficient; no Tauri event needed.
 */

export interface AssistantProposal {
  id: string;
  /** In-character prompt shown in the bubble, e.g. "Bring VS Code forward?" */
  prompt: string;
  /** Short confirm-button label, e.g. "Do it". */
  confirmLabel: string;
  /** Runs only if the user confirms. */
  execute: () => void | Promise<void>;
}

type Listener = (p: AssistantProposal) => void;
const listeners = new Set<Listener>();

export function onProposal(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function proposeAction(p: Omit<AssistantProposal, 'id'>): void {
  const proposal: AssistantProposal = { ...p, id: crypto.randomUUID() };
  for (const l of listeners) l(proposal);
}
