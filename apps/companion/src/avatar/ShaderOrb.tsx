/**
 * ShaderOrb — the signature "metu" being.
 *
 * A single icosphere with a custom GLSL material: simplex-noise vertex
 * displacement (the orb "breathes" and roils), a fresnel rim for depth, and a
 * palette driven entirely by the active {@link OrbPreset}. An additive halo
 * sprite behind it gives bloom-like glow without a postprocessing pass (cheap
 * enough for an always-on desktop pet).
 *
 * State drives motion, not geometry:
 *   - idle      → slow breath, gentle turbulence
 *   - listening → tighter, faster ripples + cool shift
 *   - speaking  → amplitude-reactive pulse + accent color push
 *   - thinking  → slow swirl + dim
 *
 * Raw three.js (no R3F) to match VrmAvatar.tsx and keep the dependency
 * surface minimal. Cleans up its GL context on unmount.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { AvatarDriveProps } from './types';
import { getOrbPreset, ORB_STYLE_CODE, type OrbPreset } from './orbPresets';

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uTurb;
  uniform float uAmp;
  uniform float uState; // 0 idle,1 listening,2 speaking,3 thinking
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vDisp;

  // ── simplex noise (Ashima) ──
  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + 1.0 * C.xxx;
    vec3 x2 = x0 - i2 + 2.0 * C.xxx;
    vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  void main() {
    vNormal = normalize(normalMatrix * normal);
    float speed = (uState == 1.0) ? 1.8 : (uState == 2.0 ? 2.4 : (uState == 3.0 ? 0.6 : 1.0));
    float freq = 1.6 + uTurb * 2.2;
    float t = uTime * speed;
    float n = snoise(normal * freq + vec3(0.0, t * 0.4, 0.0));
    n += 0.5 * snoise(normal * freq * 2.0 - vec3(t * 0.3, 0.0, 0.0));
    float amp = 0.18 * uTurb + uAmp * 0.5;
    float disp = n * amp + sin(uTime * 1.4) * 0.02;
    vDisp = disp;
    vec3 displaced = position + normal * disp;
    vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
    vViewPos = -mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCore;
  uniform vec3 uAccent;
  uniform float uTime;
  uniform float uRefraction;
  uniform float uState;
  uniform float uAmp;
  uniform float uStyle;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying float vDisp;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewPos);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.2);

    // base gradient core→accent by displacement + fresnel
    float mixv = clamp(0.5 + vDisp * 2.5 + fres * 0.6, 0.0, 1.0);
    vec3 col = mix(uCore, uAccent, mixv);

    // crystal style: sharper banded refraction
    if (uStyle == 2.0) {
      float band = fract(fres * (3.0 + uRefraction * 6.0) + uTime * 0.1);
      col += uAccent * smoothstep(0.85, 1.0, band) * 0.6;
    }
    // nebula style: extra noisy color churn
    if (uStyle == 3.0) {
      col += 0.15 * sin(vec3(vDisp*10.0, vDisp*7.0+1.0, vDisp*5.0+2.0) + uTime);
    }
    // ember style: hot core
    if (uStyle == 4.0) {
      col += uCore * pow(max(0.0, 1.0 - length(V.xy)), 3.0) * 0.4;
    }
    // ghost style: translucent, soft
    float alpha = (uStyle == 5.0) ? (0.45 + fres * 0.5) : 1.0;

    // rim glow
    col += uAccent * fres * (0.8 + uRefraction * 0.8);
    // speaking flash
    col += uAccent * uAmp * 0.6 * step(2.0, uState) * step(uState, 2.0);

    // subtle tonemap
    col = col / (col + vec3(0.7));
    col = pow(col, vec3(0.85));

    gl_FragColor = vec4(col, alpha);
  }
`;

export function ShaderOrb({
  presetId,
  state,
  amplitude = 0,
  audioEl,
  size = 200,
}: AvatarDriveProps & { presetId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const driveRef = useRef({ state, amplitude, preset: getOrbPreset(presetId) });
  driveRef.current.state = state;
  driveRef.current.amplitude = amplitude;
  driveRef.current.preset = getOrbPreset(presetId);
  const audioRef = useRef<HTMLAudioElement | null>(audioEl ?? null);
  audioRef.current = audioEl ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    camera.position.set(0, 0, 3.1);

    const preset0 = getOrbPreset(presetId);
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uTurb: { value: preset0.turbulence },
      uAmp: { value: 0 },
      uState: { value: 0 },
      uCore: { value: new THREE.Color(preset0.core) },
      uAccent: { value: new THREE.Color(preset0.accent) },
      uRefraction: { value: preset0.refraction },
      uStyle: { value: ORB_STYLE_CODE[preset0.style] },
    };

    const geo = new THREE.IcosahedronGeometry(1, 64);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    // additive halo sprite for glow
    const haloMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(preset0),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(3.4, 3.4, 1);
    scene.add(halo);

    // ── optional live amplitude from audio element ──
    let analyser: AnalyserNode | null = null;
    let audioCtx: AudioContext | null = null;
    let freqBuf: Uint8Array<ArrayBuffer> | null = null;
    const tryAttach = () => {
      const el = audioRef.current;
      if (!el || analyser) return;
      try {
        audioCtx = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        )();
        const src = audioCtx.createMediaElementSource(el);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        freqBuf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        src.connect(analyser);
        analyser.connect(audioCtx.destination);
      } catch {
        analyser = null;
      }
    };

    const stateCode = (s: string) =>
      s === 'listening' ? 1 : s === 'speaking' ? 2 : s === 'thinking' ? 3 : 0;

    const clock = new THREE.Clock();
    let smoothAmp = 0;
    let lastPresetId = presetId;

    const tick = () => {
      if (disposed) return;
      const d = driveRef.current;
      const t = clock.getElapsedTime();
      uniforms.uTime!.value = t * d.preset.speed;

      // swap palette live if preset changed
      if (d.preset.id !== lastPresetId) {
        lastPresetId = d.preset.id;
        (uniforms.uCore!.value as THREE.Color).set(d.preset.core);
        (uniforms.uAccent!.value as THREE.Color).set(d.preset.accent);
        uniforms.uTurb!.value = d.preset.turbulence;
        uniforms.uRefraction!.value = d.preset.refraction;
        uniforms.uStyle!.value = ORB_STYLE_CODE[d.preset.style];
        haloMat.map?.dispose();
        haloMat.map = makeGlowTexture(d.preset);
        haloMat.needsUpdate = true;
      }

      // amplitude: prefer live audio analyser, else prop
      tryAttach();
      let amp = d.amplitude ?? 0;
      if (analyser && freqBuf) {
        analyser.getByteFrequencyData(freqBuf);
        let sum = 0;
        for (let i = 0; i < freqBuf.length; i++) sum += freqBuf[i]!;
        amp = Math.max(amp, sum / freqBuf.length / 255);
      }
      smoothAmp += (amp - smoothAmp) * 0.2;
      uniforms.uAmp!.value = smoothAmp;
      uniforms.uState!.value = stateCode(d.state);

      const spin = d.state === 'thinking' ? 0.12 : d.state === 'listening' ? 0.02 : 0.05;
      mesh.rotation.y += spin * 0.016 * 4;
      mesh.rotation.x = Math.sin(t * 0.3) * 0.08;

      const pulse = 1 + smoothAmp * 0.12 + (d.state === 'speaking' ? 0.03 : 0);
      mesh.scale.setScalar(pulse);
      halo.scale.setScalar(3.2 + smoothAmp * 1.2);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      geo.dispose();
      mat.dispose();
      haloMat.map?.dispose();
      haloMat.dispose();
      renderer.dispose();
      audioCtx?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  return <canvas ref={canvasRef} style={{ display: 'block', width: size, height: size }} />;
}

/** Radial gradient texture for the additive halo. */
function makeGlowTexture(preset: OrbPreset): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  const glow = preset.glow;
  g.addColorStop(0, hexToRgba(glow, 0.55));
  g.addColorStop(0.4, hexToRgba(glow, 0.22));
  g.addColorStop(1, hexToRgba(glow, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
