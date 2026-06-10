/**
 * Splash screen — shows the living orb while auth loads, then morphs out into
 * the main UI. Purely cosmetic; `App` controls how long it stays by gating on
 * the auth-loading state plus a minimum dwell so it never flickers.
 */
import { motion } from 'framer-motion';
import { ShaderOrb } from '../avatar/ShaderOrb';
import { useAvatarSelection } from '../avatar/useAvatarSelection';

export function Splash() {
  const { selection } = useAvatarSelection();
  return (
    <motion.div
      className="splash"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 180, damping: 18 }}
      >
        <ShaderOrb state="thinking" size={140} presetId={selection.orbPresetId} />
      </motion.div>
      <motion.div
        className="splash__word"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        metu
      </motion.div>
      <motion.div
        className="splash__sub"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.6 }}
        transition={{ delay: 0.3, duration: 0.5 }}
      >
        waking up…
      </motion.div>
    </motion.div>
  );
}
