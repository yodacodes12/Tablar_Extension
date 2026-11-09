import { useEffect, useMemo, useState } from 'react';
import type { HistoryEntry, SuspensionMethod } from '../lib/core/types';
import { call } from '../lib/ui/client';
import { formatTime } from '../lib/ui/format';
import { useActions } from './actions';
import { HistoryIcon, SearchIcon } from './icons';
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Segmented, Spinner } from './ui';

const METHOD_LABEL: Record<SuspensionMethod, string> = {
  automatic: 'Automatic',
  'manual-single': 'Manual',
  'manual-bulk': 'Bulk',
};

export function HistoryPanel({
  version,
  retentionDays,
}: {
  version: number;
  retentionDays: number;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<'all' | SuspensionMethod | 'failed'>('all');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState(false);
  const { toast } = useActions();

  useEffect(() => {
    let cancelled = false;
    call({ type: 'getHistory' })
      .then((h) => !cancelled && (setEntries(h), setError(null)))
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load history'),
      );
    return () => {
      cancelled = true;
    };
  }, [version]);

  const visible = useMemo(() => {
    const q = query.toLowerCase();
    return (entries ?? []).filter(
      (e) =>
        (method === 'all' || (method === 'failed' ? e.result === 'failed' : e.method === method)) &&
        (!q || e.tabTitle.toLowerCase().includes(q) || e.domain.includes(q)),
    );
  }, [entries, method, query]);

  return (
    <Card
      title="Suspension history"
      actions={
        <Button
          size="sm"
          variant="danger"
          disabled={!entries?.length}
          onClick={() => setConfirm(true)}
        >
          Clear history
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <Segmented
          label="Filter history"
          value={method}
          onChange={setMethod}
          options={[
            { value: 'all', label: 'All' },
            { value: 'automatic', label: 'Automatic' },
            { value: 'manual-single', label: 'Manual' },
            { value: 'manual-bulk', label: 'Bulk' },
            { value: 'failed', label: 'Failed' },
          ]}
        />
        <label className="relative ml-auto">
          <span className="sr-only">Search history</span>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-8 w-56 rounded-lg border border-line bg-raised pr-3 pl-8 text-[13px] text-fg focus:border-accent focus:outline-none"
          />
        </label>
      </div>
      {error ? (
        <div className="p-4">
          <ErrorBanner message={error} />
        </div>
      ) : !entries ? (
        <Empty icon={<Spinner />} title="Loading history…" />
      ) : visible.length === 0 ? (
        <Empty
          icon={<HistoryIcon width={20} height={20} />}
          title={entries.length ? 'No matching events' : 'No suspensions yet'}
        >
          Events are kept on this device for {retentionDays} day{retentionDays === 1 ? '' : 's'}.
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-faint">
              <tr className="border-b border-line">
                <th className="px-4 py-2 font-medium">Tab</th>
                <th className="px-2 py-2 font-medium">Suspended</th>
                <th className="px-2 py-2 font-medium">Method</th>
                <th className="px-2 py-2 font-medium">Reason</th>
                <th className="px-2 py-2 font-medium">Restored</th>
                <th className="px-4 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((e) => (
                <tr key={e.id}>
                  <td className="max-w-72 px-4 py-2">
                    <div className="truncate text-fg" title={e.url}>
                      {e.tabTitle}
                    </div>
                    <div className="truncate text-[11px] text-faint">{e.domain}</div>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-muted tabular-nums">
                    {formatTime(e.suspendedAt)}
                  </td>
                  <td className="px-2 py-2">
                    <Badge>{METHOD_LABEL[e.method]}</Badge>
                  </td>
                  <td className="max-w-64 px-2 py-2 text-xs text-muted">
                    <span className="line-clamp-2" title={e.error ?? e.reason}>
                      {e.error ?? e.reason}
                    </span>
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-muted tabular-nums">
                    {e.restoredAt ? formatTime(e.restoredAt) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {e.result === 'success' ? (
                      <Badge tone="accent">Success</Badge>
                    ) : (
                      <Badge tone="danger">Failed</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Clear all history?"
        actions={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                setConfirm(false);
                try {
                  await call({ type: 'clearHistory' });
                  setEntries([]);
                  toast({ tone: 'ok', text: 'History cleared.' });
                } catch (err) {
                  toast({
                    tone: 'error',
                    text: err instanceof Error ? err.message : 'Could not clear history',
                  });
                }
              }}
            >
              Clear
            </Button>
          </>
        }
      >
        This permanently deletes every suspension event stored on this device. Your tabs are not
        affected.
      </Dialog>
    </Card>
  );
}
