/**
 * Sensors settings panel — UI for the window-tracker + file-watcher.
 *
 * Mutates localStorage via `saveSensorSettings` and toggles via
 * `saveSensorsEnabled`. The bridge hook in `App.tsx` watches the same
 * keys and re-issues the Rust commands when the user saves.
 */
import { useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  loadSensorSettings,
  loadSensorsEnabled,
  saveSensorSettings,
  saveSensorsEnabled,
  type SensorSettings,
} from '../state/sensors-bridge';

export function SensorsPanel({ onChange }: { onChange: () => void }) {
  const [enabled, setEnabled] = useState<boolean>(() => loadSensorsEnabled());
  const [settings, setSettings] = useState<SensorSettings>(() => loadSensorSettings());

  const update = (next: Partial<SensorSettings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    saveSensorSettings(merged);
    onChange();
  };

  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    saveSensorsEnabled(next);
    onChange();
  };

  const addRoot = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== 'string') return;
    if (settings.fsRoots.includes(picked)) return;
    update({ fsRoots: [...settings.fsRoots, picked] });
  };

  const removeRoot = (root: string) => {
    update({ fsRoots: settings.fsRoots.filter((r) => r !== root) });
  };

  const setAllowlistText = (text: string) => {
    update({
      titleAllowlist: text
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
  };

  const setRedactionText = (text: string) => {
    update({
      redactionPatterns: text
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    });
  };

  return (
    <section className="card">
      <header className="row between">
        <h2>Ambient sensors</h2>
        <button type="button" className={enabled ? 'btn ok' : 'btn'} onClick={toggleEnabled}>
          {enabled ? 'On' : 'Off'}
        </button>
      </header>
      <p className="muted small">
        Local-only watchers that emit <code>event.device</code> envelopes to metu. Default deny —
        toggle on after you set roots and an allowlist.
      </p>

      <fieldset>
        <legend>Window title allowlist</legend>
        <p className="muted small">
          One app name per line. Apps NOT in the list emit app-name only; their titles are stripped
          before leaving the device.
        </p>
        <textarea
          value={settings.titleAllowlist.join('\n')}
          onChange={(e) => setAllowlistText(e.target.value)}
          rows={4}
          placeholder={'Visual Studio Code\nFigma\nNotion'}
        />
      </fieldset>

      <fieldset>
        <legend>Title redaction (regex)</legend>
        <p className="muted small">
          Applied to allowed titles as a second line of defense. Invalid patterns are silently
          dropped.
        </p>
        <textarea
          value={settings.redactionPatterns.join('\n')}
          onChange={(e) => setRedactionText(e.target.value)}
          rows={4}
          placeholder={'(?i)password\ntoken=[A-Za-z0-9_-]+'}
        />
      </fieldset>

      <fieldset>
        <legend>File watcher roots</legend>
        <p className="muted small">
          Folders the file-watcher observes. Each is opt-in — no global root selection. The watcher
          will refuse paths it cannot read.
        </p>
        <ul className="list">
          {settings.fsRoots.length === 0 ? (
            <li className="muted small">No roots yet.</li>
          ) : (
            settings.fsRoots.map((r) => (
              <li key={r} className="row between">
                <code title={r}>{r}</code>
                <button type="button" className="btn small" onClick={() => removeRoot(r)}>
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="row gap">
          <button type="button" className="btn" onClick={addRoot}>
            Add folder…
          </button>
          <label className="row gap small">
            <input
              type="checkbox"
              checked={settings.fsRecursive}
              onChange={(e) => update({ fsRecursive: e.target.checked })}
            />
            Recursive
          </label>
        </div>
      </fieldset>
    </section>
  );
}
