/**
 * Device bridge — wires the `device.*` tool family to connected devices via
 * the hub's `tool.invoke` ↔ `tool.result` round-trip.
 *
 * Lifecycle:
 *   1. `runTool()` (in @metu/core) calls a device tool's `execute()` with
 *      `ctx.toolCallId` set.
 *   2. The tool calls our registered `dispatcher.invoke()`.
 *   3. We register a pending entry keyed by `toolCallId`, then
 *      `hubBroadcast()` a `tool.invoke` envelope (filtered to
 *      `companion_desktop` kinds).
 *   4. The companion executes the tool and replies with `tool.result` over
 *      the WS. The hub forwards it to `/api/internal/hub/tool-result`.
 *   5. That route handler calls `resolvePendingDeviceTool()` to settle the
 *      promise. The route handler ALSO updates the `tool_call` row, but
 *      `runTool` will overwrite that with its own success/failure write —
 *      both end up consistent.
 *
 * **Same-process requirement:** the awaiter (this file's pending Map) and
 * the resolver (the route handler) must run in the same Node.js process.
 * In dev + single-instance prod that's true. In a horizontally-scaled
 * deployment we'll need a Redis-backed pub/sub; tracked as a slice-10
 * follow-up.
 */
import {
  setDeviceDispatcher,
  type DeviceDispatcher,
  type DeviceDispatchOpts,
} from '@metu/core/agent';
import { hubBroadcast, type DeviceKindFilter } from './hub';

const DEFAULT_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  workspaceId: string;
}

const pending = new Map<string, Pending>();

function settle(toolCallId: string, fn: (p: Pending) => void): boolean {
  const p = pending.get(toolCallId);
  if (!p) return false;
  pending.delete(toolCallId);
  clearTimeout(p.timer);
  fn(p);
  return true;
}

export function resolvePendingDeviceTool(
  toolCallId: string,
  workspaceId: string,
  ok: boolean,
  result: unknown,
  error: string | undefined,
): boolean {
  return settle(toolCallId, (p) => {
    if (p.workspaceId !== workspaceId) {
      // Defence in depth — the hub already authenticates the workspace,
      // but never resolve cross-tenant.
      p.reject(new Error('workspace_mismatch'));
      return;
    }
    if (ok) p.resolve(result);
    else p.reject(new Error(error ?? 'device_tool_failed'));
  });
}

const dispatcher: DeviceDispatcher = {
  async invoke(opts: DeviceDispatchOpts): Promise<unknown> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(opts.toolCallId)) {
          reject(new Error(`device_tool_timeout: ${opts.tool} after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      pending.set(opts.toolCallId, {
        resolve,
        reject,
        timer,
        workspaceId: opts.workspaceId,
      });
    });

    const broadcast = await hubBroadcast({
      workspaceId: opts.workspaceId,
      kinds: opts.deviceId
        ? undefined
        : ((opts.acceptKinds as DeviceKindFilter[] | undefined) ?? ['companion_desktop']),
      deviceIds: opts.deviceId ? [opts.deviceId] : undefined,
      envelope: {
        type: 'tool.invoke',
        id: opts.toolCallId,
        tool: opts.tool,
        args: (opts.args ?? {}) as Record<string, unknown>,
        timeoutSec: Math.ceil(timeoutMs / 1000),
      },
    });

    if (broadcast === null) {
      // Hub not configured — fail fast so the agent learns now.
      settle(opts.toolCallId, (p) => p.reject(new Error('device_bridge_hub_not_configured')));
    } else if (broadcast.delivered === 0) {
      const target =
        opts.acceptKinds && opts.acceptKinds.length > 0 ? opts.acceptKinds.join('|') : 'companion';
      settle(opts.toolCallId, (p) => p.reject(new Error(`device_no_${target}_connected`)));
    }

    return promise;
  },
};

let registered = false;
export function registerDeviceBridge(): void {
  if (registered) return;
  registered = true;
  setDeviceDispatcher(dispatcher);
}

// Auto-register on import. `apps/web/instrumentation.ts` imports this module
// at boot so the dispatcher is live before any agent tick can fire.
registerDeviceBridge();
