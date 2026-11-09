import { useEffect, useState, type ReactNode } from 'react';
import { BLOCKER_LABELS } from '../lib/core/eligibility';
import type { Snapshot } from '../lib/messages';
import { formatAgo, formatDuration, formatTime } from '../lib/ui/format';
import { useMemory, useSnapshot, useTheme } from '../lib/ui/hooks';
import { ActionsProvider, useActions } from './actions';
import { HistoryPanel } from './history-panel';
import {
  ChipIcon,
  GearIcon,
  GridIcon,
  HistoryIcon,
  ListIcon,
  LockIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  ShieldIcon,
} from './icons';
import { MemoryPanel, SystemMemoryBar } from './memory-panel';
import { SettingsPanel } from './settings-panel';
import { MonitoringStatus } from './status';
import { TabList } from './tab-list';
import { Badge, Button, Card, Empty, ErrorBanner, Logo, Spinner, Stat, cx } from './ui';
import { WhitelistPanel } from './whitelist-panel';

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: GridIcon },
  { id: 'tabs', label: 'All tabs', icon: ListIcon },
  { id: 'suspended', label: 'Suspended', icon: MoonIcon },
  { id: 'memory', label: 'Memory insights', icon: ChipIcon },
  { id: 'history', label: 'History', icon: HistoryIcon },
  { id: 'protected', label: 'Protected websites', icon: LockIcon },
  { id: 'settings', label: 'Settings', icon: GearIcon },
  { id: 'privacy', label: 'Privacy', icon: ShieldIcon },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const isSection = (s: string): s is SectionId => SECTIONS.some((x) => x.id === s);

function useHashSection(fallback: SectionId): [SectionId, (s: SectionId) => void] {
  const read = () => {
    const h = location.hash.replace('#', '');
    return isSection(h) ? h : fallback;
  };
  const [section, setSection] = useState<SectionId>(read);
  useEffect(() => {
    const on = () => setSection(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  });
  return [section, (s) => (location.hash = s)];
}

export function DashboardApp({ defaultSection = 'overview' }: { defaultSection?: SectionId }) {
  const { snapshot, error, refresh } = useSnapshot();
  const [section, go] = useHashSection(defaultSection);
  const [version, setVersion] = useState(0);
  useTheme(snapshot?.settings.theme);
  useEffect(() => setVersion((v) => v + 1), [snapshot]);

  return (
    <ActionsProvider onDone={refresh}>
      <div className="flex min-h-screen bg-bg text-fg">
        <nav
          aria-label="Dashboard sections"
          className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-line bg-surface p-3 md:flex"
        >
          <div className="px-2 py-2">
            <Logo size={26} />
          </div>
          <ul className="mt-4 flex flex-col gap-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={section === id ? 'page' : undefined}
                  className={cx(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                    section === id
                      ? 'bg-accent-soft text-accent'
                      : 'text-muted hover:bg-raised hover:text-fg',
                  )}
                >
                  <Icon /> {label}
                  {id === 'suspended' && snapshot?.counts.suspended ? (
                    <span className="ml-auto text-xs tabular-nums opacity-70">
                      {snapshot.counts.suspended}
                    </span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-auto px-2 text-[11px] leading-relaxed text-faint">
            All data stays on this device. No accounts, no telemetry.
          </p>
        </nav>
        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-bg/90 px-6 py-3 backdrop-blur">
            <div className="md:hidden">
              <Logo withName={false} />
            </div>
            <select
              className="h-8 rounded-lg border border-line bg-raised px-2 text-sm md:hidden"
              value={section}
              aria-label="Section"
              onChange={(e) => go(e.target.value as SectionId)}
            >
              {SECTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <h1 className="hidden text-lg font-semibold md:block">
              {SECTIONS.find((s) => s.id === section)?.label}
            </h1>
            <div className="ml-auto">
              {snapshot ? <MonitoringStatus snapshot={snapshot} /> : null}
            </div>
          </header>
          <div className="mx-auto max-w-6xl p-6">
            {error ? (
              <ErrorBanner message={error} onRetry={() => void refresh()} />
            ) : !snapshot ? (
              <Empty icon={<Spinner />} title="Loading tabs…" />
            ) : (
              <Section id={section} snapshot={snapshot} version={version} go={go} />
            )}
          </div>
        </main>
      </div>
    </ActionsProvider>
  );
}

function Section({
  id,
  snapshot,
  version,
  go,
}: {
  id: SectionId;
  snapshot: Snapshot;
  version: number;
  go: (s: SectionId) => void;
}) {
  switch (id) {
    case 'overview':
      return <Overview snapshot={snapshot} go={go} />;
    case 'tabs':
      return <AllTabs snapshot={snapshot} />;
    case 'suspended':
      return <Suspended snapshot={snapshot} />;
    case 'memory':
      return <MemorySection snapshot={snapshot} />;
    case 'history':
      return (
        <HistoryPanel version={version} retentionDays={snapshot.settings.historyRetentionDays} />
      );
    case 'protected':
      return <WhitelistPanel settings={snapshot.settings} tabs={snapshot.tabs} />;
    case 'settings':
      return <SettingsPanel settings={snapshot.settings} browserFamily={snapshot.browser} />;
    case 'privacy':
      return <Privacy />;
  }
}

function Overview({ snapshot, go }: { snapshot: Snapshot; go: (s: SectionId) => void }) {
  const { report } = useMemory(snapshot);
  const { bulk, bulkBusy } = useActions();
  const c = snapshot.counts;
  const next = snapshot.nextEvaluationAt
    ? Math.max(0, snapshot.nextEvaluationAt - snapshot.now)
    : null;
  const soonest = snapshot.tabs
    .filter((t) => !t.active && !t.discarded && t.protections.length === 0 && !t.autoEligible)
    .map((t) => ({ t, left: snapshot.settings.thresholdMinutes * 60_000 - t.inactiveMs }))
    .sort((a, b) => a.left - b.left)
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Open tabs" value={c.total} />
        <Stat label="Active" value={c.active} hint="one per window" />
        <Stat label="Inactive" value={c.inactive} />
        <Stat
          label="Eligible"
          value={c.eligible}
          tone={c.eligible ? 'warn' : undefined}
          hint={`idle ≥ ${snapshot.settings.thresholdMinutes} min`}
        />
        <Stat label="Suspended" value={c.suspended} tone={c.suspended ? 'accent' : undefined} />
        <Stat label="Protected" value={c.protected} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Quick actions" className="lg:col-span-2">
          <div className="flex flex-wrap gap-2 p-4">
            <Button
              variant="primary"
              busy={bulkBusy === 'suspendIdle'}
              disabled={!c.eligible || !!bulkBusy}
              onClick={() => void bulk('suspendIdle')}
            >
              <PauseIcon /> Suspend idle tabs{c.eligible ? ` (${c.eligible})` : ''}
            </Button>
            <Button
              busy={bulkBusy === 'suspendAllInactive'}
              disabled={!snapshot.tabs.some((t) => t.manualAllowed) || !!bulkBusy}
              onClick={() => void bulk('suspendAllInactive')}
            >
              Suspend all except active
            </Button>
            <Button
              busy={bulkBusy === 'restoreAll'}
              disabled={!c.suspended || !!bulkBusy}
              onClick={() => void bulk('restoreAll')}
            >
              <PlayIcon /> Restore all suspended
            </Button>
          </div>
          <div className="border-t border-line px-4 py-3 text-xs text-faint">
            {snapshot.settings.autoSuspend
              ? `Automatic check every minute${next !== null ? ` · next in ${Math.ceil(next / 1000)} s` : ''}${snapshot.lastEvaluationAt ? ` · last ${formatAgo(snapshot.lastEvaluationAt, snapshot.now)}` : ''}.`
              : 'Automatic suspension is off. '}
            {!snapshot.settings.autoSuspend ? (
              <button
                type="button"
                className="text-accent underline"
                onClick={() => go('settings')}
              >
                Turn it on in settings
              </button>
            ) : null}
          </div>
        </Card>
        <Card title="Memory">
          <div className="p-4">
            <SystemMemoryBar report={report} />
          </div>
          <div className="border-t border-line px-4 py-2.5">
            <button
              type="button"
              className="text-xs font-medium text-accent"
              onClick={() => go('memory')}
            >
              What can be measured →
            </button>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Next to be suspended">
          {!snapshot.settings.autoSuspend ? (
            <Empty title="Automatic suspension is off" />
          ) : soonest.length === 0 ? (
            <Empty title="Nothing queued">No unprotected inactive tabs are waiting.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {soonest.map(({ t, left }) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-fg">{t.title}</span>
                  <span className="text-xs tabular-nums text-faint">
                    in {formatDuration(Math.max(left, 60_000))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Recent activity"
          actions={
            <button
              type="button"
              className="text-xs font-medium text-accent"
              onClick={() => go('history')}
            >
              View all
            </button>
          }
        >
          {snapshot.recentHistory.length === 0 ? (
            <Empty icon={<HistoryIcon width={20} height={20} />} title="No suspensions yet" />
          ) : (
            <ul className="divide-y divide-line">
              {snapshot.recentHistory.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-fg" title={e.url}>
                    {e.tabTitle}
                  </span>
                  {e.result === 'failed' ? (
                    <Badge tone="danger">Failed</Badge>
                  ) : e.restoredAt ? (
                    <Badge>Restored</Badge>
                  ) : (
                    <Badge tone="info">Suspended</Badge>
                  )}
                  <span className="w-28 text-right text-xs tabular-nums text-faint">
                    {formatAgo(e.suspendedAt, snapshot.now)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function AllTabs({ snapshot }: { snapshot: Snapshot }) {
  const { report } = useMemory(snapshot);
  return (
    <Card>
      <TabList tabs={snapshot.tabs} now={snapshot.now} memory={report?.tabs} />
    </Card>
  );
}

function Suspended({ snapshot }: { snapshot: Snapshot }) {
  const { restore, bulk, bulkBusy, busy, activate } = useActions();
  const suspended = snapshot.tabs.filter((t) => t.discarded);
  return (
    <Card
      title={`${suspended.length} suspended tab${suspended.length === 1 ? '' : 's'}`}
      actions={
        <Button
          size="sm"
          busy={bulkBusy === 'restoreAll'}
          disabled={!suspended.length || !!bulkBusy}
          onClick={() => void bulk('restoreAll')}
        >
          <PlayIcon width={12} height={12} /> Restore all
        </Button>
      }
    >
      {suspended.length === 0 ? (
        <Empty icon={<MoonIcon width={20} height={20} />} title="No suspended tabs">
          Suspended tabs stay in your tab bar and reload when you open them.
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-faint">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Tab</th>
                <th className="px-2 py-2 font-medium">Suspended</th>
                <th className="px-2 py-2 font-medium">Reason</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {suspended.map((t) => (
                <tr key={t.id}>
                  <td className="max-w-80 px-4 py-2.5">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left text-fg hover:underline"
                      onClick={() => void activate(t)}
                      title={t.url}
                    >
                      {t.title}
                    </button>
                    <div className="truncate text-[11px] text-faint">{t.domain}</div>
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-muted tabular-nums">
                    {t.suspension ? formatTime(t.suspension.at) : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-muted">
                    {t.suspension?.reason ??
                      'Discarded by the browser or before Tablar was running'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button size="sm" busy={busy.has(t.id)} onClick={() => void restore([t])}>
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function MemorySection({ snapshot }: { snapshot: Snapshot }) {
  const { report, error } = useMemory(snapshot);
  return <MemoryPanel report={report} error={error} tabs={snapshot.tabs} />;
}

function Privacy() {
  const Item = ({ title, children }: { title: string; children: ReactNode }) => (
    <li className="px-4 py-3">
      <div className="text-sm font-medium text-fg">{title}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted">{children}</div>
    </li>
  );
  return (
    <Card title="Privacy">
      <ul className="divide-y divide-line">
        <Item title="Everything stays on this device">
          Settings, tab activity times, protected websites and suspension history are kept in the
          browser’s local extension storage. Nothing is sent anywhere.
        </Item>
        <Item title="No network, no telemetry, no account">
          Tablar makes no network requests and has no server.
        </Item>
        <Item title="What is stored">
          Per open tab: its ID, window, URL and last-used time (deleted when the tab closes). Per
          suspension event: title, URL, domain, times, method and result (deleted after your
          retention period, or when you clear history). Private-window tabs are never written to
          history.
        </Item>
        <Item title="Permissions">
          <code>tabs</code> (read tab titles/URLs and discard tabs), <code>storage</code>,{' '}
          <code>alarms</code> (the once-a-minute check), <code>system.memory</code> on Chromium
          (total RAM figure). <code>notifications</code> is optional and only requested if you
          enable it. No host permissions, no page content access.
        </Item>
        <Item title="Blockers explained">{Object.values(BLOCKER_LABELS).join(' · ')}</Item>
      </ul>
    </Card>
  );
}
