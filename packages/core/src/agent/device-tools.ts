/**
 * Device tool family — `device.*` tools that execute on a connected device
 * (today: companion; later: mobile, vscode-ext).
 *
 * Slice 3 wires the bridge: `setDeviceDispatcher()` is called once on
 * `apps/web` boot from `apps/web/instrumentation.ts`. The bridge inserts a
 * pending entry keyed by `ctx.toolCallId`, broadcasts `tool.invoke` via the
 * hub, and resolves when the matching `tool.result` arrives at
 * `/api/internal/hub/tool-result`.
 *
 * Bridged today: open_url, open_path, notify, clipboard_read,
 * clipboard_write, screenshot, list_windows, a11y_*, see, type_text,
 * send_keys, click, focus_window, move_window, shell_exec, media_key,
 * fs_read, fs_write, fs_list_roots, webcam_snapshot, persona_set,
 * settings_update, observe_window. No remaining stubs in DEVICE_TOOLS.
 *
 * Why kind='high_risk': default ACL resolves to `ask` (D14) so every device
 * action requires confirmation. Read-only tools (`device.list_windows`,
 * `device.a11y_tree`) keep `kind='read'` so callers can opt in to autopilot
 * via tool_acl rows.
 */
import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolKind } from './tools';

// ─── Dispatcher registration (web-only side effect) ───────────────────────

export interface DeviceDispatchOpts {
  workspaceId: string;
  /** The `tool_call.id` row created by `runTool` — used as envelope id. */
  toolCallId: string;
  /** Tool name, e.g. 'device.open_url'. */
  tool: string;
  args: unknown;
  /** Optional device pin; when omitted, the dispatcher fans out to all the
   *  workspace's connections matching `acceptKinds`. */
  deviceId?: string;
  /** When `deviceId` is omitted, restrict the broadcast to these device
   *  kinds. Defaults to `['companion_desktop']` for the `device.*` family;
   *  `editor.*` tools pass `['vscode_ext']`. */
  acceptKinds?: readonly string[];
  /** How long to await the matching `tool.result` before rejecting. */
  timeoutMs?: number;
}

export interface DeviceDispatcher {
  invoke(opts: DeviceDispatchOpts): Promise<unknown>;
}

let _dispatcher: DeviceDispatcher | null = null;

export function setDeviceDispatcher(d: DeviceDispatcher | null): void {
  _dispatcher = d;
}

export function getDeviceDispatcher(): DeviceDispatcher | null {
  return _dispatcher;
}

// ─── Tool execute helpers ─────────────────────────────────────────────────

function bridge<TArgs extends z.ZodTypeAny, TResult = unknown>(
  name: string,
  description: string,
  kind: ToolKind,
  args: TArgs,
): ToolDefinition<TArgs, TResult> {
  return {
    name,
    description,
    kind,
    args,
    async execute(parsedArgs, ctx: ToolContext) {
      const dispatcher = getDeviceDispatcher();
      if (!dispatcher) throw new Error('device_dispatcher_not_registered');
      if (!ctx.toolCallId) throw new Error('device_tool_requires_tool_call_id');
      const result = (await dispatcher.invoke({
        workspaceId: ctx.workspaceId,
        toolCallId: ctx.toolCallId,
        tool: name,
        args: parsedArgs,
      })) as TResult;
      return { result };
    },
  };
}

// ─── Vision / observation ─────────────────────────────────────────────────

export const deviceScreenshotTool = bridge(
  'device.screenshot',
  'Capture a screenshot of the active monitor or a specific window. Returns a base64-encoded PNG.',
  'high_risk',
  z.object({
    target: z.enum(['screen', 'window']).default('screen'),
    windowId: z.string().optional(),
    monitor: z.number().int().nonnegative().optional(),
  }),
);

export const deviceListWindowsTool = bridge(
  'device.list_windows',
  'List currently open OS windows: id, title, app, bounds, focused.',
  'read',
  z.object({}).default({}),
);

export const deviceA11yTreeTool = bridge(
  'device.a11y_tree',
  'Read the accessibility tree of the focused window (or specified windowId). Caps default to depth 6 / 500 nodes; raise via maxDepth/maxNodes.',
  'read',
  z.object({
    windowId: z.string().optional(),
    maxDepth: z.number().int().min(1).max(16).optional(),
    maxNodes: z.number().int().min(10).max(5000).optional(),
  }),
);

/**
 * Companion-Agent slice 1 — semantic UI actions backed by Win UIA / mac AX /
 * Linux AT-SPI. Each takes a predicate (role + name/nameContains) and acts on
 * the first matching node. Higher reliability than coordinate clicks because
 * the system speaks back: a real button press fires its handler even if it
 * is occluded or moved between read and act.
 */
export const deviceA11yFindTool = bridge(
  'device.a11y_find',
  'Find accessibility nodes inside the focused (or specified) window matching a predicate. Returns up to `limit` matches with bounds and supported patterns.',
  'read',
  z.object({
    windowId: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    nameContains: z.string().optional(),
    valueContains: z.string().optional(),
    maxDepth: z.number().int().min(1).max(16).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
);

export const deviceA11yInvokeTool = bridge(
  'device.a11y_invoke',
  'Invoke the first accessibility node matching a predicate (proper UIA InvokePattern; equivalent to a clean button press).',
  'high_risk',
  z.object({
    windowId: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    nameContains: z.string().optional(),
  }),
);

export const deviceA11ySetValueTool = bridge(
  'device.a11y_set_value',
  'Set the value of the first accessibility node matching a predicate (UIA ValuePattern; for text fields, combos, etc.).',
  'high_risk',
  z.object({
    windowId: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    nameContains: z.string().optional(),
    value: z.string(),
  }),
);

/**
 * Companion-Agent slice 5 — vision super-tool. Returns screenshot +
 * window list + focused-window a11y tree in one round trip so the planner
 * can answer "what is the user looking at?" with a single hub envelope.
 * OCR is intentionally left to the vision LLM (modern multimodal models
 * read on-screen text more accurately than tesseract).
 */
export const deviceSeeTool = bridge(
  'device.see',
  'Compose a unified observation: screenshot (PNG b64) + open windows + focused-window accessibility tree. One round trip, ~200ms median. Use this instead of separate screenshot/list_windows/a11y_tree calls when planning a UI action.',
  'high_risk',
  z.object({
    target: z.enum(['screen', 'window']).default('screen'),
    windowId: z.string().optional(),
    monitor: z.number().int().nonnegative().optional(),
    maxDepth: z.number().int().min(1).max(16).optional(),
    maxNodes: z.number().int().min(10).max(5000).optional(),
    skipA11y: z.boolean().default(false),
    skipWindows: z.boolean().default(false),
  }),
);

/**
 * Take periodic screenshots of a window over `durationSec` seconds. The
 * dispatcher gets a generous timeout (durationSec + 30s slack) so the call
 * survives the full capture window. Companion-side this is implemented as a
 * loop over `device_screenshot` to avoid a dedicated streaming envelope; if
 * we ever want true progressive frames they can ship as `tool.progress`
 * envelopes once the protocol grows them.
 *
 * Returns `{ frames: [{tCaptureMs, format, data, width, height}] }`.
 */
export const deviceObserveWindowTool: ToolDefinition<
  z.ZodObject<{
    windowId: z.ZodString;
    durationSec: z.ZodDefault<z.ZodNumber>;
    intervalMs: z.ZodDefault<z.ZodNumber>;
  }>,
  unknown
> = {
  name: 'device.observe_window',
  description:
    'Watch a window for durationSec seconds, capturing a screenshot every intervalMs. Returns an array of frames.',
  kind: 'high_risk',
  args: z.object({
    windowId: z.string().min(1),
    durationSec: z.number().int().min(1).max(120).default(10),
    intervalMs: z.number().int().min(250).max(10_000).default(1_000),
  }),
  async execute(parsedArgs, ctx) {
    const dispatcher = getDeviceDispatcher();
    if (!dispatcher) throw new Error('device_dispatcher_not_registered');
    if (!ctx.toolCallId) throw new Error('device_tool_requires_tool_call_id');
    const a = parsedArgs as { durationSec: number };
    const result = await dispatcher.invoke({
      workspaceId: ctx.workspaceId,
      toolCallId: ctx.toolCallId,
      tool: 'device.observe_window',
      args: parsedArgs,
      timeoutMs: a.durationSec * 1000 + 30_000,
    });
    return { result };
  },
};

export const deviceWebcamSnapshotTool = bridge(
  'device.webcam_snapshot',
  'Capture a single frame from the device webcam. The OS shows a per-session permission prompt the first time. Returns base64-encoded PNG.',
  'high_risk',
  z.object({
    facing: z.enum(['user', 'environment']).default('user'),
  }),
);

// ─── Window management ────────────────────────────────────────────────────

export const deviceFocusWindowTool = bridge(
  'device.focus_window',
  'Bring a window to the foreground.',
  'high_risk',
  z.object({ windowId: z.string() }),
);

export const deviceMoveWindowTool = bridge(
  'device.move_window',
  'Move/resize a window to bounds { x, y, w, h }.',
  'high_risk',
  z.object({
    windowId: z.string(),
    bounds: z.object({
      x: z.number().int(),
      y: z.number().int(),
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    }),
  }),
);

// ─── Open / launch ────────────────────────────────────────────────────────

export const deviceOpenUrlTool = bridge(
  'device.open_url',
  "Open a URL in the user's default browser. SSRF-checked.",
  'high_risk',
  z.object({ url: z.string().url() }),
);

export const deviceOpenPathTool = bridge(
  'device.open_path',
  'Open a file or folder using the OS default handler.',
  'high_risk',
  z.object({ path: z.string().min(1) }),
);

// ─── Synthetic input ──────────────────────────────────────────────────────

export const deviceTypeTextTool = bridge(
  'device.type_text',
  'Type text into the focused field via synthetic keyboard input.',
  'high_risk',
  z.object({
    text: z.string().min(1).max(10_000),
    target: z.literal('focused').default('focused'),
  }),
);

export const deviceSendKeysTool = bridge(
  'device.send_keys',
  'Send an allowlisted key combo (e.g. ["Ctrl","Shift","T"]).',
  'high_risk',
  z.object({ keys: z.array(z.string()).min(1).max(8) }),
);

export const deviceClickTool = bridge(
  'device.click',
  'Click at screen coordinates with the given mouse button.',
  'high_risk',
  z.object({
    x: z.number().int(),
    y: z.number().int(),
    button: z.enum(['left', 'right', 'middle']).default('left'),
  }),
);

// ─── Clipboard ────────────────────────────────────────────────────────────

export const deviceClipboardReadTool = bridge(
  'device.clipboard_read',
  'Read the current text contents of the system clipboard.',
  'high_risk',
  z.object({}).default({}),
);

export const deviceClipboardWriteTool = bridge(
  'device.clipboard_write',
  'Replace the system clipboard with the given text.',
  'high_risk',
  z.object({ text: z.string().max(100_000) }),
);

// ─── Filesystem (jailed) ──────────────────────────────────────────────────

export const deviceFsListRootsTool = bridge(
  'device.fs_list_roots',
  'List the absolute root directories the device has allow-listed for fs_read/fs_write. Use this BEFORE attempting fs_read/fs_write so you propose paths inside the jail.',
  'read',
  z.object({}).default({}),
);

export const deviceFsReadTool = bridge(
  'device.fs_read',
  'Read a UTF-8 text file from one of the user-allow-listed root directories on the device. Caps at 256 KiB and refuses non-UTF-8 content.',
  'high_risk',
  z.object({ path: z.string().min(1) }),
);

export const deviceFsWriteTool = bridge(
  'device.fs_write',
  'Write a UTF-8 text file under one of the user-allow-listed root directories on the device. Caps at 1 MiB. Modes: overwrite (default), append (file must exist), create (file must NOT exist).',
  'high_risk',
  z.object({
    path: z.string().min(1),
    content: z.string(),
    mode: z.enum(['overwrite', 'append', 'create']).default('overwrite'),
  }),
);

// ─── Shell (allowlisted) ──────────────────────────────────────────────────

export const deviceShellExecTool = bridge(
  'device.shell_exec',
  'Execute an allowlisted shell command. Allowlist is workspace-owned and cannot be edited by the agent.',
  'high_risk',
  z.object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  }),
);

// ─── Media + system ──────────────────────────────────────────────────────

export const deviceMediaKeyTool = bridge(
  'device.media_key',
  'Send a media key (play/pause/next/prev/volup/voldn/mute). play and pause both fire the OS MediaPlayPause toggle — there is no separate dedicated key.',
  'low_risk',
  z.object({
    key: z.enum(['play', 'pause', 'next', 'prev', 'volup', 'voldn', 'mute']),
  }),
);

export const deviceNotifyTool = bridge(
  'device.notify',
  'Send an OS-level notification on the device.',
  'low_risk',
  z.object({
    title: z.string().min(1).max(120),
    body: z.string().max(500).optional(),
    urgency: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  }),
);

// ─── Persona + settings ──────────────────────────────────────────────────

/**
 * Pin a different persona on a window. The companion's `usePersonas` module
 * stores the override in process memory and re-renders the form. Pass `slug`
 * (built-in) and the target `form` (defaults to 'pet').
 */
export const devicePersonaSetTool = bridge(
  'device.persona_set',
  'Switch the active persona on a window (pet/hud/panel) by slug.',
  'high_risk',
  z.object({
    slug: z.string().min(1).max(64),
    form: z.enum(['pet', 'hud', 'panel']).optional(),
  }),
);

/**
 * Mutate a single companion-window setting. Today supports HUD/Pet
 * visibility and Pet click-through; new keys are added one-at-a-time so the
 * planner has a tight contract instead of an open patch object.
 */
export const deviceSettingsUpdateTool = bridge(
  'device.settings_update',
  'Update a single window setting (hud_visible, pet_visible, pet_clickthrough).',
  'high_risk',
  z.object({
    kind: z.enum(['hud_visible', 'pet_visible', 'pet_clickthrough']),
    value: z.boolean(),
  }),
);

// ─── Local LLM tunnel (Ollama) ────────────────────────────────────────────

/**
 * Tunnel a single chat completion through the companion to the user's
 * local Ollama instance (`http://localhost:11434`). Lets the conductor
 * use private/local models without exposing them to the public internet.
 *
 * Non-streaming for now — the tool.invoke/tool.result envelope is one
 * shot. Streaming would need protocol-level work (`tool.partial` with
 * incremental decoding).
 */
export const deviceOllamaChatTool = bridge(
  'device.ollama_chat',
  "Chat with the user's local Ollama (http://localhost:11434). Returns the assistant message text. Non-streaming. Use for private/offline LLM calls.",
  'high_risk',
  z.object({
    model: z
      .string()
      .min(1)
      .max(120)
      .describe('Ollama model tag, e.g. "llama3.2" or "qwen2.5:7b".'),
    messages: z
      .array(
        z.object({
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string().min(1),
        }),
      )
      .min(1)
      .max(40),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().max(8192).optional(),
  }),
);

export const DEVICE_TOOLS = {
  'device.screenshot': deviceScreenshotTool,
  'device.list_windows': deviceListWindowsTool,
  'device.a11y_tree': deviceA11yTreeTool,
  'device.a11y_find': deviceA11yFindTool,
  'device.a11y_invoke': deviceA11yInvokeTool,
  'device.a11y_set_value': deviceA11ySetValueTool,
  'device.see': deviceSeeTool,
  'device.observe_window': deviceObserveWindowTool,
  'device.webcam_snapshot': deviceWebcamSnapshotTool,
  'device.focus_window': deviceFocusWindowTool,
  'device.move_window': deviceMoveWindowTool,
  'device.open_url': deviceOpenUrlTool,
  'device.open_path': deviceOpenPathTool,
  'device.type_text': deviceTypeTextTool,
  'device.send_keys': deviceSendKeysTool,
  'device.click': deviceClickTool,
  'device.clipboard_read': deviceClipboardReadTool,
  'device.clipboard_write': deviceClipboardWriteTool,
  'device.fs_read': deviceFsReadTool,
  'device.fs_write': deviceFsWriteTool,
  'device.fs_list_roots': deviceFsListRootsTool,
  'device.shell_exec': deviceShellExecTool,
  'device.media_key': deviceMediaKeyTool,
  'device.notify': deviceNotifyTool,
  'device.persona_set': devicePersonaSetTool,
  'device.settings_update': deviceSettingsUpdateTool,
  'device.ollama_chat': deviceOllamaChatTool,
} as const satisfies Record<string, ToolDefinition<z.ZodTypeAny>>;

export type DeviceToolName = keyof typeof DEVICE_TOOLS;
