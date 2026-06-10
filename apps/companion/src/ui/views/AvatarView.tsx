/**
 * AvatarView — inline avatar studio. Replaces the old modal AvatarPicker with
 * a full view: a large live preview on the left, renderer + preset controls on
 * the right. Selection persists via {@link useAvatarSelection} and syncs to the
 * HUD and pet windows automatically.
 */
import { useState } from 'react';
import { useAvatarSelection } from '../../avatar/useAvatarSelection';
import { AvatarHost } from '../../avatar/AvatarHost';
import { ORB_PRESETS } from '../../avatar/orbPresets';
import { VRM_PRESETS } from '../../avatar/vrmPresets';
import type { AvatarKind, AvatarState } from '../../avatar/types';
import { ViewHeader } from '../ViewHeader';

export function AvatarView() {
  const { selection, customVrmUrl, setKind, setOrbPreset, setVrmPreset, setCustomVrmUrl } =
    useAvatarSelection();
  const [customDraft, setCustomDraft] = useState(customVrmUrl ?? '');
  const [previewState, setPreviewState] = useState<AvatarState>('idle');

  const tab = (k: AvatarKind, label: string) => (
    <button
      key={k}
      className={`seg ${selection.kind === k ? 'seg--on' : ''}`}
      onClick={() => setKind(k)}
    >
      {label}
    </button>
  );

  const states: AvatarState[] = ['idle', 'listening', 'speaking', 'thinking'];

  return (
    <div className="view">
      <ViewHeader id="avatar" />

      <div className="avatar-studio">
        <div className="avatar-studio__preview">
          <div className="avatar-studio__stage">
            <AvatarHost state={previewState} size={220} />
          </div>
          <div className="avatar-studio__states">
            {states.map((s) => (
              <button
                key={s}
                className={`chip ${previewState === s ? 'chip--on' : ''}`}
                onClick={() => setPreviewState(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="avatar-studio__controls">
          <div className="seg-group">
            {tab('orb', '✦ Shader orb')}
            {tab('vrm', '☻ 3D avatar')}
          </div>

          {selection.kind === 'orb' ? (
            <div className="orb-grid orb-grid--view">
              {ORB_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`orb-chip ${selection.orbPresetId === p.id ? 'orb-chip--on' : ''}`}
                  onClick={() => setOrbPreset(p.id)}
                  title={p.name}
                >
                  <span
                    className="orb-swatch"
                    style={{
                      background: `radial-gradient(circle at 35% 30%, ${p.core}, ${p.accent} 60%, ${p.glow})`,
                    }}
                  />
                  <span className="orb-chip__name">{p.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="vrm-list">
              {VRM_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`vrm-row ${selection.vrmPresetId === p.id ? 'vrm-row--on' : ''}`}
                  onClick={() => setVrmPreset(p.id)}
                >
                  <span>{p.name}</span>
                  {p.note ? (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {p.note}
                    </span>
                  ) : null}
                </button>
              ))}
              {selection.vrmPresetId === 'custom' && (
                <div className="custom-url">
                  <input
                    value={customDraft}
                    onChange={(e) => setCustomDraft(e.target.value)}
                    placeholder="https://…/model.vrm or file:///C:/…/metu.vrm"
                    className="field"
                  />
                  <button className="btn" onClick={() => setCustomVrmUrl(customDraft || null)}>
                    Use
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
