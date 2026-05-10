/**
 * First-run onboarding wizard. Surfaces each capability the companion
 * needs (mic, persona pick, hotkey awareness) instead of leaving the
 * user to discover them. Triggered once per workspace via a localStorage
 * flag (`metu.onboarding.<workspaceId>`); user can re-open from the
 * Connected panel.
 */
import { useEffect, useState } from 'react';
import type { AuthState } from '../state/auth';
import { pickPetPersona, usePersonas, type CompanionPersona } from '../state/usePersonas';

type Step = 'welcome' | 'persona' | 'mic' | 'hotkey' | 'done';

const STEP_ORDER: Step[] = ['welcome', 'persona', 'mic', 'hotkey', 'done'];

interface Props {
  auth: AuthState;
  onClose: () => void;
}

export function OnboardingWizard({ auth, onClose }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const personas = usePersonas(auth);
  const [chosen, setChosen] = useState<CompanionPersona | null>(null);
  const [micGranted, setMicGranted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!chosen && personas.length > 0) setChosen(pickPetPersona(personas));
  }, [chosen, personas]);

  const next = () => {
    const i = STEP_ORDER.indexOf(step);
    if (i < STEP_ORDER.length - 1) setStep(STEP_ORDER[i + 1]!);
  };
  const prev = () => {
    const i = STEP_ORDER.indexOf(step);
    if (i > 0) setStep(STEP_ORDER[i - 1]!);
  };

  const requestMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicGranted(true);
    } catch {
      setMicGranted(false);
    }
  };

  const finish = () => {
    try {
      localStorage.setItem(`metu.onboarding.${auth.workspaceId}`, '1');
    } catch {
      /* private mode — ignore */
    }
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 9, 14, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{ maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>Welcome to metu</strong>
          <span className="muted" style={{ fontSize: 11 }}>
            Step {STEP_ORDER.indexOf(step) + 1} of {STEP_ORDER.length}
          </span>
        </div>

        {step === 'welcome' && (
          <>
            <p style={{ margin: 0, fontSize: 13 }}>
              The companion lives quietly on your desktop. It listens when you call it, narrates the
              Conductor's actions, and stays out of your way otherwise.
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              Three quick steps and you're set.
            </p>
          </>
        )}

        {step === 'persona' && (
          <>
            <p style={{ margin: 0, fontSize: 13 }}>
              Pick the persona that should greet you. You can change this later in
              <code style={{ marginLeft: 4 }}>Settings → Presence</code>.
            </p>
            <select
              value={chosen?.slug ?? ''}
              onChange={(e) => setChosen(personas.find((p) => p.slug === e.target.value) ?? null)}
              style={{
                padding: '6px 8px',
                background: 'var(--bg, #1c1d22)',
                color: 'inherit',
                border: '1px solid #333',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              {personas.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} {p.wakeWord ? `· "${p.wakeWord}"` : ''}
                </option>
              ))}
            </select>
            {chosen?.wakeWord ? (
              <p className="muted" style={{ fontSize: 11 }}>
                Tip: say <strong>"{chosen.wakeWord}"</strong> to summon the HUD anywhere.
              </p>
            ) : (
              <p className="muted" style={{ fontSize: 11 }}>
                No wake word yet — assign one in Settings → Presence.
              </p>
            )}
          </>
        )}

        {step === 'mic' && (
          <>
            <p style={{ margin: 0, fontSize: 13 }}>
              Voice features need microphone access. Click below to ask the OS for permission — you
              can revoke it any time in your system settings.
            </p>
            <button className="btn" onClick={requestMic} disabled={micGranted === true}>
              {micGranted === true ? 'Microphone granted ✓' : 'Grant microphone access'}
            </button>
            {micGranted === false && (
              <p className="muted" style={{ fontSize: 11, color: '#f88' }}>
                Permission denied. Open System Settings → Privacy → Microphone and allow metu.
              </p>
            )}
          </>
        )}

        {step === 'hotkey' && (
          <>
            <p style={{ margin: 0, fontSize: 13 }}>
              Press <kbd>Ctrl + Alt + Space</kbd> from anywhere to summon the HUD. Each persona can
              have its own hotkey configured in
              <code style={{ marginLeft: 4 }}>Settings → Presence</code>.
            </p>
            <p className="muted" style={{ fontSize: 11 }}>
              Wake words and the system tray icon are alternative entry points.
            </p>
          </>
        )}

        {step === 'done' && (
          <>
            <p style={{ margin: 0, fontSize: 13 }}>
              You're set. The companion will appear as{' '}
              <strong>{chosen?.name ?? 'your persona'}</strong> and start observing once you grant
              any integrations.
            </p>
            <p className="muted" style={{ fontSize: 11 }}>
              Re-open this wizard any time from the panel menu.
            </p>
          </>
        )}

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <button className="btn ghost" onClick={prev} disabled={step === 'welcome'}>
            Back
          </button>
          {step === 'done' ? (
            <button className="btn" onClick={finish}>
              Get started
            </button>
          ) : (
            <button className="btn" onClick={next}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function shouldShowOnboarding(workspaceId: string): boolean {
  try {
    return localStorage.getItem(`metu.onboarding.${workspaceId}`) !== '1';
  } catch {
    return false;
  }
}
