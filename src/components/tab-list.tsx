import { memo, useMemo, useState } from 'react';
import { BLOCKER_LABELS, isAutoOnlyBlocker } from '../lib/core/eligibility';
import type { TabState } from '../lib/core/types';
import { measurementLabel } from '../lib/memory/format';
import type { MemoryMeasurement } from '../lib/memory/types';
import type { TabView } from '../lib/messages';
import { formatAgo, formatDuration } from '../lib/ui/format';
import { useDebounced } from '../lib/ui/hooks';
import { useActions } from './actions';
import { GlobeIcon, LockIcon, PauseIcon, PinIcon, PlayIcon, SearchIcon, VolumeIcon } from './icons';
import { Badge, Button, Empty, IconButton, Segmented, Spinner, cx } from './ui';

export type TabFilter = 'all' | 'active' | 'inactive' | 'eligible' | 'suspended' | 'protected';

export const STATE_META: Record<
  TabState,
  { label: string; tone: 'neutral' | 'accent' | 'warn' | 'danger' | 'info' }
> = {
  ACTIVE: { label: 'Active', tone: 'accent' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
  ELIGIBLE: { label: 'Eligible', tone: 'warn' },
  SUSPENDING: { label: 'Suspending…', tone: 'info' },
  SUSPENDED: { label: 'Suspended', tone: 'info' },
  RESTORING: { label: 'Restoring…', tone: 'info' },
  PROTECTED: { label: 'Protected', tone: 'neutral' },
  ERROR: { label: 'Error', tone: 'danger' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

export function matchesFilter(t: TabView, f: TabFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'active':
      return t.active;
    case 'inactive':
      return !t.active && !t.discarded;
    case 'eligible':
      return t.autoEligible;
    case 'suspended':
      return t.discarded;
    case 'protected':
      return t.state === 'PROTECTED';
  }
}

export function matchesQuery(t: TabView, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    t.title.toLowerCase().includes(s) ||
    t.domain.toLowerCase().includes(s) ||
    t.url.toLowerCase().includes(s)
  );
}

function Favicon({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed || !/^(https?:|data:)/.test(url))
    return <GlobeIcon className="h-4 w-4 shrink-0 text-faint" />;
  return (
    <img
      src={url}
      alt=""
      width={16}
      height={16}
      className="h-4 w-4 shrink-0 rounded-sm"
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

function statusLine(t: TabView, now: number): string {
  if (t.discarded)
    return t.suspension
      ? `Suspended ${formatAgo(t.suspension.at, now)}`
      : 'Suspended by the browser';
  if (t.active) return 'In use';
  if (t.lastError) return t.lastError;
  const protections = t.protections.map((b) => BLOCKER_LABELS[b]);
  const idle = t.inactiveMs > 0 ? `Idle ${formatDuration(t.inactiveMs)}` : 'Idle just now';
  return protections.length ? `${idle} · ${protections.join(', ')}` : idle;
}

export const TabRow = memo(function TabRow({
  tab,
  now,
  selected,
  onSelect,
  memory,
  compact,
}: {
  tab: TabView;
  now: number;
  selected?: boolean;
  onSelect?: (id: number, v: boolean) => void;
  memory?: MemoryMeasurement;
  compact?: boolean;
}) {
  const { busy, suspend, restore, activate } = useActions();
  const isBusy = busy.has(tab.id) || tab.state === 'SUSPENDING' || tab.state === 'RESTORING';
  const meta = STATE_META[tab.state];
  const canSuspend = !tab.discarded && tab.manualForceAllowed;
  const suspendHint = tab.active
    ? 'The active tab cannot be suspended'
    : tab.blockers.includes('internal-page')
      ? 'Browser pages cannot be suspended'
      : !tab.manualAllowed
        ? `Protected (${tab.blockers
            .filter((b) => !isAutoOnlyBlocker(b))
            .map((b) => BLOCKER_LABELS[b])
            .join(', ')}) — you will be asked to confirm`
        : 'Suspend this tab';

  return (
    <li
      className={cx(
        'group flex items-center gap-2.5 px-3',
        compact ? 'py-2' : 'py-2.5',
        selected && 'bg-accent-soft/40',
      )}
    >
      {onSelect ? (
        <input
          type="checkbox"
          aria-label={`Select ${tab.title}`}
          className="h-3.5 w-3.5 shrink-0 accent-[var(--t-accent)]"
          checked={!!selected}
          disabled={!canSuspend && !tab.discarded}
          onChange={(e) => onSelect(tab.id, e.target.checked)}
        />
      ) : null}
      <Favicon url={tab.favIconUrl} />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => void activate(tab)}
        title={`Open: ${tab.url}`}
      >
        <div
          className={cx(
            'truncate text-[13px] font-medium',
            tab.discarded ? 'text-muted' : 'text-fg',
          )}
        >
          {tab.title}
        </div>
        <div className="flex items-center gap-1.5 truncate text-[11px] text-faint">
          <span className="truncate">{tab.domain || tab.url}</span>
          <span aria-hidden>·</span>
          <span className={cx('truncate', tab.lastError && 'text-danger')}>
            {statusLine(tab, now)}
          </span>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {tab.pinned ? <PinIcon className="h-3.5 w-3.5 text-faint" aria-label="Pinned" /> : null}
        {tab.audible ? (
          <VolumeIcon className="h-3.5 w-3.5 text-faint" aria-label="Playing audio" />
        ) : null}
        {tab.whitelistRule ? (
          <LockIcon
            className="h-3.5 w-3.5 text-faint"
            aria-label={`Protected website: ${tab.whitelistRule}`}
          />
        ) : null}
        {memory && !compact ? (
          <span
            className="hidden w-28 truncate text-right text-[11px] tabular-nums text-faint sm:inline"
            title={memory.basis}
          >
            {measurementLabel(memory)}
          </span>
        ) : null}
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {isBusy ? (
          <span className="flex h-8 w-8 items-center justify-center text-faint">
            <Spinner />
          </span>
        ) : tab.discarded ? (
          <IconButton label="Restore (reload) this tab" onClick={() => void restore([tab])}>
            <PlayIcon />
          </IconButton>
        ) : (
          <IconButton
            label={suspendHint}
            disabled={!canSuspend}
            onClick={() => void suspend([tab], false)}
          >
            <PauseIcon />
          </IconButton>
        )}
      </div>
    </li>
  );
});

export function TabList({
  tabs,
  now,
  memory,
  compact,
  initialFilter = 'all',
  maxHeight,
}: {
  tabs: TabView[];
  now: number;
  memory?: Record<number, MemoryMeasurement>;
  compact?: boolean;
  initialFilter?: TabFilter;
  maxHeight?: string;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TabFilter>(initialFilter);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { suspend, restore, busy } = useActions();
  const q = useDebounced(query, 120);

  const counts = useMemo(() => {
    const c: Record<TabFilter, number> = {
      all: 0,
      active: 0,
      inactive: 0,
      eligible: 0,
      suspended: 0,
      protected: 0,
    };
    for (const t of tabs)
      for (const f of Object.keys(c) as TabFilter[]) if (matchesFilter(t, f)) c[f]++;
    return c;
  }, [tabs]);

  const visible = useMemo(
    () =>
      tabs
        .filter((t) => matchesFilter(t, filter) && matchesQuery(t, q))
        .sort((a, b) => a.windowId - b.windowId || a.index - b.index),
    [tabs, filter, q],
  );

  const liveSelected = visible.filter((t) => selected.has(t.id));
  const selectedSuspendable = liveSelected.filter((t) => !t.discarded && t.manualForceAllowed);
  const selectedRestorable = liveSelected.filter((t) => t.discarded);
  const allChecked =
    visible.length > 0 &&
    visible.every((t) => selected.has(t.id) || (!t.discarded && !t.manualForceAllowed));

  const onSelect = (id: number, v: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (v) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5">
        <label className="relative block">
          <span className="sr-only">Search tabs</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title or domain"
            className="h-8 w-full rounded-lg border border-line bg-raised pr-3 pl-8 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </label>
        <Segmented
          label="Filter tabs"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'active', label: 'Active', count: counts.active },
            ...(compact
              ? []
              : [{ value: 'inactive' as const, label: 'Inactive', count: counts.inactive }]),
            { value: 'eligible', label: 'Eligible', count: counts.eligible },
            { value: 'suspended', label: 'Suspended', count: counts.suspended },
            { value: 'protected', label: 'Protected', count: counts.protected },
          ]}
        />
        <div className="flex min-h-7 items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-muted">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[var(--t-accent)]"
              checked={allChecked}
              aria-label="Select all visible tabs"
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? new Set(
                        visible.filter((t) => t.discarded || t.manualForceAllowed).map((t) => t.id),
                      )
                    : new Set(),
                )
              }
            />
            {liveSelected.length ? `${liveSelected.length} selected` : 'Select'}
          </label>
          <div className="ml-auto flex gap-1.5">
            <Button
              size="sm"
              disabled={
                selectedSuspendable.length === 0 || selectedSuspendable.some((t) => busy.has(t.id))
              }
              onClick={() => {
                void suspend(selectedSuspendable, true);
                setSelected(new Set());
              }}
            >
              <PauseIcon width={12} height={12} /> Suspend
              {selectedSuspendable.length ? ` ${selectedSuspendable.length}` : ''}
            </Button>
            <Button
              size="sm"
              disabled={selectedRestorable.length === 0}
              onClick={() => {
                void restore(selectedRestorable);
                setSelected(new Set());
              }}
            >
              <PlayIcon width={12} height={12} /> Restore
              {selectedRestorable.length ? ` ${selectedRestorable.length}` : ''}
            </Button>
          </div>
        </div>
      </div>
      {visible.length === 0 ? (
        <Empty
          icon={<SearchIcon width={20} height={20} />}
          title={q ? 'No tabs match your search' : 'No tabs in this view'}
        >
          {q
            ? 'Try a different title or domain.'
            : filter === 'eligible'
              ? 'Tabs appear here once they pass the inactivity threshold.'
              : null}
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-y-auto" style={{ maxHeight }}>
          {visible.map((t) => (
            <TabRow
              key={t.id}
              tab={t}
              now={now}
              compact={compact}
              memory={memory?.[t.id]}
              selected={selected.has(t.id)}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
