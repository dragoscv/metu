/**
 * Connected — the main window console after pairing. A fixed left sidebar
 * selects between views; the right pane renders the active view with a crossfade
 * transition. View selection persists to localStorage so re-opening the window
 * lands you back where you were.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { AuthState } from '../state/auth';
import type { HubStatus } from '../state/useHubConnection';
import type { AvatarState } from '../avatar/types';
import { OnboardingWizard, shouldShowOnboarding } from './OnboardingWizard';
import { Sidebar } from './Sidebar';
import { type ViewId } from './nav';
import { HomeView } from './views/HomeView';
import { AvatarView } from './views/AvatarView';
import { PetView } from './views/PetView';
import { SensorsView } from './views/SensorsView';
import { ActivityView } from './views/ActivityView';
import { SettingsView } from './views/SettingsView';

const VIEW_KEY = 'metu.companion.view';

function loadView(): ViewId {
  try {
    const v = localStorage.getItem(VIEW_KEY) as ViewId | null;
    if (v) return v;
  } catch {
    /* ignore */
  }
  return 'home';
}

const viewFade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
};

export function Connected({
  auth,
  status,
  onSignOut,
  onSensorsChange,
}: {
  auth: AuthState;
  status: HubStatus;
  onSignOut: () => Promise<void>;
  onSensorsChange: () => void;
}) {
  const [view, setView] = useState<ViewId>(loadView);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (shouldShowOnboarding(auth.workspaceId)) setShowOnboarding(true);
  }, [auth.workspaceId]);

  const select = (id: ViewId) => {
    setView(id);
    try {
      localStorage.setItem(VIEW_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const avatarState: AvatarState =
    status === 'connecting' || status === 'closed' ? 'thinking' : 'idle';

  return (
    <div className="console">
      <Sidebar active={view} onSelect={select} status={status} avatarState={avatarState} />

      <main className="console__pane">
        <AnimatePresence mode="wait">
          <motion.div key={view} className="console__view" {...viewFade}>
            {view === 'home' && <HomeView auth={auth} status={status} />}
            {view === 'avatar' && <AvatarView />}
            {view === 'pet' && <PetView />}
            {view === 'sensors' && <SensorsView onChange={onSensorsChange} />}
            {view === 'activity' && <ActivityView auth={auth} status={status} />}
            {view === 'settings' && (
              <SettingsView
                auth={auth}
                onSignOut={onSignOut}
                onShowOnboarding={() => setShowOnboarding(true)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {showOnboarding && <OnboardingWizard auth={auth} onClose={() => setShowOnboarding(false)} />}
    </div>
  );
}
