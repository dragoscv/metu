/**
 * AvatarHost — renders the active avatar (orb, face, VRM, or GLB) based on
 * the persisted selection, and gracefully falls back to the orb when a 3D
 * model fails to load (bad URL, offline, unsupported file).
 *
 * This is the single component the rest of the app mounts; it owns the
 * renderer decision so callers just pass the expressive {@link AvatarDriveProps}.
 */
import { useEffect, useState } from 'react';
import type { AvatarDriveProps } from './types';
import { ShaderOrb } from './ShaderOrb';
import { FaceAvatar } from './FaceAvatar';
import { VrmStage, type VrmStatus } from './VrmStage';
import { GlbStage } from './GlbStage';
import { MetuStage } from './MetuStage';
import { useAvatarSelection } from './useAvatarSelection';
import { resolveVrmUrl } from './vrmPresets';

export function AvatarHost(props: AvatarDriveProps) {
  const { selection, customVrmUrl } = useAvatarSelection();
  const [vrmStatus, setVrmStatus] = useState<VrmStatus>('loading');
  const [glbStatus, setGlbStatus] = useState<VrmStatus>('loading');

  const wantsVrm = selection.kind === 'vrm';
  const vrmUrl = wantsVrm ? resolveVrmUrl(selection.vrmPresetId, customVrmUrl) : null;

  // Reset status when the target model changes.
  useEffect(() => {
    if (vrmUrl) setVrmStatus('loading');
  }, [vrmUrl]);
  useEffect(() => {
    setGlbStatus('loading');
  }, [selection.glbPresetId]);

  const showVrm = wantsVrm && vrmUrl && vrmStatus !== 'error';
  const showGlb = selection.kind === 'glb' && glbStatus !== 'error';
  const showFace = selection.kind === 'face';
  const showMetu = selection.kind === 'metu';
  const modelLoading = (showVrm && vrmStatus === 'loading') || (showGlb && glbStatus === 'loading');

  return (
    <div style={{ position: 'relative', width: props.size, height: props.size }}>
      {showMetu ? (
        <MetuStage {...props} paletteId={selection.metuPaletteId} />
      ) : showVrm ? (
        <VrmStage {...props} modelUrl={vrmUrl} onStatus={setVrmStatus} />
      ) : showGlb ? (
        <GlbStage {...props} presetId={selection.glbPresetId} onStatus={setGlbStatus} />
      ) : showFace ? (
        <FaceAvatar {...props} presetId={selection.facePresetId} />
      ) : (
        <ShaderOrb {...props} presetId={selection.orbPresetId} />
      )}
      {modelLoading ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
          }}
        >
          {/* orb shows underneath as the loading visual */}
          <ShaderOrb {...props} presetId={selection.orbPresetId} size={(props.size ?? 200) * 0.6} />
        </div>
      ) : null}
    </div>
  );
}
