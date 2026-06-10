/**
 * FaceAvatar — a procedural SVG character with a face. Reacts to the shared
 * {@link AvatarState}: blinks while idle, perks up while listening, bounces
 * its mouth while speaking (amplitude-reactive when an <audio> element is
 * provided), and squints while thinking. All vector + rAF — no assets.
 */
import { useEffect, useRef, useState } from 'react';
import type { AvatarDriveProps } from './types';
import { getFacePreset, type FacePreset } from './facePresets';

/** Head outline path per shape, in a 100×100 viewBox. */
function headPath(shape: FacePreset['shape']): string {
  switch (shape) {
    case 'round':
      return 'M50 6 C75 6 92 24 92 50 C92 76 75 94 50 94 C25 94 8 76 8 50 C8 24 25 6 50 6 Z';
    case 'squircle':
      return 'M50 8 C82 8 92 18 92 50 C92 82 82 92 50 92 C18 92 8 82 8 50 C8 18 18 8 50 8 Z';
    case 'teardrop':
      return 'M50 4 C58 18 92 34 92 58 C92 80 74 94 50 94 C26 94 8 80 8 58 C8 34 42 18 50 4 Z';
    case 'cat':
      return 'M22 22 L14 4 L38 14 C42 12 46 11 50 11 C54 11 58 12 62 14 L86 4 L78 22 C87 30 92 40 92 52 C92 76 75 93 50 93 C25 93 8 76 8 52 C8 40 13 30 22 22 Z';
    case 'ghost':
      return 'M50 6 C74 6 90 24 90 48 L90 88 L78 78 L66 90 L50 80 L34 90 L22 78 L10 88 L10 48 C10 24 26 6 50 6 Z';
    case 'bot':
      return 'M26 14 L74 14 C84 14 90 20 90 30 L90 74 C90 84 84 90 74 90 L26 90 C16 90 10 84 10 74 L10 30 C10 20 16 14 26 14 Z';
  }
}

export function FaceAvatar({
  presetId,
  state,
  amplitude = 0,
  audioEl,
  size = 200,
}: AvatarDriveProps & { presetId: string }) {
  const preset = getFacePreset(presetId);
  const [blink, setBlink] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0); // 0..1
  const audioRef = useRef<HTMLAudioElement | null>(audioEl ?? null);
  audioRef.current = audioEl ?? null;
  const ampRef = useRef(amplitude);
  ampRef.current = amplitude;

  // Blink loop (skip while thinking — eyes are squinted anyway).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      t = setTimeout(
        () => {
          setBlink(true);
          setTimeout(() => {
            setBlink(false);
            loop();
          }, 130);
        },
        2200 + Math.random() * 2600,
      );
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  // Mouth amplitude — analyser if audio present, else synthetic bounce.
  useEffect(() => {
    if (state !== 'speaking') {
      setMouthOpen(0);
      return;
    }
    let raf = 0;
    let analyser: AnalyserNode | null = null;
    let ctx: AudioContext | null = null;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const el = audioRef.current;
    if (el) {
      try {
        ctx = new AudioContext();
        const src = ctx.createMediaElementSource(el);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        buf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        src.connect(analyser);
        analyser.connect(ctx.destination);
      } catch {
        analyser = null;
      }
    }
    const start = performance.now();
    const tick = () => {
      let amp: number;
      if (analyser && buf) {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (const v of buf) sum += v;
        amp = Math.min(1, sum / buf.length / 90);
      } else {
        const t = (performance.now() - start) / 1000;
        amp = 0.35 + 0.35 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1));
        amp = Math.max(amp, ampRef.current);
      }
      setMouthOpen(amp);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => {});
    };
  }, [state]);

  const { skin, skinDeep, feature, blush, glow, shape, eyes, bounce } = preset;
  const gid = `face-${preset.id}`;

  const eyeClosed = blink || state === 'thinking';
  const listening = state === 'listening';
  const eyeScaleY = eyeClosed ? 0.12 : listening ? 1.25 : 1;

  // Mouth geometry by state.
  const mouthH = state === 'speaking' ? 3 + mouthOpen * 12 : 2.4;
  const mouthW = state === 'speaking' ? 14 + mouthOpen * 6 : listening ? 10 : 12;
  const mouthY = 64;

  const animClass =
    state === 'speaking'
      ? 'face--speaking'
      : state === 'listening'
        ? 'face--listening'
        : state === 'thinking'
          ? 'face--thinking'
          : 'face--idle';

  return (
    <div
      className={`face ${animClass}`}
      style={
        {
          width: size,
          height: size,
          '--face-glow': glow,
          '--face-bounce': bounce,
        } as React.CSSProperties
      }
    >
      <svg viewBox="0 0 100 100" width={size} height={size} className="face__svg">
        <defs>
          <radialGradient id={`${gid}-skin`} cx="38%" cy="30%" r="80%">
            <stop offset="0%" stopColor={skin} />
            <stop offset="100%" stopColor={skinDeep} />
          </radialGradient>
          <radialGradient id={`${gid}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={glow} stopOpacity="0.55" />
            <stop offset="100%" stopColor={glow} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* halo */}
        <circle cx="50" cy="52" r="48" fill={`url(#${gid}-halo)`} className="face__halo" />

        {/* body */}
        <path d={headPath(shape)} fill={`url(#${gid}-skin)`} className="face__head" />

        {/* bot antenna / details */}
        {shape === 'bot' && (
          <>
            <line x1="50" y1="14" x2="50" y2="5" stroke={skinDeep} strokeWidth="2.4" />
            <circle cx="50" cy="4" r="2.8" fill={blush} className="face__antenna" />
          </>
        )}

        {/* eyes */}
        <g className="face__eyes">
          {eyes === 'visor' ? (
            <rect
              x="26"
              y={44 - 5 * eyeScaleY}
              width="48"
              height={10 * eyeScaleY}
              rx={5 * eyeScaleY}
              fill={feature}
            >
              {!eyeClosed && (
                <animate
                  attributeName="opacity"
                  values="1;0.75;1"
                  dur="2.4s"
                  repeatCount="indefinite"
                />
              )}
            </rect>
          ) : eyes === 'happy' && !eyeClosed ? (
            <>
              <path
                d="M30 46 Q35 40 40 46"
                stroke={feature}
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M60 46 Q65 40 70 46"
                stroke={feature}
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
            </>
          ) : eyes === 'star' && !eyeClosed ? (
            <>
              <text x="29" y="50" fontSize="13" fill={feature}>
                ✦
              </text>
              <text x="59" y="50" fontSize="13" fill={feature}>
                ✦
              </text>
            </>
          ) : eyes === 'sleepy' && !eyeClosed ? (
            <>
              <path
                d="M29 45 Q35 49 41 45"
                stroke={feature}
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M59 45 Q65 49 71 45"
                stroke={feature}
                strokeWidth="3"
                strokeLinecap="round"
                fill="none"
              />
            </>
          ) : (
            <>
              <ellipse
                cx="35"
                cy="45"
                rx={eyes === 'dot' ? 3.2 : 4.6}
                ry={(eyes === 'dot' ? 3.2 : 6.4) * eyeScaleY}
                fill={feature}
              />
              <ellipse
                cx="65"
                cy="45"
                rx={eyes === 'dot' ? 3.2 : 4.6}
                ry={(eyes === 'dot' ? 3.2 : 6.4) * eyeScaleY}
                fill={feature}
              />
            </>
          )}
        </g>

        {/* blush */}
        <ellipse cx="26" cy="56" rx="5.5" ry="3" fill={blush} opacity="0.5" />
        <ellipse cx="74" cy="56" rx="5.5" ry="3" fill={blush} opacity="0.5" />

        {/* mouth */}
        {state === 'thinking' ? (
          <path
            d={`M${50 - 6} ${mouthY} Q50 ${mouthY - 4} ${50 + 6} ${mouthY}`}
            stroke={feature}
            strokeWidth="2.6"
            strokeLinecap="round"
            fill="none"
          />
        ) : (
          <rect
            x={50 - mouthW / 2}
            y={mouthY - mouthH / 2}
            width={mouthW}
            height={mouthH}
            rx={Math.min(mouthH / 2, 4)}
            fill={feature}
          />
        )}

        {/* thinking dots */}
        {state === 'thinking' && (
          <g className="face__thinkdots" fill={feature}>
            <circle cx="78" cy="22" r="2.2" />
            <circle cx="86" cy="14" r="3" />
          </g>
        )}
      </svg>
    </div>
  );
}
