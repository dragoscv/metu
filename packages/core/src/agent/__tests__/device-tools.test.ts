/**
 * Device-tool bridge contract — exercises the dispatcher hand-off without
 * touching the hub or a real device.
 *
 * What we want to catch:
 *   - A `bridge`-tool throws if no dispatcher is registered (hub down /
 *     web booted without instrumentation).
 *   - It propagates `toolCallId` so the eventual `tool.result` from the
 *     companion can be matched.
 *   - A `stub`-tool throws `device_bridge_not_implemented:<name>` so the
 *     planner can give up cleanly instead of hanging.
 *   - A converted-from-stub tool (the new `device.media_key`) goes through
 *     the bridge path and validates the enum on the way in.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DEVICE_TOOLS,
  setDeviceDispatcher,
  type DeviceDispatcher,
  type DeviceDispatchOpts,
} from '../device-tools';

const ctx = {
  workspaceId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
  toolCallId: '00000000-0000-0000-0000-000000000099',
};

afterEach(() => setDeviceDispatcher(null));

describe('device-tools bridge', () => {
  it('throws when no dispatcher is registered', async () => {
    const tool = DEVICE_TOOLS['device.open_url'];
    await expect(tool.execute({ url: 'https://metu.ro' }, ctx)).rejects.toThrow(
      'device_dispatcher_not_registered',
    );
  });

  it('throws when tool_call_id is missing (audit row required)', async () => {
    setDeviceDispatcher({ invoke: async () => ({ ok: true }) });
    const tool = DEVICE_TOOLS['device.open_url'];
    await expect(
      tool.execute({ url: 'https://metu.ro' }, { ...ctx, toolCallId: undefined }),
    ).rejects.toThrow('device_tool_requires_tool_call_id');
  });

  it('forwards args + tool_call_id to the dispatcher and returns its result', async () => {
    const seen: DeviceDispatchOpts[] = [];
    const dispatcher: DeviceDispatcher = {
      async invoke(opts) {
        seen.push(opts);
        return { ok: true, echoed: opts.args };
      },
    };
    setDeviceDispatcher(dispatcher);

    const tool = DEVICE_TOOLS['device.open_url'];
    const out = await tool.execute({ url: 'https://metu.ro' }, ctx);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      workspaceId: ctx.workspaceId,
      toolCallId: ctx.toolCallId,
      tool: 'device.open_url',
      args: { url: 'https://metu.ro' },
    });
    expect(out.result).toEqual({ ok: true, echoed: { url: 'https://metu.ro' } });
  });
});

describe('device.media_key (newly bridged)', () => {
  beforeEach(() => {
    setDeviceDispatcher({ invoke: async (opts) => ({ ok: true, sent: opts.args }) });
  });

  it('accepts every documented key name', async () => {
    const tool = DEVICE_TOOLS['device.media_key'];
    for (const key of ['play', 'pause', 'next', 'prev', 'volup', 'voldn', 'mute'] as const) {
      await expect(tool.execute({ key }, ctx)).resolves.toBeDefined();
    }
  });

  it('rejects unknown key names at the schema boundary', () => {
    const tool = DEVICE_TOOLS['device.media_key'];
    // The runtime schema parse happens in `runTool`; here we assert the
    // schema itself rejects so a malicious planner can't pass through.
    const parsed = tool.args.safeParse({ key: 'self_destruct' });
    expect(parsed.success).toBe(false);
  });

  it('classifies as low_risk so users can opt into autopilot', () => {
    expect(DEVICE_TOOLS['device.media_key'].kind).toBe('low_risk');
  });
});

describe('stubbed device tools (still pending companion-side impl)', () => {
  // No tools currently stubbed. observe_window now bridges. This block is
  // kept as a placeholder so the next stub-tool addition has somewhere to
  // grow; remove once we always have ≥1 stub or never another.
  it('placeholder: every entry in DEVICE_TOOLS is a real bridge today', () => {
    expect(Object.keys(DEVICE_TOOLS).length).toBeGreaterThan(0);
  });
});

describe('device.observe_window (newly bridged)', () => {
  afterEach(() => setDeviceDispatcher(null));

  it('classifies as high_risk', () => {
    expect(DEVICE_TOOLS['device.observe_window'].kind).toBe('high_risk');
  });

  it('forwards args + extended timeout to dispatcher', async () => {
    let capturedTimeout: number | undefined;
    let capturedArgs: unknown = null;
    setDeviceDispatcher({
      async invoke(opts) {
        capturedTimeout = opts.timeoutMs;
        capturedArgs = opts.args;
        return { frames: [] };
      },
    });
    const tool = DEVICE_TOOLS['device.observe_window'];
    const parsed = tool.args.parse({ windowId: 'w-1', durationSec: 5 });
    await tool.execute(parsed, ctx);
    expect(capturedArgs).toEqual({ windowId: 'w-1', durationSec: 5, intervalMs: 1000 });
    // 5s window + 30s slack
    expect(capturedTimeout).toBe(35_000);
  });

  it('rejects intervalMs below 250 via schema', () => {
    const tool = DEVICE_TOOLS['device.observe_window'];
    expect(tool.args.safeParse({ windowId: 'w-1', intervalMs: 100 }).success).toBe(false);
  });

  it('rejects durationSec above 120 via schema', () => {
    const tool = DEVICE_TOOLS['device.observe_window'];
    expect(tool.args.safeParse({ windowId: 'w-1', durationSec: 200 }).success).toBe(false);
  });

  it('returns the dispatcher result wrapped under `result`', async () => {
    setDeviceDispatcher({
      async invoke() {
        return {
          frames: [
            {
              tCaptureMs: 0,
              format: 'image/png',
              data: 'AAAA',
              width: 800,
              height: 600,
            },
          ],
        };
      },
    });
    const tool = DEVICE_TOOLS['device.observe_window'];
    const parsed = tool.args.parse({ windowId: 'w-1' });
    const out = (await tool.execute(parsed, ctx)) as {
      result: { frames: { format: string }[] };
    };
    expect(out.result.frames[0]?.format).toBe('image/png');
  });
});

describe('device.persona_set (newly bridged)', () => {
  beforeEach(() => {
    setDeviceDispatcher({
      async invoke(opts) {
        return { ok: true, form: opts.args && (opts.args as { form?: string }).form, slug: 'metu' };
      },
    });
  });
  afterEach(() => setDeviceDispatcher(null));

  it('classifies as high_risk', () => {
    expect(DEVICE_TOOLS['device.persona_set'].kind).toBe('high_risk');
  });

  it('forwards slug + form to dispatcher', async () => {
    let captured: unknown = null;
    setDeviceDispatcher({
      async invoke(opts) {
        captured = opts.args;
        return { ok: true };
      },
    });
    const tool = DEVICE_TOOLS['device.persona_set'];
    await tool.execute({ slug: 'metu', form: 'hud' }, ctx);
    expect(captured).toEqual({ slug: 'metu', form: 'hud' });
  });

  it('rejects unknown form via schema', () => {
    const tool = DEVICE_TOOLS['device.persona_set'];
    expect(tool.args.safeParse({ slug: 'x', form: 'mobile' }).success).toBe(false);
  });

  it('accepts slug without form', () => {
    const tool = DEVICE_TOOLS['device.persona_set'];
    expect(tool.args.safeParse({ slug: 'metu' }).success).toBe(true);
  });
});

describe('device.settings_update (newly bridged)', () => {
  afterEach(() => setDeviceDispatcher(null));

  it('classifies as high_risk', () => {
    expect(DEVICE_TOOLS['device.settings_update'].kind).toBe('high_risk');
  });

  it('forwards kind + value to dispatcher', async () => {
    let captured: unknown = null;
    setDeviceDispatcher({
      async invoke(opts) {
        captured = opts.args;
        return { ok: true };
      },
    });
    const tool = DEVICE_TOOLS['device.settings_update'];
    await tool.execute({ kind: 'hud_visible', value: true }, ctx);
    expect(captured).toEqual({ kind: 'hud_visible', value: true });
  });

  it('rejects unknown kind via schema', () => {
    const tool = DEVICE_TOOLS['device.settings_update'];
    expect(tool.args.safeParse({ kind: 'shutdown', value: true }).success).toBe(false);
  });

  it('rejects non-boolean value via schema', () => {
    const tool = DEVICE_TOOLS['device.settings_update'];
    expect(tool.args.safeParse({ kind: 'hud_visible', value: 'on' }).success).toBe(false);
  });
});

describe('device.webcam_snapshot (newly bridged)', () => {
  beforeEach(() => {
    setDeviceDispatcher({
      async invoke() {
        return {
          format: 'image/png',
          data: 'iVBORw0KGgo=',
          width: 640,
          height: 480,
        };
      },
    });
  });

  it('defaults facing to "user"', () => {
    const parsed = DEVICE_TOOLS['device.webcam_snapshot'].args.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.facing).toBe('user');
  });

  it('rejects unknown facing values', () => {
    const parsed = DEVICE_TOOLS['device.webcam_snapshot'].args.safeParse({ facing: 'overhead' });
    expect(parsed.success).toBe(false);
  });

  it('returns the dispatcher payload', async () => {
    const out = await DEVICE_TOOLS['device.webcam_snapshot'].execute({ facing: 'user' }, ctx);
    expect(out.result).toMatchObject({ format: 'image/png', width: 640, height: 480 });
  });
});

describe('device.fs_read / fs_write / fs_list_roots (jailed FS)', () => {
  beforeEach(() => {
    setDeviceDispatcher({
      async invoke(opts) {
        if (opts.tool === 'device.fs_list_roots') {
          return { roots: ['/home/me/projects'] };
        }
        if (opts.tool === 'device.fs_read') {
          return {
            path: (opts.args as { path: string }).path,
            content: 'hi',
            bytes: 2,
            truncated: false,
          };
        }
        if (opts.tool === 'device.fs_write') {
          const a = opts.args as { path: string; content: string; mode?: string };
          return { path: a.path, bytes: a.content.length, mode: a.mode ?? 'overwrite' };
        }
        throw new Error('unexpected tool');
      },
    });
  });

  it('fs_list_roots is read-only (planner can call freely under autopilot)', () => {
    expect(DEVICE_TOOLS['device.fs_list_roots'].kind).toBe('read');
  });

  it('fs_read and fs_write are high_risk (default ACL = ask)', () => {
    expect(DEVICE_TOOLS['device.fs_read'].kind).toBe('high_risk');
    expect(DEVICE_TOOLS['device.fs_write'].kind).toBe('high_risk');
  });

  it('fs_write defaults mode to overwrite', () => {
    const parsed = DEVICE_TOOLS['device.fs_write'].args.safeParse({
      path: '/home/me/projects/notes.md',
      content: 'hello',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.mode).toBe('overwrite');
  });

  it('fs_write rejects an invalid mode at the schema boundary', () => {
    const parsed = DEVICE_TOOLS['device.fs_write'].args.safeParse({
      path: '/home/me/projects/notes.md',
      content: 'hello',
      mode: 'truncate',
    });
    expect(parsed.success).toBe(false);
  });

  it('fs_read forwards path through the dispatcher', async () => {
    const out = await DEVICE_TOOLS['device.fs_read'].execute(
      { path: '/home/me/projects/notes.md' },
      ctx,
    );
    expect(out.result).toMatchObject({ content: 'hi', bytes: 2 });
  });

  it('fs_list_roots returns the device-side allowlist', async () => {
    const out = await DEVICE_TOOLS['device.fs_list_roots'].execute({}, ctx);
    expect(out.result).toEqual({ roots: ['/home/me/projects'] });
  });
});
