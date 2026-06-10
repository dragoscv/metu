/**
 * PetView — controls for the detached desktop pet (visibility + personality).
 * The actual animated character lives in the always-on-top `pet` window; this
 * is its control surface.
 */
import { PetControls } from '../PetControls';
import { ViewHeader } from '../ViewHeader';

export function PetView() {
  return (
    <div className="view">
      <ViewHeader id="pet" />
      <PetControls />
      <div className="glass-card glass-card--mini">
        <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
          Tip: drag the pet anywhere on screen to reposition it. It walks, perches near windows, and
          pauses while you talk to it. Pick a personality above to change how chatty and active it
          is.
        </p>
      </div>
    </div>
  );
}
