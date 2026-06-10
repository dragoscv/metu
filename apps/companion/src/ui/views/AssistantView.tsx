/**
 * AssistantView — controls for the floating desktop assistant (visibility +
 * personality). The actual animated character lives in the always-on-top
 * `assistant` window; this is its control surface.
 */
import { AssistantControls } from '../AssistantControls';
import { ViewHeader } from '../ViewHeader';

export function AssistantView() {
  return (
    <div className="view">
      <ViewHeader id="assistant" />
      <AssistantControls />
      <div className="glass-card glass-card--mini">
        <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>
          Click the assistant to open the chat — it answers with your workspace's AI, can read
          context, and hands bigger jobs to the Conductor. Drag it anywhere to reposition; it
          perches near windows and pauses while you interact. Double-click toggles the voice mic.
        </p>
      </div>
    </div>
  );
}
