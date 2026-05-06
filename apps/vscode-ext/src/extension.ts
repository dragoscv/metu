/**
 * metu VS Code extension.
 *
 * Bridges the editor and the second brain:
 *   - Capture selection / file / clipboard.
 *   - "Where was I?" briefing on a project (current workspace folder name → project).
 *   - Log a decision from a quickpick.
 *   - Recall from memory and insert as comment.
 *   - Bridges Copilot models via the VS Code Language Model API to the metu
 *     mesh, so the workspace can route 'agentic' intent to copilot.
 */
import * as vscode from 'vscode';

interface MetuConfig {
  apiUrl: string;
  workspaceId: string;
  apiToken: string;
}

function cfg(): MetuConfig {
  const c = vscode.workspace.getConfiguration('metu');
  return {
    apiUrl: c.get<string>('apiUrl') ?? 'https://app.metu.ro',
    workspaceId: c.get<string>('workspaceId') ?? '',
    apiToken: c.get<string>('apiToken') ?? '',
  };
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const { apiUrl, apiToken } = cfg();
  const res = await fetch(`${apiUrl}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`metu api ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('metu.capture', captureCmd),
    vscode.commands.registerCommand('metu.restoreContext', restoreCmd),
    vscode.commands.registerCommand('metu.logDecision', logDecisionCmd),
    vscode.commands.registerCommand('metu.recall', recallCmd),
    vscode.commands.registerCommand('metu.signIn', signInCmd),
  );

  // Status bar
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.text = '$(brain) metu';
  item.tooltip = 'metu — your second brain';
  item.command = 'metu.restoreContext';
  item.show();
  ctx.subscriptions.push(item);
}

async function captureCmd() {
  const editor = vscode.window.activeTextEditor;
  const selection = editor?.document.getText(editor.selection) ?? '';
  const input =
    selection ||
    (await vscode.window.showInputBox({
      prompt: 'Capture into metu',
      placeHolder: 'A thought, a TODO, a question...',
    }));
  if (!input) return;
  try {
    await api('/api/captures', {
      kind: selection ? 'code' : 'text',
      content: input,
      source: 'vscode-ext',
      metadata: { file: editor?.document.fileName },
    });
    vscode.window.setStatusBarMessage('$(check) captured', 2000);
  } catch (e) {
    vscode.window.showErrorMessage(`metu capture failed: ${(e as Error).message}`);
  }
}

async function restoreCmd() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.name;
  if (!folder) {
    vscode.window.showWarningMessage('No workspace folder open.');
    return;
  }
  try {
    const r = await api<{ briefing: string }>('/api/projects/by-name/restore', {
      name: folder,
    });
    const doc = await vscode.workspace.openTextDocument({
      content: r.briefing,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (e) {
    vscode.window.showErrorMessage(`Restore failed: ${(e as Error).message}`);
  }
}

async function logDecisionCmd() {
  const title = await vscode.window.showInputBox({ prompt: 'Decision title' });
  if (!title) return;
  const rationale = await vscode.window.showInputBox({
    prompt: 'Rationale (why this over alternatives?)',
  });
  if (!rationale) return;
  try {
    await api('/api/decisions', { title, rationale });
    vscode.window.showInformationMessage('Decision logged.');
  } catch (e) {
    vscode.window.showErrorMessage(`Log failed: ${(e as Error).message}`);
  }
}

async function recallCmd() {
  const q = await vscode.window.showInputBox({ prompt: 'Recall from memory' });
  if (!q) return;
  try {
    const r = await api<{ hits: { content: string; similarity: number }[] }>('/api/recall', {
      query: q,
    });
    const pick = await vscode.window.showQuickPick(
      r.hits.map((h) => ({
        label: h.content.slice(0, 80),
        description: `${Math.round(h.similarity * 100)}%`,
        detail: h.content.slice(80, 280),
      })),
      { placeHolder: 'Pick a memory to insert' },
    );
    if (pick) {
      const editor = vscode.window.activeTextEditor;
      editor?.edit((b) => b.insert(editor.selection.active, `// ${pick.label}\n`));
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Recall failed: ${(e as Error).message}`);
  }
}

async function signInCmd() {
  const url = `${cfg().apiUrl}/sign-in?return=vscode`;
  await vscode.env.openExternal(vscode.Uri.parse(url));
  vscode.window.showInformationMessage(
    'Sign in in your browser, then paste your API token via Settings → metu.apiToken.',
  );
}

export function deactivate() {}
