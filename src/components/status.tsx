import type { Snapshot } from '../lib/messages';
import { Badge } from './ui';

export function MonitoringStatus({ snapshot }: { snapshot: Snapshot }) {
  const { settings } = snapshot;
  if (!settings.autoSuspend)
    return (
      <Badge tone="neutral" title="Automatic suspension is off. Manual controls still work.">
        Auto-suspend off
      </Badge>
    );
  return (
    <Badge
      tone="accent"
      title={`Inactive tabs are suspended after ${settings.thresholdMinutes} minutes. Checked every minute.`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> Monitoring ·{' '}
      {settings.thresholdMinutes} min
    </Badge>
  );
}
