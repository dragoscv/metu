/**
 * GlbStage — animated glTF/GLB character renderer (game characters + pets).
 *
 * The VRM pipeline requires humanoid rigs; this stage renders *anything*:
 * quadrupeds, birds, robots. It auto-fits the camera to the model's bounding
 * box, plays the model's AnimationMixer clips, and maps the shared
 * {@link AvatarDriveProps} state to per-preset clip names (e.g. the Fox
 * surveys while idle and walks while "speaking"). Models without multiple
 * clips just loop their first one.
 *
 * Loading/error surface through `onStatus` exactly like VrmStage so the
 * AvatarHost can fall back to the orb when a URL is bad/offline.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AvatarDriveProps, AvatarState } from './types';
import { getGlbPreset } from './glbPresets';
import { reportFootOffset } from './footAnchor';
import type { VrmStatus } from './VrmStage';

export function GlbStage({
  presetId,
  state,
  locomotion,
  facing,
  size = 220,
  onStatus,
  anchor = false,
}: AvatarDriveProps & {
  presetId: string;
  onStatus?: (s: VrmStatus) => void;
  /** Only the main desktop stage reports the foot anchor (see footAnchor.ts). */
  anchor?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driveRef = useRef({ state, locomotion, facing });
  driveRef.current.state = state;
  driveRef.current.locomotion = locomotion;
  driveRef.current.facing = facing;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const preset = getGlbPreset(presetId);
    let raf = 0;
    let disposed = false;
    onStatus?.('loading');

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 2, 1.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x90b4ff, 0.7);
    rim.position.set(-1.5, 1, -1.5);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));

    let mixer: THREE.AnimationMixer | null = null;
    let clipsByState: Partial<Record<AvatarState, THREE.AnimationClip>> = {};
    let locoClips: Partial<
      Record<
        'walking' | 'jumping' | 'falling' | 'climbing' | 'sitting' | 'teleporting',
        THREE.AnimationClip
      >
    > = {};
    let fallbackClip: THREE.AnimationClip | null = null;
    let activeAction: THREE.AnimationAction | null = null;
    let root: THREE.Object3D | null = null;
    let lastClipKey: string | null = null;
    let baseY = 0;

    const pickClip = (clips: THREE.AnimationClip[], names?: string[]) => {
      if (!names) return null;
      for (const n of names) {
        const found = clips.find((c) => c.name.toLowerCase() === n.toLowerCase());
        if (found) return found;
      }
      return null;
    };

    const loader = new GLTFLoader();
    loader
      .loadAsync(preset.url)
      .then((gltf) => {
        if (disposed) return;
        root = gltf.scene;

        // Auto-fit: center the model and pull the camera back so the whole
        // bounding sphere is in frame regardless of model scale (the Fox is
        // ~90 units tall, the Soldier ~1.8).
        scene.add(root);

        const clips = gltf.animations ?? [];
        fallbackClip = clips[0] ?? null;
        clipsByState = {
          idle: pickClip(clips, preset.clips?.idle) ?? fallbackClip ?? undefined,
          listening: pickClip(clips, preset.clips?.listening) ?? undefined,
          speaking: pickClip(clips, preset.clips?.speaking) ?? undefined,
          thinking: pickClip(clips, preset.clips?.thinking) ?? undefined,
        };
        // Locomotion clips by common names (RobotExpressive: Walking/Jump;
        // Fox: Walk/Run). Climb falls back to walk (vertical via window).
        locoClips = {
          walking: pickClip(clips, ['Walking', 'Walk', 'Run', 'Running']) ?? undefined,
          jumping: pickClip(clips, ['Jump', 'Jumping']) ?? undefined,
          falling: pickClip(clips, ['Jump', 'Falling', 'Fall']) ?? undefined,
          climbing: pickClip(clips, ['Climb', 'Climbing', 'Walking', 'Walk']) ?? undefined,
          sitting: pickClip(clips, ['Sitting', 'Sit', 'Idle']) ?? undefined,
        };
        if (clips.length) mixer = new THREE.AnimationMixer(root);

        // Fit the camera AFTER posing the first frame of the idle clip —
        // the bind-pose bounding box can be wildly different from the
        // animated pose (T-pose arms, walk cycles), which cropped models.
        if (mixer) {
          const first = clipsByState.idle ?? fallbackClip;
          if (first) {
            const a = mixer.clipAction(first);
            a.play();
            mixer.update(0); // pose frame 0
            activeAction = a;
            lastClipKey = driveRef.current.state === 'idle' ? 'idle' : null;
          }
        }
        const box = new THREE.Box3().setFromObject(root);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        root.position.sub(sphere.center); // center at origin
        if (preset.yaw) root.rotation.y = preset.yaw;
        baseY = root.position.y;
        const margin = preset.fitMargin ?? 1.4;
        const dist = (sphere.radius * margin) / Math.sin((camera.fov * Math.PI) / 360);
        camera.position.set(0, sphere.radius * 0.1, dist);
        camera.lookAt(0, 0, 0);
        // Report the foot anchor: project the model's lowest point to the
        // canvas, convert to distance-from-window-bottom (logical px) so
        // the physics puts these feet exactly on platforms.
        setTimeout(() => {
          if (disposed || !root || !anchor) return;
          const fitBox = new THREE.Box3().setFromObject(root);
          const feet = new THREE.Vector3(0, fitBox.min.y, 0);
          feet.project(camera);
          const feetCanvasY = ((1 - feet.y) / 2) * size;
          const rect = canvas.getBoundingClientRect();
          const feetViewportY = rect.top + (feetCanvasY / size) * rect.height;
          reportFootOffset(window.innerHeight - feetViewportY);
        }, 100);
        onStatus?.('ready');
      })
      .catch(() => {
        if (!disposed) onStatus?.('error');
      });

    const clock = new THREE.Clock();

    const tick = () => {
      if (disposed) return;
      const delta = clock.getDelta();
      const t = clock.getElapsedTime();
      const s = driveRef.current.state;
      const loco = driveRef.current.locomotion ?? 'idle';

      // Locomotion takes priority over expressive state: when the body is
      // walking/jumping/climbing the legs must match the motion; expressive
      // clips (speak/think) play when stationary.
      const clipKey = loco !== 'idle' ? loco : s;

      if (mixer && clipKey !== lastClipKey) {
        lastClipKey = clipKey;
        const clip =
          (loco !== 'idle' ? locoClips[loco] : clipsByState[s]) ??
          clipsByState.idle ??
          fallbackClip;
        if (clip) {
          const next = mixer.clipAction(clip);
          if (next !== activeAction) {
            next.reset().fadeIn(0.3).play();
            activeAction?.fadeOut(0.3);
            activeAction = next;
          }
        }
      }
      mixer?.update(delta);

      if (root) {
        // Gentle bob + sway so even single-clip models feel alive; perk up
        // slightly while listening, dip while thinking. Suppressed while
        // moving (the locomotion clip owns the motion).
        const lift = s === 'listening' ? 0.015 : s === 'thinking' ? -0.01 : 0;
        const target = baseY + (loco === 'idle' ? Math.sin(t * 1.4) * 0.004 + lift : 0);
        root.position.y += (target - root.position.y) * 0.08;
        // Face the travel direction: profile view while moving, sway idle.
        const face = driveRef.current.facing ?? 1;
        const movingYaw = (preset.yaw ?? 0) + (face === 1 ? Math.PI / 2 : -Math.PI / 2);
        const idleYaw = (preset.yaw ?? 0) + Math.sin(t * 0.4) * (s === 'listening' ? 0.04 : 0.1);
        const wantYaw = loco === 'walking' || loco === 'climbing' ? movingYaw : idleYaw;
        // Shortest-path ease toward the desired yaw.
        let dy = wantYaw - root.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        root.rotation.y += dy * 0.15;
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      mixer?.stopAllAction();
      if (root) {
        scene.remove(root);
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m?.dispose?.();
        });
      }
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, size]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: size, height: size }} />;
}
