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
    <section className="glass-card form-card">
      <header className="form-card__head">
        <div>
          <p className="form-card__title">Ambient sensors</p>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Local-only watchers that emit <code>event.device</code> envelopes. Default deny.
          </p>
        </div>
        <button
          type="button"
          className={`switch ${enabled ? 'switch--on' : ''}`}
          role="switch"
          aria-checked={enabled}
          onClick={toggleEnabled}
        >
          <span className="switch__thumb" />
        </button>
      </header>

      <div className="field-group">
        <label className="field-label" htmlFor="sensors-allowlist">
          Window title allowlist
        </label>
        <p className="field-help">
          One app name per line. Apps NOT in the list emit app-name only; their titles are stripped
          before leaving the device.
        </p>
        <textarea
          id="sensors-allowlist"
          className="field field--area"
          value={settings.titleAllowlist.join('\n')}
          onChange={(e) => setAllowlistText(e.target.value)}
          rows={4}
          placeholder={'Visual Studio Code\nFigma\nNotion'}
        />
      </div>

      <div className="field-group">
        <label className="field-label" htmlFor="sensors-redaction">
          Title redaction (regex)
        </label>
        <p className="field-help">
          Applied to allowed titles as a second line of defense. Invalid patterns are silently
          dropped.
        </p>
        <textarea
          id="sensors-redaction"
          className="field field--area"
          value={settings.redactionPatterns.join('\n')}
          onChange={(e) => setRedactionText(e.target.value)}
          rows={4}
          placeholder={'(?i)password\ntoken=[A-Za-z0-9_-]+'}
        />
      </div>

      <div className="field-group">
        <label className="field-label">File watcher roots</label>
        <p className="field-help">
          Folders the file-watcher observes. Each is opt-in — no global root selection. The watcher
          will refuse paths it cannot read.
        </p>
        <ul className="root-list">
          {settings.fsRoots.length === 0 ? (
            <li className="root-list__empty">No roots yet.</li>
          ) : (
            settings.fsRoots.map((r) => (
              <li key={r} className="root-list__item">
                <code title={r}>{r}</code>
                <button type="button" className="chip chip--danger" onClick={() => removeRoot(r)}>
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="row" style={{ gap: 10, marginTop: 4 }}>
          <button type="button" className="btn-soft" onClick={addRoot}>
            Add folder…
          </button>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.fsRecursive}
              onChange={(e) => update({ fsRecursive: e.target.checked })}
            />
            <span className="checkbox__box" />
            <span className="checkbox__label">Recursive</span>
          </label>
        </div>
      </div>
    </section>
  );
}
