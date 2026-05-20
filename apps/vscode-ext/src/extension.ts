/**
 * metu VS Code extension — bridges the editor and the second brain.
 *
 * Commands (call /api/sdk/v1/*):
 *   - metu.capture    → POST /capture (selection or quick-input)
 *   - metu.recall     → POST /recall, pick a hit, insert as comment
 *   - metu.notify     → POST /notify (test ping or custom title)
 *
 * Hub bridge (WS to /ws on hubUrl):
 *   - Connects on sign-in, sends `hello { kind: 'vscode_ext' }`.
 *   - Handles `tool.invoke` envelopes for `editor.copilot_chat` (proxies
 *     to vscode.lm.selectChatModels) and `editor.show_message`.
 *   - Replies with `tool.result`. Reconnects with capped backoff.
 *
 * Auth: tokens live in SecretStorage. Device-flow sign-in when
 * `metu.oauthClientId` is set; manual paste fallback otherwise.
 */
import * as vscode from 'vscode';

const TOKEN_KEY = 'metu.accessToken';
const REFRESH_KEY = 'metu.refreshToken';
const DEFAULT_SCOPES = 'openid profile capture:write recall:read notify:write';

/** Timestamp of the most recent successful capture this session (ms epoch). */
let lastCapturedAt: number | null = null;
/** Listeners notified after lastCapturedAt changes; lets the status bar refresh. */
const onLastCaptureChange: Array<() => void> = [];

function relativeTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Cfg {
  apiUrl: string;
  hubUrl: string;
  oauthClientId: string;
  scopes: string;
  copilotBridge: boolean;
}

function readCfg(): Cfg {
  const c = vscode.workspace.getConfiguration('metu');
  return {
    apiUrl: (c.get<string>('apiUrl') ?? 'https://app.metu.ro').replace(/\/$/, ''),
    hubUrl: (c.get<string>('hubUrl') ?? 'wss://hub.metu.ro').replace(/\/$/, ''),
    oauthClientId: (c.get<string>('oauthClientId') ?? '').trim(),
    scopes: (c.get<string>('scopes') ?? DEFAULT_SCOPES).trim() || DEFAULT_SCOPES,
    copilotBridge: c.get<boolean>('copilotBridge') ?? true,
  };
}

class AuthState {
  private readonly secrets: vscode.SecretStorage;
  private readonly listeners = new Set<(token: string | undefined) => void>();
  private cachedAccess: string | undefined;
  private cachedRefresh: string | undefined;

  constructor(secrets: vscode.SecretStorage) {
    this.secrets = secrets;
  }

  async load(): Promise<void> {
    this.cachedAccess = await this.secrets.get(TOKEN_KEY);
    this.cachedRefresh = await this.secrets.get(REFRESH_KEY);
  }

  get token(): string | undefined {
    return this.cachedAccess;
  }

  get refresh(): string | undefined {
    return this.cachedRefresh;
  }

  async setTokens(input: {
    access: string | undefined;
    refresh?: string | undefined;
  }): Promise<void> {
    if (input.access) await this.secrets.store(TOKEN_KEY, input.access);
    else await this.secrets.delete(TOKEN_KEY);
    this.cachedAccess = input.access || undefined;

    if (input.refresh !== undefined) {
      if (input.refresh) await this.secrets.store(REFRESH_KEY, input.refresh);
      else await this.secrets.delete(REFRESH_KEY);
      this.cachedRefresh = input.refresh || undefined;
    }

    for (const l of this.listeners) l(this.cachedAccess);
  }

  async clear(): Promise<void> {
    await this.setTokens({ access: undefined, refresh: '' });
  }

  onChange(fn: (token: string | undefined) => void): vscode.Disposable {
    this.listeners.add(fn);
    return new vscode.Disposable(() => this.listeners.delete(fn));
  }
}

class MetuClient {
  constructor(private auth: AuthState) {}

  private async request<T>(path: string, body: unknown, isRetry = false): Promise<T> {
    const token = this.auth.token;
    if (!token) throw new Error('Not signed in. Run "metu: Sign in" first.');
    const { apiUrl } = readCfg();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const json: unknown = text ? JSON.parse(text) : null;
      if (!res.ok) {
        if (res.status === 401 && !isRetry && this.auth.refresh) {
          // Try once to refresh and retry. If refresh fails, clear and bail.
          const refreshed = await tryRefresh(this.auth);
          if (refreshed) return this.request<T>(path, body, true);
        }
        if (res.status === 401) await this.auth.clear();
        const detail =
          json && typeof json === 'object' && 'error' in json
            ? String((json as { error: unknown }).error)
            : `HTTP ${res.status}`;
        throw new Error(`metu ${path} → ${detail}`);
      }
      return json as T;
    } finally {
      clearTimeout(timer);
    }
  }

  capture(input: {
    kind: 'text' | 'code';
    content: string;
    source: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    return this.request('/api/sdk/v1/capture', input);
  }

  recall(input: {
    query: string;
    k?: number;
  }): Promise<Array<{ id: string; content: string; score: number }>> {
    return this.request('/api/sdk/v1/recall', input);
  }

  notify(input: {
    title: string;
    body?: string;
    urgency?: 'low' | 'normal' | 'high' | 'critical';
    source?: string;
  }): Promise<{ id: string }> {
    return this.request('/api/sdk/v1/notify', input);
  }

  companionTurn(input: {
    personaSlug: string;
    utterance: string;
    eagerness?: number;
  }): Promise<
    { kind: 'local'; text: string } | { kind: 'escalated'; ack: string; eventId?: string }
  > {
    return this.request('/api/sdk/v1/companion/turn', {
      ...input,
      surface: 'vscode',
      history: [],
    });
  }

  async timeline(input: {
    kinds?: string[];
    limit?: number;
    sinceDays?: number;
  }): Promise<{ items: BacklogItem[] }> {
    // GET — bypass the POST-only `request` helper.
    const token = this.auth.token;
    if (!token) throw new Error('not signed in');
    const apiUrl = readCfg().apiUrl;
    const params = new URLSearchParams();
    for (const k of input.kinds ?? []) params.append('kind', k);
    if (input.limit) params.set('limit', String(input.limit));
    if (input.sinceDays) params.set('since', `${input.sinceDays}d`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${apiUrl}/api/sdk/v1/timeline?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`metu /timeline → HTTP ${res.status}`);
      const json = (await res.json()) as { items: BacklogItem[] };
      return { items: json.items ?? [] };
    } finally {
      clearTimeout(timer);
    }
  }

  async resume(): Promise<ResumePayload> {
    const token = this.auth.token;
    if (!token) throw new Error('not signed in');
    const apiUrl = readCfg().apiUrl;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${apiUrl}/api/sdk/v1/resume`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`metu /resume → HTTP ${res.status}`);
      return (await res.json()) as ResumePayload;
    } finally {
      clearTimeout(timer);
    }
  }

  async regenerateBrief(projectId: string): Promise<{ projectName: string; nextStep: string }> {
    const token = this.auth.token;
    if (!token) throw new Error('not signed in');
    const apiUrl = readCfg().apiUrl;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(`${apiUrl}/api/sdk/v1/brief`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ projectId }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`metu /brief → HTTP ${res.status}`);
      const json = (await res.json()) as { projectName: string; nextStep: string };
      return { projectName: json.projectName, nextStep: json.nextStep };
    } finally {
      clearTimeout(timer);
    }
  }
}

interface ResumeBriefing {
  id: string;
  projectId: string;
  projectName: string;
  momentumScore: number | null;
  generatedAt: string;
  nextStep: string;
  briefing: string;
}
interface ResumePayload {
  ok: boolean;
  since: '3d' | '3w' | '3m';
  windowDays: number;
  timelineEventCount: number;
  briefings: ResumeBriefing[];
}

interface BacklogItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  occurredAt: string;
}

class ConductorBacklogProvider implements vscode.TreeDataProvider<BacklogItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private items: BacklogItem[] = [];

  constructor(
    private readonly client: MetuClient,
    private readonly auth: AuthState,
  ) {}

  refresh(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    if (!this.auth.token) {
      this.items = [];
      this._onDidChangeTreeData.fire();
      return;
    }
    try {
      const { items } = await this.client.timeline({
        kinds: [
          'conductor.escalation.completed',
          'conductor.tool.approved',
          'conductor.observed.companion-agent escalate',
        ],
        limit: 20,
        sinceDays: 7,
      });
      this.items = items;
    } catch {
      this.items = [];
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(e: BacklogItem): vscode.TreeItem {
    const item = new vscode.TreeItem(e.title, vscode.TreeItemCollapsibleState.None);
    const when = new Date(e.occurredAt);
    item.description = `${e.kind.split('.').pop()} · ${when.toLocaleString()}`;
    item.tooltip = e.body ?? e.title;
    item.contextValue = 'backlogItem';
    item.id = e.id;
    return item;
  }

  getChildren(): BacklogItem[] {
    return this.items;
  }

  count(): number {
    return this.items.length;
  }

  dismiss(id: string): void {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length !== before) this._onDidChangeTreeData.fire();
  }
}

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const auth = new AuthState(ctx.secrets);
  await auth.load();
  const client = new MetuClient(auth);
  const hub = new HubBridge(auth);
  ctx.subscriptions.push(hub);

  let backlog: ConductorBacklogProvider | undefined;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  ctx.subscriptions.push(status);
  function renderStatus(): void {
    if (auth.token) {
      const dot = hub.statusDot();
      const last = lastCapturedAt ? ` · last capture ${relativeTime(lastCapturedAt)}` : '';
      const backlogCount = backlog?.count() ?? 0;
      const backlogChip = backlogCount > 0 ? ` $(inbox) ${backlogCount}` : '';
      status.text = `$(brain) metu ${dot}${backlogChip}`;
      status.tooltip = `metu — signed in. Hub: ${hub.statusLabel()}${last}${backlogCount > 0 ? `\nBacklog: ${backlogCount} item${backlogCount === 1 ? '' : 's'}` : ''}. Click to capture.`;
      status.command = 'metu.capture';
    } else {
      status.text = '$(brain) metu: sign in';
      status.tooltip = 'Click to sign in to metu.';
      status.command = 'metu.signIn';
    }
    status.show();
  }
  renderStatus();
  ctx.subscriptions.push(auth.onChange(renderStatus));
  ctx.subscriptions.push(hub.onStatusChange(renderStatus));
  onLastCaptureChange.push(renderStatus);
  // Re-render every 30s so the relative timestamp stays fresh.
  const tickTimer = setInterval(renderStatus, 30_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(tickTimer) });

  // Auto-connect when we already have a token.
  if (auth.token) hub.connect();
  // And whenever the token changes (sign-in / refresh).
  ctx.subscriptions.push(
    auth.onChange((token) => {
      if (token) hub.connect();
      else hub.disconnect();
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand('metu.capture', () => captureCmd(client)),
    vscode.commands.registerCommand('metu.captureFile', () => captureFileCmd(client)),
    vscode.commands.registerCommand('metu.captureClipboard', () => captureClipboardCmd(client)),
    vscode.commands.registerCommand('metu.recall', () => recallCmd(client)),
    vscode.commands.registerCommand('metu.recallPanel', () => recallPanelCmd(ctx, client)),
    vscode.commands.registerCommand('metu.resume', () => resumeCmd(client)),
    vscode.commands.registerCommand('metu.regenerateBrief', () => regenerateBriefCmd(client)),
    vscode.commands.registerCommand('metu.notify', () => notifyCmd(client)),
    vscode.commands.registerCommand('metu.companionTurn', () => companionTurnCmd(client)),
    vscode.commands.registerCommand('metu.signIn', () => signInCmd(auth)),
    vscode.commands.registerCommand('metu.signOut', () => signOutCmd(auth)),
    vscode.commands.registerCommand('metu.openWeb', async () => {
      const apiUrl = vscode.workspace
        .getConfiguration('metu')
        .get<string>('apiUrl', 'https://app.metu.ro');
      await vscode.env.openExternal(vscode.Uri.parse(apiUrl));
    }),
    vscode.commands.registerCommand('metu.openTimeline', async () => {
      const apiUrl = vscode.workspace
        .getConfiguration('metu')
        .get<string>('apiUrl', 'https://app.metu.ro');
      await vscode.env.openExternal(vscode.Uri.parse(`${apiUrl.replace(/\/$/, '')}/timeline`));
    }),
    vscode.commands.registerCommand('metu.openAudit', async () => {
      const apiUrl = vscode.workspace
        .getConfiguration('metu')
        .get<string>('apiUrl', 'https://app.metu.ro');
      await vscode.env.openExternal(vscode.Uri.parse(`${apiUrl.replace(/\/$/, '')}/audit`));
    }),
    vscode.commands.registerCommand('metu.openCapturesForWorkspace', async () => {
      const apiUrl = vscode.workspace
        .getConfiguration('metu')
        .get<string>('apiUrl', 'https://app.metu.ro');
      const folder = vscode.workspace.workspaceFolders?.[0];
      const tag = folder?.name
        ?.toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .slice(0, 40);
      const base = apiUrl.replace(/\/$/, '');
      const target = tag ? `${base}/captures?tag=${encodeURIComponent(tag)}` : `${base}/captures`;
      await vscode.env.openExternal(vscode.Uri.parse(target));
    }),
  );

  // Conductor backlog tree view (slice 15 RR).
  backlog = new ConductorBacklogProvider(client, auth);
  const backlogRef = backlog;
  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider('metu.conductorBacklog', backlogRef),
    vscode.commands.registerCommand('metu.refreshBacklog', () => backlogRef.refresh()),
    vscode.commands.registerCommand('metu.dismissBacklogItem', (arg: unknown) => {
      // Invoked from the inline action: VS Code passes the TreeItem.
      // Invoked from the command palette: nothing — pick from a quick-pick.
      const id =
        arg &&
        typeof arg === 'object' &&
        'id' in arg &&
        typeof (arg as { id: unknown }).id === 'string'
          ? (arg as { id: string }).id
          : undefined;
      if (id) backlogRef.dismiss(id);
    }),
    auth.onChange(() => backlogRef.refresh()),
  );
  // Re-render the status bar whenever the backlog refreshes so the chip stays in sync.
  backlogRef.onDidChangeTreeData(() => renderStatus());
  backlogRef.refresh();
  // Auto-refresh every 60s while the view exists.
  const refreshTimer = setInterval(() => backlogRef.refresh(), 60_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });

  // Resume status bar — top "where to start" briefing, refreshed every 5min.
  const resumeStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  resumeStatus.command = 'metu.resume';
  ctx.subscriptions.push(resumeStatus);
  async function refreshResume(): Promise<void> {
    if (!auth.token) {
      resumeStatus.hide();
      return;
    }
    try {
      const r = await client.resume();
      const top = r.briefings[0];
      if (!top) {
        resumeStatus.hide();
        return;
      }
      const oneLine = top.nextStep.split(/\s+/).slice(0, 12).join(' ');
      resumeStatus.text = `$(book) ${top.projectName}: ${oneLine}…`;
      resumeStatus.tooltip = `metu — next step in ${top.projectName}.\n\n${top.nextStep}\n\nClick for all (${r.briefings.length}).`;
      resumeStatus.show();
    } catch {
      resumeStatus.hide();
    }
  }
  void refreshResume();
  ctx.subscriptions.push(auth.onChange(() => void refreshResume()));
  const resumeTimer = setInterval(() => void refreshResume(), 5 * 60_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(resumeTimer) });

  // Capture-on-save (opt-in via `metu.captureOnSave`). Throttled per-file
  // so a noisy formatter that re-saves every 200ms doesn't spam captures.
  const lastSaveAt = new Map<string, number>();
  const SAVE_THROTTLE_MS = 30_000;
  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      const cfg = vscode.workspace.getConfiguration('metu');
      if (!cfg.get<boolean>('captureOnSave', false)) return;
      if (!auth.token) return;
      // Skip Untitled, scratch, output channels, and files outside a workspace.
      if (doc.isUntitled || doc.uri.scheme !== 'file') return;
      if (!vscode.workspace.getWorkspaceFolder(doc.uri)) return;
      const now = Date.now();
      const last = lastSaveAt.get(doc.uri.fsPath) ?? 0;
      if (now - last < SAVE_THROTTLE_MS) return;
      lastSaveAt.set(doc.uri.fsPath, now);
      try {
        const snippet = doc.getText().slice(0, 200);
        await client.capture({
          kind: 'code',
          content: snippet,
          source: 'vscode-ext',
          metadata: {
            file: doc.fileName,
            languageId: doc.languageId,
            event: 'save',
          },
        });
      } catch {
        // Silent — we don't want save-time noise. The user can run
        // `metu: Capture` manually if it matters.
      }
    }),
  );

  // Terminal lifecycle events (open/close) — non-content. Help
  // Conductor know when the user is shelling out vs. editing.
  ctx.subscriptions.push(
    vscode.window.onDidOpenTerminal((t) => {
      const opts = t.creationOptions as { hideFromUser?: boolean };
      hub.sendDeviceEvent('vscode.terminal.opened', {
        name: t.name,
        creationOptions: { hideFromUser: opts.hideFromUser ?? false },
      });
    }),
    vscode.window.onDidCloseTerminal((t) => {
      hub.sendDeviceEvent('vscode.terminal.closed', { name: t.name, exitCode: t.exitStatus?.code });
    }),
  );

  // Editor typing pulse — coarse "user is actively editing X" signal,
  // debounced + batched so a 2k-char rename storm becomes one event.
  // No content ever leaves the editor; we send file path + line counts.
  // Sent at most once per 30s per file when there are pending changes.
  interface PendingChange {
    file: string;
    languageId: string;
    linesAdded: number;
    linesRemoved: number;
    charsAdded: number;
    charsRemoved: number;
  }
  const pending = new Map<string, PendingChange>();
  const TYPING_FLUSH_MS = 30_000;
  let typingTimer: NodeJS.Timeout | null = null;

  function flushTyping() {
    typingTimer = null;
    if (pending.size === 0 || !auth.token) return;
    for (const [, p] of pending) {
      hub.sendDeviceEvent('vscode.editor.text.changed', { ...p });
    }
    pending.clear();
  }

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((ev) => {
      if (ev.document.uri.scheme !== 'file') return;
      if (!vscode.workspace.getWorkspaceFolder(ev.document.uri)) return;
      const key = ev.document.uri.fsPath;
      const acc = pending.get(key) ?? {
        file: ev.document.fileName,
        languageId: ev.document.languageId,
        linesAdded: 0,
        linesRemoved: 0,
        charsAdded: 0,
        charsRemoved: 0,
      };
      for (const change of ev.contentChanges) {
        const removedLines = change.range.end.line - change.range.start.line;
        const addedLines = (change.text.match(/\n/g) ?? []).length;
        acc.charsRemoved += change.rangeLength;
        acc.charsAdded += change.text.length;
        acc.linesRemoved += removedLines;
        acc.linesAdded += addedLines;
      }
      pending.set(key, acc);
      if (typingTimer) return;
      typingTimer = setTimeout(flushTyping, TYPING_FLUSH_MS);
    }),
    { dispose: () => typingTimer && clearTimeout(typingTimer) },
  );

  // Git extension — branch + dirty-state changes per repo. We never
  // send diff content, only branch name + ahead/behind + dirty flag.
  // Use the documented API (cf. microsoft/vscode docs/extensionAPI).
  void wireGitListeners(ctx, hub).catch(() => {
    /* git extension might not be installed (e.g. Codespaces minimal) */
  });
}

interface GitRepoState {
  HEAD?: { name?: string; commit?: string; ahead?: number; behind?: number };
  workingTreeChanges?: ReadonlyArray<unknown>;
  indexChanges?: ReadonlyArray<unknown>;
}
interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepoState & { onDidChange: vscode.Event<void> };
}
interface GitAPI {
  repositories: ReadonlyArray<GitRepository>;
  onDidOpenRepository: vscode.Event<GitRepository>;
}
interface GitExtensionExports {
  getAPI(version: 1): GitAPI;
}

async function wireGitListeners(ctx: vscode.ExtensionContext, hub: HubBridge): Promise<void> {
  const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!ext) return;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  const api = exports.getAPI(1);
  const lastByRepo = new Map<string, string>();
  const subscribe = (repo: GitRepository): void => {
    const fire = (): void => {
      const head = repo.state.HEAD;
      const branch = head?.name ?? null;
      const dirty =
        (repo.state.workingTreeChanges?.length ?? 0) + (repo.state.indexChanges?.length ?? 0) > 0;
      const sig = `${branch}|${dirty}|${head?.commit ?? ''}|${head?.ahead ?? 0}|${head?.behind ?? 0}`;
      const key = repo.rootUri.fsPath;
      if (lastByRepo.get(key) === sig) return;
      const prevSig = lastByRepo.get(key);
      lastByRepo.set(key, sig);
      const baseName = key.replace(/\\/g, '/').split('/').pop();
      hub.sendDeviceEvent('vscode.git.state', {
        repo: baseName,
        branch,
        dirty,
        ahead: head?.ahead ?? 0,
        behind: head?.behind ?? 0,
        commit: head?.commit ?? null,
        // Branch-changed signal (Conductor finds this useful for
        // attributing work to the right project/feature).
        branchChanged: prevSig ? !prevSig.startsWith(`${branch}|`) : true,
      });
    };
    fire(); // initial
    ctx.subscriptions.push(repo.state.onDidChange(fire));
  };
  for (const r of api.repositories) subscribe(r);
  ctx.subscriptions.push(api.onDidOpenRepository(subscribe));
}

export function deactivate(): void {
  /* nothing to clean up — ctx.subscriptions handles it */
}

// ─── Commands ──────────────────────────────────────────────────────────────

async function captureCmd(client: MetuClient): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selection = editor?.document.getText(editor.selection) ?? '';
  const input =
    selection ||
    (await vscode.window.showInputBox({
      prompt: 'Capture into metu',
      placeHolder: 'A thought, a TODO, a question...',
      ignoreFocusOut: true,
    }));
  if (!input) return;
  try {
    const meta: Record<string, unknown> = {};
    if (editor?.document.fileName) {
      meta.file = editor.document.fileName;
      meta.languageId = editor.document.languageId;
      if (selection) {
        meta.startLine = editor.selection.start.line + 1;
        meta.endLine = editor.selection.end.line + 1;
      }
    }
    await client.capture({
      kind: selection ? 'code' : 'text',
      content: input,
      source: 'vscode-ext',
      metadata: meta,
    });
    lastCapturedAt = Date.now();
    onLastCaptureChange.forEach((fn) => fn());
    vscode.window.setStatusBarMessage('$(check) metu captured', 2000);
  } catch (e) {
    vscode.window.showErrorMessage(`metu capture failed: ${(e as Error).message}`);
  }
}

async function captureFileCmd(client: MetuClient): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('metu: no active editor to capture.');
    return;
  }
  const text = editor.document.getText();
  if (!text.trim()) {
    vscode.window.showWarningMessage('metu: file is empty.');
    return;
  }
  // Cap at 50k chars to avoid pushing huge files into the inbox.
  const MAX = 50_000;
  const truncated = text.length > MAX;
  const content = truncated
    ? `${text.slice(0, MAX)}\n\n…[truncated ${text.length - MAX} chars]`
    : text;
  try {
    await client.capture({
      kind: 'code',
      content,
      source: 'vscode-ext',
      metadata: {
        file: editor.document.fileName,
        languageId: editor.document.languageId,
        lineCount: editor.document.lineCount,
        wholeFile: true,
        ...(truncated ? { truncated: true, originalLength: text.length } : {}),
      },
    });
    lastCapturedAt = Date.now();
    onLastCaptureChange.forEach((fn) => fn());
    vscode.window.setStatusBarMessage('$(check) metu captured file', 2000);
  } catch (e) {
    vscode.window.showErrorMessage(`metu capture failed: ${(e as Error).message}`);
  }
}

async function captureClipboardCmd(client: MetuClient): Promise<void> {
  const text = (await vscode.env.clipboard.readText()).trim();
  if (!text) {
    vscode.window.showWarningMessage('metu: clipboard is empty.');
    return;
  }
  try {
    await client.capture({
      kind: 'text',
      content: text.length > 50_000 ? `${text.slice(0, 50_000)}\n\n…[truncated]` : text,
      source: 'vscode-ext',
      metadata: { fromClipboard: true, length: text.length },
    });
    lastCapturedAt = Date.now();
    onLastCaptureChange.forEach((fn) => fn());
    vscode.window.setStatusBarMessage('$(check) metu captured clipboard', 2000);
  } catch (e) {
    vscode.window.showErrorMessage(`metu capture failed: ${(e as Error).message}`);
  }
}

async function recallCmd(client: MetuClient): Promise<void> {
  const q = await vscode.window.showInputBox({
    prompt: 'Recall from metu memory',
    ignoreFocusOut: true,
  });
  if (!q) return;
  try {
    const hits = await client.recall({ query: q, k: 10 });
    if (hits.length === 0) {
      vscode.window.showInformationMessage('No memories matched.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      hits.map((h) => ({
        label: oneLine(h.content).slice(0, 80) || '(empty)',
        description: `${Math.round(h.score * 100)}%`,
        detail: h.content.slice(0, 280),
        content: h.content,
      })),
      { placeHolder: 'Pick a memory to insert as a comment', matchOnDetail: true },
    );
    if (!pick) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.env.clipboard.writeText(pick.content);
      vscode.window.showInformationMessage('Copied memory to clipboard (no active editor).');
      return;
    }
    const prefix = commentPrefix(editor.document.languageId);
    const block = pick.content
      .split('\n')
      .map((line) => `${prefix} ${line}`)
      .join('\n');
    await editor.edit((b) => b.insert(editor.selection.active, `${block}\n`));
  } catch (e) {
    vscode.window.showErrorMessage(`metu recall failed: ${(e as Error).message}`);
  }
}

let recallPanel: vscode.WebviewPanel | undefined;

function recallPanelCmd(ctx: vscode.ExtensionContext, client: MetuClient): void {
  if (recallPanel) {
    recallPanel.reveal(vscode.ViewColumn.Beside);
    return;
  }
  recallPanel = vscode.window.createWebviewPanel(
    'metuRecall',
    'metu — Recall',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  recallPanel.onDidDispose(() => {
    recallPanel = undefined;
  });
  recallPanel.webview.html = recallPanelHtml();
  recallPanel.webview.onDidReceiveMessage(
    async (msg: { type: string; query?: string; content?: string }) => {
      if (!recallPanel) return;
      if (msg.type === 'search' && msg.query) {
        try {
          const hits = await client.recall({ query: msg.query, k: 12 });
          recallPanel.webview.postMessage({ type: 'results', hits });
        } catch (e) {
          recallPanel.webview.postMessage({ type: 'error', error: (e as Error).message });
        }
      } else if (msg.type === 'insert' && msg.content) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          await vscode.env.clipboard.writeText(msg.content);
          vscode.window.showInformationMessage('Copied to clipboard (no active editor).');
          return;
        }
        const prefix = commentPrefix(editor.document.languageId);
        const block = msg.content
          .split('\n')
          .map((line) => `${prefix} ${line}`)
          .join('\n');
        await editor.edit((b) => b.insert(editor.selection.active, `${block}\n`));
      } else if (msg.type === 'open' && msg.content) {
        // Open in browser via the recall query URL on the web app.
        const apiUrl = vscode.workspace.getConfiguration('metu').get<string>('apiUrl') ?? '';
        if (apiUrl) {
          const url = `${apiUrl.replace(/\/$/, '')}/memory?q=${encodeURIComponent(msg.content.slice(0, 80))}`;
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
    },
    undefined,
    ctx.subscriptions,
  );
}

function recallPanelHtml(): string {
  // Inline CSS + script. Webview CSP allows inline since enableScripts
  // implies a default permissive script-src.
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  body { font: 13px var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  input { width: 100%; padding: 6px 8px; font-size: 13px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; box-sizing: border-box; }
  .hit { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; margin-top: 8px; }
  .hit .meta { font-size: 11px; opacity: 0.7; margin-bottom: 4px; display: flex; gap: 8px; align-items: center; }
  .hit .body { white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow: auto; }
  .actions { margin-top: 6px; display: flex; gap: 6px; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 8px; font-size: 11px; border-radius: 3px; cursor: pointer; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .empty { opacity: 0.6; padding: 16px; text-align: center; }
  .err { color: var(--vscode-errorForeground); margin-top: 8px; }
</style>
</head><body>
<input id="q" placeholder="Recall from metu memory…" autofocus />
<div id="status" class="empty">Type a query and press Enter.</div>
<div id="results"></div>
<script>
  const vscode = acquireVsCodeApi();
  const q = document.getElementById('q');
  const status = document.getElementById('status');
  const results = document.getElementById('results');
  let pending = false;
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && q.value.trim().length >= 2 && !pending) {
      pending = true;
      status.textContent = 'Searching…';
      results.innerHTML = '';
      vscode.postMessage({ type: 'search', query: q.value });
    }
  });
  window.addEventListener('message', (ev) => {
    pending = false;
    const m = ev.data;
    if (m.type === 'error') {
      status.innerHTML = '';
      results.innerHTML = '<div class="err">' + m.error + '</div>';
      return;
    }
    if (m.type === 'results') {
      status.textContent = m.hits.length === 0 ? 'No matches.' : '';
      results.innerHTML = '';
      for (const h of m.hits) {
        const div = document.createElement('div');
        div.className = 'hit';
        const pct = Math.round((h.score || 0) * 100);
        div.innerHTML = '<div class="meta"><span>' + pct + '%</span><span>' + (h.kind || '') + '</span></div>'
          + '<div class="body"></div>'
          + '<div class="actions"><button class="primary" data-act="insert">Insert as comment</button><button data-act="open">Open in browser</button></div>';
        div.querySelector('.body').textContent = h.content;
        div.querySelector('[data-act=insert]').addEventListener('click', () => {
          vscode.postMessage({ type: 'insert', content: h.content });
        });
        div.querySelector('[data-act=open]').addEventListener('click', () => {
          vscode.postMessage({ type: 'open', content: h.content });
        });
        results.appendChild(div);
      }
    }
  });
</script>
</body></html>`;
}

async function resumeCmd(client: MetuClient): Promise<void> {
  try {
    const r = await client.resume();
    if (r.briefings.length === 0) {
      vscode.window.showInformationMessage('No briefings yet.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      r.briefings.map((b) => ({
        label: b.projectName,
        description: b.momentumScore != null ? `${Math.round(b.momentumScore * 100)}%` : undefined,
        detail: b.nextStep.slice(0, 200),
        briefing: b,
      })),
      { placeHolder: `Where to start (${r.since}, ${r.timelineEventCount} events)` },
    );
    if (!pick) return;
    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: `# ${pick.briefing.projectName}\n\n${pick.briefing.briefing}\n`,
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (e) {
    vscode.window.showErrorMessage(`metu resume failed: ${(e as Error).message}`);
  }
}

async function regenerateBriefCmd(client: MetuClient): Promise<void> {
  try {
    const r = await client.resume();
    if (r.briefings.length === 0) {
      vscode.window.showInformationMessage('No projects to refresh.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      r.briefings.map((b) => ({
        label: b.projectName,
        description: b.momentumScore != null ? `${Math.round(b.momentumScore * 100)}%` : undefined,
        detail: 'Regenerate briefing now',
        projectId: b.projectId,
      })),
      { placeHolder: 'Pick a project to regenerate the brief for' },
    );
    if (!pick) return;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `metu: regenerating ${pick.label}…`,
      },
      async () => {
        const out = await client.regenerateBrief(pick.projectId);
        vscode.window.showInformationMessage(
          `Refreshed: ${out.projectName} — ${out.nextStep.slice(0, 140)}`,
        );
      },
    );
  } catch (e) {
    vscode.window.showErrorMessage(`metu regenerate failed: ${(e as Error).message}`);
  }
}

async function notifyCmd(client: MetuClient): Promise<void> {
  const title = await vscode.window.showInputBox({
    prompt: 'Notification title',
    value: 'Hello from VS Code',
    ignoreFocusOut: true,
  });
  if (!title) return;
  try {
    await client.notify({ title, source: 'vscode-ext', urgency: 'normal' });
    vscode.window.showInformationMessage('metu notification sent.');
  } catch (e) {
    vscode.window.showErrorMessage(`metu notify failed: ${(e as Error).message}`);
  }
}

async function companionTurnCmd(client: MetuClient): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selection = editor?.document.getText(editor.selection)?.trim() ?? '';
  const utterance =
    (await vscode.window.showInputBox({
      prompt: 'Ask metu',
      value: selection,
      placeHolder: 'What do you want to do?',
      ignoreFocusOut: true,
    })) ?? '';
  if (!utterance.trim()) return;
  const personaSlug =
    (vscode.workspace.getConfiguration('metu').get<string>('defaultPersona') ?? 'metu').trim() ||
    'metu';
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `metu (${personaSlug})…`,
        cancellable: false,
      },
      () => client.companionTurn({ personaSlug, utterance }),
    );
    if (result.kind === 'local') {
      vscode.window.showInformationMessage(result.text, { modal: false });
    } else {
      vscode.window.showInformationMessage(
        `${result.ack} (escalated — check metu for the full reply)`,
      );
    }
  } catch (e) {
    vscode.window.showErrorMessage(`metu companion failed: ${(e as Error).message}`);
  }
}

async function signInCmd(auth: AuthState): Promise<void> {
  const cfg = readCfg();
  if (cfg.oauthClientId) {
    await deviceFlowSignIn(auth, cfg);
    return;
  }
  // No OAuth client configured → fall back to manual paste flow.
  const choice = await vscode.window.showInformationMessage(
    'Sign in to metu in your browser, then paste your access token here.',
    { modal: false },
    'Open browser',
    'Paste token',
  );
  if (!choice) return;
  if (choice === 'Open browser') {
    await vscode.env.openExternal(vscode.Uri.parse(`${cfg.apiUrl}/settings`));
  }
  const token = await vscode.window.showInputBox({
    prompt: 'Paste your metu access token',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'metu_at_…',
    validateInput: (v) => (v && v.trim().length >= 16 ? null : 'Token looks too short.'),
  });
  if (!token) return;
  await auth.setTokens({ access: token.trim(), refresh: '' });
  vscode.window.showInformationMessage('metu: signed in.');
}

async function signOutCmd(auth: AuthState): Promise<void> {
  if (!auth.token && !auth.refresh) {
    vscode.window.showInformationMessage('metu: already signed out.');
    return;
  }
  await auth.clear();
  vscode.window.showInformationMessage('metu: signed out.');
}

// ─── OAuth device flow (RFC 8628) ──────────────────────────────────────────

interface DeviceAuth {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

async function deviceFlowSignIn(auth: AuthState, cfg: Cfg): Promise<void> {
  let device: DeviceAuth;
  try {
    device = await postForm<DeviceAuth>(`${cfg.apiUrl}/api/oauth/device`, {
      client_id: cfg.oauthClientId,
      scope: cfg.scopes,
    });
  } catch (e) {
    vscode.window.showErrorMessage(`metu device-code request failed: ${(e as Error).message}`);
    return;
  }

  const open = 'Open browser';
  const copy = 'Copy code';
  await vscode.env.clipboard.writeText(device.user_code);
  const ack = await vscode.window.showInformationMessage(
    `metu sign-in code: ${device.user_code}  (copied to clipboard)`,
    { modal: false, detail: `Visit ${device.verification_uri} and approve.` },
    open,
    copy,
  );
  if (ack === open) {
    await vscode.env.openExternal(vscode.Uri.parse(device.verification_uri_complete));
  } else if (ack === copy) {
    await vscode.env.clipboard.writeText(device.user_code);
  }

  const tokens = await vscode.window.withProgress<TokenResponse | null>(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'metu: waiting for browser approval…',
      cancellable: true,
    },
    (_progress, cancel) => pollDeviceToken(cfg, device, cancel),
  );
  if (!tokens) {
    vscode.window.showWarningMessage('metu sign-in cancelled or expired.');
    return;
  }
  await auth.setTokens({
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? '',
  });
  vscode.window.showInformationMessage('metu: signed in via OAuth device flow.');
}

async function pollDeviceToken(
  cfg: Cfg,
  device: DeviceAuth,
  cancel: vscode.CancellationToken,
): Promise<TokenResponse | null> {
  const deadline = Date.now() + device.expires_in * 1000;
  let interval = Math.max(1, device.interval || 5);
  while (Date.now() < deadline) {
    if (cancel.isCancellationRequested) return null;
    await sleep(interval * 1000, cancel);
    if (cancel.isCancellationRequested) return null;
    try {
      return await postForm<TokenResponse>(`${cfg.apiUrl}/api/oauth/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: device.device_code,
        client_id: cfg.oauthClientId,
      });
    } catch (e) {
      const code = (e as OAuthErr).code;
      if (code === 'authorization_pending') continue;
      if (code === 'slow_down') {
        interval += 5;
        continue;
      }
      throw e;
    }
  }
  return null;
}

async function tryRefresh(auth: AuthState): Promise<boolean> {
  const cfg = readCfg();
  if (!cfg.oauthClientId || !auth.refresh) return false;
  try {
    const next = await postForm<TokenResponse>(`${cfg.apiUrl}/api/oauth/token`, {
      grant_type: 'refresh_token',
      refresh_token: auth.refresh,
      client_id: cfg.oauthClientId,
    });
    await auth.setTokens({
      access: next.access_token,
      refresh: next.refresh_token ?? auth.refresh,
    });
    return true;
  } catch {
    return false;
  }
}

interface OAuthErr extends Error {
  code: string;
  status: number;
}

async function postForm<T>(url: string, params: Record<string, string>): Promise<T> {
  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  if (!res.ok) {
    const code =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : `http_${res.status}`;
    const err = new Error(`OAuth error: ${code}`) as OAuthErr;
    err.code = code;
    err.status = res.status;
    throw err;
  }
  return json as T;
}

function sleep(ms: number, cancel?: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    cancel?.onCancellationRequested(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function commentPrefix(languageId: string): string {
  switch (languageId) {
    case 'python':
    case 'shellscript':
    case 'powershell':
    case 'yaml':
    case 'dockerfile':
    case 'ruby':
    case 'r':
    case 'toml':
      return '#';
    case 'sql':
    case 'lua':
    case 'haskell':
      return '--';
    case 'html':
    case 'xml':
    case 'markdown':
      return '<!--';
    default:
      return '//';
  }
}

// ─── Hub WS bridge ─────────────────────────────────────────────────────────
//
// Connects to ${hubUrl}/ws, sends `hello` with kind=vscode_ext, then handles
// `tool.invoke` envelopes for the editor.* family (today: copilot_chat,
// show_message). Reconnects with capped exponential backoff. The Conductor
// reaches us via apps/web/src/lib/device-bridge.ts → hubBroadcast.

type HubStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

interface ToolInvokeMsg {
  type: 'tool.invoke';
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  timeoutSec?: number;
}

interface ToolResultMsg {
  v: 1;
  type: 'tool.result';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const FINGERPRINT_KEY_GLOBAL = 'metu.vscodeExt.fingerprint';

class HubBridge {
  private ws: MetuWebSocket | null = null;
  private retry = 0;
  private cancelled = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private status: HubStatus = 'idle';
  private listeners = new Set<(s: HubStatus) => void>();

  constructor(private auth: AuthState) {}

  statusDot(): string {
    switch (this.status) {
      case 'open':
        return '$(circle-filled)';
      case 'connecting':
        return '$(sync~spin)';
      case 'error':
        return '$(warning)';
      default:
        return '';
    }
  }

  statusLabel(): string {
    return this.status;
  }

  onStatusChange(fn: (s: HubStatus) => void): vscode.Disposable {
    this.listeners.add(fn);
    return new vscode.Disposable(() => this.listeners.delete(fn));
  }

  private setStatus(s: HubStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const l of this.listeners) l(s);
  }

  connect(): void {
    if (!this.auth.token) return;
    if (this.ws) return;
    this.cancelled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.openSocket();
  }

  disconnect(): void {
    this.cancelled = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        /* */
      }
    }
    this.setStatus('idle');
    this.retry = 0;
  }

  dispose(): void {
    this.disconnect();
    this.listeners.clear();
  }

  private openSocket(): void {
    const cfg = readCfg();
    const token = this.auth.token;
    if (!token) return;

    const url = `${cfg.hubUrl.replace(/^http/, 'ws')}/ws`;
    let ws: MetuWebSocket;
    try {
      const Ctor = (globalThis as unknown as { WebSocket?: new (u: string) => MetuWebSocket })
        .WebSocket;
      if (!Ctor) {
        // No WebSocket in this runtime — log once and stop trying.
        console.error('[metu] no global WebSocket; hub bridge disabled');
        this.setStatus('error');
        return;
      }
      ws = new Ctor(url);
    } catch (e) {
      console.error('[metu] WebSocket construction failed', e);
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.setStatus('connecting');

    ws.addEventListener('open', () => {
      this.retry = 0;
      const fingerprint = this.fingerprint();
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'hello',
          accessToken: token,
          kind: 'vscode_ext',
          platform: process.platform,
          name: `VS Code (${vscode.env.appName})`,
          fingerprint,
          version: vscode.extensions.getExtension('metu.metu-vscode')?.packageJSON?.version,
          capabilities: ['tool.invoke', 'editor.copilot_chat', 'editor.show_message'],
        }),
      );
    });

    ws.addEventListener('message', (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
      } catch {
        return;
      }
      const msg = parsed as { type?: string; [k: string]: unknown };
      if (msg.type === 'hello_ack') {
        this.setStatus('open');
        this.startHeartbeat();
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
        return;
      }
      if (msg.type === 'tool.invoke') {
        void this.handleInvoke(ws, msg as unknown as ToolInvokeMsg);
        return;
      }
    });

    ws.addEventListener('close', () => {
      this.ws = null;
      this.setStatus('closed');
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (!this.cancelled) this.scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      this.setStatus('error');
    });
  }

  private scheduleReconnect(): void {
    if (this.cancelled) return;
    if (!this.auth.token) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  /**
   * Periodic activity heartbeat. Sends an `event.device` envelope every
   * 5 minutes carrying a non-content snapshot of the current editor +
   * workspace. The hub persists it to `device_event` and forwards to
   * `/api/internal/hub/device-event` which mirrors into `timeline_event`
   * for the focus/Conductor systems. We never send file content or
   * selection text — only language id, file extension, basename, and
   * workspace folder name. The user can mute via setting `metu.activity.enabled=false`.
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    const send = () => this.sendHeartbeat();
    // First beat immediately, then every 5 minutes.
    void send();
    this.heartbeatTimer = setInterval(send, 5 * 60_000);
  }

  /**
   * Send a one-off device event over the hub WS. Returns silently when
   * the socket is not open or `metu.activity.enabled` is false. Used by
   * terminal + git listeners in `activate()`.
   */
  sendDeviceEvent(kind: string, payload: Record<string, unknown>): void {
    const ws = this.ws;
    if (!ws) return;
    const enabled = vscode.workspace
      .getConfiguration('metu')
      .get<boolean>('activity.enabled', true);
    if (!enabled) return;
    try {
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'event.device',
          kind,
          payload,
          occurredAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* socket may have closed */
    }
  }

  private sendHeartbeat(): void {
    const ws = this.ws;
    if (!ws) return;
    const enabled = vscode.workspace
      .getConfiguration('metu')
      .get<boolean>('activity.enabled', true);
    if (!enabled) return;
    const editor = vscode.window.activeTextEditor;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const payload: Record<string, unknown> = {
      idleSec: 0,
      window: {
        focused: vscode.window.state.focused,
      },
    };
    if (folder) {
      payload.workspace = { name: folder.name };
    }
    if (editor) {
      const doc = editor.document;
      const fsPath = doc.uri.fsPath;
      const baseName = fsPath ? fsPath.replace(/\\/g, '/').split('/').pop() : undefined;
      const ext = baseName?.includes('.') ? baseName.split('.').pop() : undefined;
      payload.editor = {
        languageId: doc.languageId,
        ext,
        baseName,
        lineCount: doc.lineCount,
        scheme: doc.uri.scheme,
      };
    }
    try {
      ws.send(
        JSON.stringify({
          v: 1,
          type: 'event.device',
          kind: 'vscode.activity.heartbeat',
          payload,
          occurredAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* socket may have closed between checks */
    }
  }

  private fingerprint(): string {
    // Stable per-machine UUID. First call generates and caches in
    // SecretStorage (it's not really a secret but it's a convenient
    // per-machine bucket that doesn't sync via Settings Sync).
    const key = FINGERPRINT_KEY_GLOBAL;
    const cached = (globalThis as unknown as Record<string, string | undefined>)[key];
    if (cached) return cached;
    const fp = randomUuid();
    (globalThis as unknown as Record<string, string>)[key] = fp;
    return fp;
  }

  private async handleInvoke(ws: MetuWebSocket, msg: ToolInvokeMsg): Promise<void> {
    let resp: ToolResultMsg;
    try {
      const result = await dispatchEditorTool(msg.tool, msg.args ?? {});
      resp = { v: 1, type: 'tool.result', id: msg.id, ok: true, result };
    } catch (e) {
      resp = {
        v: 1,
        type: 'tool.result',
        id: msg.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    try {
      ws.send(JSON.stringify(resp));
    } catch (e) {
      console.error('[metu] failed to send tool.result', e);
    }
  }
}

// Minimal WebSocket interface — Node 22 + VS Code ≥1.95 ship a global
// `WebSocket`. We declare the surface we use rather than pulling in the
// full DOM lib.
interface MetuWebSocket {
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (ev: { data: string | ArrayBuffer }) => void): void;
  addEventListener(type: 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  send(data: string): void;
  close(): void;
}

function randomUuid(): string {
  // Node 22 has globalThis.crypto.randomUUID.
  const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback — not security-sensitive (just an opaque device id).
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

// ─── Editor tool handlers ──────────────────────────────────────────────────

async function dispatchEditorTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  switch (tool) {
    case 'editor.copilot_chat':
      return runCopilotChat(args);
    case 'editor.show_message':
      return runShowMessage(args);
    default:
      throw new Error(`unknown_editor_tool: ${tool}`);
  }
}

async function runCopilotChat(args: Record<string, unknown>): Promise<{
  text: string;
  modelId: string;
  vendor: string;
  family: string;
}> {
  const cfg = readCfg();
  if (!cfg.copilotBridge) throw new Error('copilot_bridge_disabled_in_settings');
  const lm = (vscode as unknown as { lm?: typeof vscode.lm }).lm;
  if (!lm || typeof lm.selectChatModels !== 'function') {
    throw new Error('vscode_lm_api_unavailable');
  }

  const prompt = String(args.prompt ?? '').trim();
  if (!prompt) throw new Error('prompt_required');
  const system = typeof args.system === 'string' ? args.system : undefined;
  const family = typeof args.family === 'string' ? args.family : undefined;
  const vendor = typeof args.vendor === 'string' && args.vendor ? args.vendor : 'copilot';

  const selector: { vendor?: string; family?: string } = { vendor };
  if (family) selector.family = family;
  const models = await lm.selectChatModels(selector);
  if (models.length === 0) {
    throw new Error(`no_lm_for_selector: vendor=${vendor}${family ? ` family=${family}` : ''}`);
  }
  const model = models[0]!;

  const messages: vscode.LanguageModelChatMessage[] = [];
  // vscode.lm has no System role on stable; prepend system as a User
  // turn marked with name=system for visibility.
  if (system) {
    messages.push(vscode.LanguageModelChatMessage.User(system, 'system'));
  }
  messages.push(vscode.LanguageModelChatMessage.User(prompt));

  const cts = new vscode.CancellationTokenSource();
  const timer = setTimeout(() => cts.cancel(), 60_000);
  let text = '';
  try {
    const response = await model.sendRequest(messages, {}, cts.token);
    for await (const part of response.stream) {
      if (
        part &&
        typeof part === 'object' &&
        'value' in (part as Record<string, unknown>) &&
        typeof (part as { value?: unknown }).value === 'string'
      ) {
        text += (part as { value: string }).value;
      }
    }
  } catch (e) {
    throw new Error(`copilot_request_failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
    cts.dispose();
  }

  return {
    text,
    modelId: model.id,
    vendor: model.vendor,
    family: model.family,
  };
}

async function runShowMessage(args: Record<string, unknown>): Promise<{ ok: true }> {
  const level = args.level === 'warning' || args.level === 'error' ? args.level : 'info';
  const message = String(args.message ?? '').trim();
  if (!message) throw new Error('message_required');
  if (level === 'warning') vscode.window.showWarningMessage(message);
  else if (level === 'error') vscode.window.showErrorMessage(message);
  else vscode.window.showInformationMessage(message);
  return { ok: true };
}
