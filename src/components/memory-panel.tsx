import { formatBytes, measurementLabel } from '../lib/memory/format';
import type { MemoryReport } from '../lib/memory/service';
import type { TabView } from '../lib/messages';
import { ChipIcon } from './icons';
import { Badge, Card, Empty, ErrorBanner, Spinner } from './ui';

export function SystemMemoryBar({
  report,
  compact,
}: {
  report: MemoryReport | null;
  compact?: boolean;
}) {
  if (!report)
    return (
      <div className="flex items-center gap-2 text-xs text-faint">
        <Spinner /> Checking memory…
      </div>
    );
  if (!report.capabilities.enabled)
    return <p className="text-xs text-faint">Memory monitoring is off.</p>;
  const sys = report.system;
  if (!sys) {
    return (
      <p className="text-xs text-faint">
        {compact
          ? 'Memory: estimates only'
          : 'This browser does not expose memory measurements to extensions.'}
        <span className="ml-1">
          <Badge>Unavailable</Badge>
        </span>
      </p>
    );
  }
  const used = sys.capacityBytes - sys.availableBytes;
  const pct = Math.round((used / sys.capacityBytes) * 100);
  return (
    <div title="Whole-computer memory reported by chrome.system.memory. Not a measurement of your tabs.">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-fg">System memory</span>
        <span className="tabular-nums text-muted">
          {formatBytes(used)} / {formatBytes(sys.capacityBytes)} used
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="System memory in use"
      >
        <div
          className={`h-full rounded-full ${pct > 85 ? 'bg-danger' : pct > 70 ? 'bg-warn' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-faint">Actual · whole computer, not per tab</div>
    </div>
  );
}

const SOURCE_BADGE = {
  actual: <Badge tone="accent">Actual</Badge>,
  estimated: <Badge tone="warn">Estimate</Badge>,
  unavailable: <Badge>Unavailable</Badge>,
} as const;

export function MemoryPanel({
  report,
  error,
  tabs,
}: {
  report: MemoryReport | null;
  error: string | null;
  tabs: TabView[];
}) {
  if (error) return <ErrorBanner message={error} />;
  if (!report) return <Empty icon={<Spinner />} title="Reading memory capabilities…" />;
  const caps = report.capabilities;
  const actual = tabs.filter((t) => report.tabs[t.id]?.source === 'actual');
  const processes = new Map<number, { bytes: number; tabs: TabView[] }>();
  for (const t of actual) {
    const m = report.tabs[t.id];
    if (m?.processId === undefined || m.valueBytes === null) continue;
    const p = processes.get(m.processId) ?? { bytes: m.valueBytes, tabs: [] };
    p.tabs.push(t);
    processes.set(m.processId, p);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="What this browser can measure">
        <ul className="divide-y divide-line">
          {caps.providers.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-fg">{p.label}</div>
                <div className="mt-0.5 text-xs text-faint">{p.detail}</div>
              </div>
              {p.available ? <Badge tone="accent">Available</Badge> : <Badge>Not available</Badge>}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-3 text-xs text-faint">
          No supported browser lets extensions measure the RAM of an individual tab. Tablar shows
          real numbers only when the browser provides them, labels their scope, and never divides or
          invents values.
        </p>
      </Card>
      <Card title="System">
        <div className="p-4">
          <SystemMemoryBar report={report} />
        </div>
      </Card>
      <Card title="Renderer processes" className="lg:col-span-2">
        {processes.size === 0 ? (
          <Empty icon={<ChipIcon width={20} height={20} />} title="No process measurements">
            {caps.perProcess
              ? 'No loaded tabs are running in a measurable process right now.'
              : 'Process memory needs chrome.processes, which only exists on the Chromium Dev channel. See BROWSER_COMPATIBILITY.md.'}
          </Empty>
        ) : (
          <ul className="divide-y divide-line">
            {[...processes].map(([pid, p]) => (
              <li key={pid} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="w-24 font-mono text-faint">PID {pid}</span>
                <span className="flex-1 truncate text-fg">
                  {p.tabs.map((t) => t.title).join(', ')}
                </span>
                <span className="tabular-nums text-fg">{formatBytes(p.bytes)}</span>
                {p.tabs.length > 1 ? <Badge>shared by {p.tabs.length}</Badge> : null}
                {SOURCE_BADGE.actual}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Per-tab indicators" className="lg:col-span-2">
        <ul className="divide-y divide-line">
          {tabs.map((t) => {
            const m = report.tabs[t.id];
            return (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-fg" title={t.url}>
                  {t.title}
                </span>
                <span className="w-44 truncate text-right text-xs text-muted" title={m?.basis}>
                  {measurementLabel(m)}
                </span>
                {SOURCE_BADGE[m?.source ?? 'unavailable']}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
