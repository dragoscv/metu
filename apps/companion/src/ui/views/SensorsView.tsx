/**
 * SensorsView — wraps the existing SensorsPanel in the standard view chrome.
 */
import { SensorsPanel } from '../SensorsPanel';
import { ViewHeader } from '../ViewHeader';

export function SensorsView({ onChange }: { onChange: () => void }) {
  return (
    <div className="view">
      <ViewHeader id="sensors" />
      <SensorsPanel onChange={onChange} />
    </div>
  );
}
