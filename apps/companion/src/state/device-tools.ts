/**
 * Companion-side device tool dispatcher.
 *
 * Slice 3 implements 5 tools using Tauri's JS plugin APIs:
 *   - `device.open_url`         → @tauri-apps/plugin-shell `open()`
 *   - `device.open_path`        → @tauri-apps/plugin-shell `open()` (handles paths on all OSes)
 *   - `device.notify`           → @tauri-apps/plugin-notification `sendNotification()`
 *   - `device.clipboard_read`   → @tauri-apps/plugin-clipboard-manager `readText()`
 *   - `device.clipboard_write`  → @tauri-apps/plugin-clipboard-manager `writeText()`
 *
 * Anything else throws `device_tool_not_implemented` and the web side will
 * receive `{ok:false, error:'device_tool_not_implemented: <tool>'}` — the
 * Conductor learns immediately rather than hanging.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@tauri-apps/api/core';
import { setPersonaOverride, type PersonaForm } from './usePersonas';

type DeviceToolArgs = Record<string, unknown>;

function asString(args: DeviceToolArgs, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing or invalid arg: ${key}`);
  }
  return v;
}

/**
 * One-shot webcam snapshot. Uses the webview's MediaDevices API — the OS
 * shows its camera permission prompt the first time per session. We grab a
 * single frame, encode as PNG b64, and tear the stream down so the camera
 * indicator turns off immediately. Cap is the natural video resolution
 * (typically 640×480 or 1280×720); the planner doesn't need 4K.
 */
async function captureWebcamSnapshot(
  args: DeviceToolArgs,
): Promise<{ format: 'image/png'; data: string; width: number; height: number }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('webcam_unavailable: no MediaDevices');
  }
  const facing = typeof args.facing === 'string' ? args.facing : 'user';
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing },
    audio: false,
  });
  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    // Wait for at least one frame so width/height are non-zero. The
    // 'loadeddata' event fires once decoded video data is available.
    if (video.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('webcam_timeout')), 5_000);
        video.addEventListener(
          'loadeddata',
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
    }
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) throw new Error('webcam_canvas_unavailable');
    ctx2d.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/png');
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    return { format: 'image/png', data: b64, width: w, height: h };
  } finally {
    for (const t of stream.getTracks()) t.stop();
  }
}

export async function executeDeviceTool(tool: string, args: DeviceToolArgs): Promise<unknown> {
  switch (tool) {
    case 'device.open_url': {
      const url = asString(args, 'url');
      // Defence in depth — the web `runTool` validates the URL already, but
      // double-check the scheme on the device too.
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        throw new Error(`disallowed_url_scheme: ${u.protocol}`);
      }
      await shellOpen(url);
      return { ok: true };
    }
    case 'device.open_path': {
      const path = asString(args, 'path');
      await shellOpen(path);
      return { ok: true };
    }
    case 'device.notify': {
      const title = asString(args, 'title');
      const body = typeof args.body === 'string' ? args.body : '';
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      if (!granted) throw new Error('notification_permission_denied');
      await sendNotification({ title, body });
      return { ok: true };
    }
    case 'device.clipboard_read': {
      const text = await readText();
      return { text: text ?? '' };
    }
    case 'device.clipboard_write': {
      const text = asString(args, 'text');
      await writeText(text);
      return { ok: true };
    }
    // ── Slice 6 — sensory (Rust commands) ────────────────────────────────
    case 'device.screenshot': {
      // Pass-through to the Rust handler; it knows how to validate.
      return await invoke('device_screenshot', { args });
    }
    case 'device.list_windows': {
      return await invoke('device_list_windows');
    }
    case 'device.a11y_tree': {
      return await invoke('device_a11y_tree', { args });
    }
    case 'device.a11y_find': {
      return await invoke('device_a11y_find', { args });
    }
    case 'device.a11y_invoke': {
      return await invoke('device_a11y_invoke', { args });
    }
    case 'device.a11y_set_value': {
      return await invoke('device_a11y_set_value', { args });
    }
    // ── Slice 5 (companion-agent) — vision composition ───────────────────
    case 'device.see': {
      return await invoke('device_see', { args });
    }
    // ── Slice 7 — synthetic input + shell allowlist (Rust commands) ───────
    case 'device.type_text': {
      return await invoke('device_type_text', { args });
    }
    case 'device.send_keys': {
      return await invoke('device_send_keys', { args });
    }
    case 'device.click': {
      return await invoke('device_click', { args });
    }
    case 'device.media_key': {
      return await invoke('device_media_key', { args });
    }
    case 'device.fs_read': {
      return await invoke('device_fs_read', { args });
    }
    case 'device.fs_write': {
      return await invoke('device_fs_write', { args });
    }
    case 'device.fs_list_roots': {
      return await invoke('device_fs_list_roots');
    }
    case 'device.webcam_snapshot': {
      return await captureWebcamSnapshot(args);
    }
    case 'device.observe_window': {
      const windowId = asString(args, 'windowId');
      const durationSec = typeof args.durationSec === 'number' ? args.durationSec : 10;
      const intervalMs = typeof args.intervalMs === 'number' ? args.intervalMs : 1000;
      const start = Date.now();
      const deadline = start + durationSec * 1000;
      const frames: Array<{
        tCaptureMs: number;
        format: 'image/png';
        data: string;
        width: number;
        height: number;
      }> = [];
      // Bound the loop hard so a misconfigured intervalMs never floods.
      const maxFrames = Math.min(60, Math.ceil((durationSec * 1000) / intervalMs) + 1);
      for (let i = 0; i < maxFrames && Date.now() < deadline; i++) {
        const tCaptureMs = Date.now() - start;
        const shot = (await invoke('device_screenshot', {
          args: { target: 'window', windowId },
        })) as { format: 'image/png'; data: string; width: number; height: number };
        frames.push({ tCaptureMs, ...shot });
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise((r) => setTimeout(r, Math.min(intervalMs, remaining)));
      }
      return { frames };
    }
    case 'device.shell_exec': {
      return await invoke('device_shell_exec', { args });
    }
    // ── Slice 7b — native window focus / move (Windows only for now) ────────
    case 'device.focus_window': {
      return await invoke('device_focus_window', { args });
    }
    case 'device.move_window': {
      return await invoke('device_move_window', { args });
    }
    case 'device.persona_set': {
      const slug = asString(args, 'slug');
      const formArg = typeof args.form === 'string' ? args.form : 'pet';
      if (formArg !== 'pet' && formArg !== 'hud' && formArg !== 'panel') {
        throw new Error(`invalid_form: ${formArg}`);
      }
      setPersonaOverride(formArg as PersonaForm, slug);
      return { ok: true, form: formArg, slug };
    }
    case 'device.settings_update': {
      const kind = asString(args, 'kind');
      switch (kind) {
        case 'hud_visible': {
          const value = args.value === true;
          await invoke(value ? 'presence_hud_show' : 'presence_hud_hide');
          return { ok: true, kind, value };
        }
        case 'pet_visible': {
          const value = args.value === true;
          await invoke(value ? 'presence_pet_show' : 'presence_pet_hide');
          return { ok: true, kind, value };
        }
        case 'pet_clickthrough': {
          const enabled = args.value === true;
          await invoke('presence_pet_set_clickthrough', { enabled });
          return { ok: true, kind, value: enabled };
        }
        default:
          throw new Error(`invalid_settings_kind: ${kind}`);
      }
    }
    default:
      throw new Error(`device_tool_not_implemented: ${tool}`);
  }
}
