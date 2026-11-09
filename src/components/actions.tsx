import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BLOCKER_LABELS } from '../lib/core/eligibility';
import { isSoftBlocker } from '../lib/core/eligibility';
import type { OpResult, TabView } from '../lib/messages';
import { call } from '../lib/ui/client';
import { AlertIcon, CheckIcon, XIcon } from './icons';
import { Button, Dialog, cx } from './ui';

interface Toast {
  id: number;
  tone: 'ok' | 'error';
  text: string;
  details?: string[];
}

interface Actions {
  busy: Set<number>;
  bulkBusy: string | null;
  suspend: (tabs: TabView[], bulk?: boolean) => Promise<void>;
  restore: (tabs: TabView[]) => Promise<void>;
  bulk: (kind: 'suspendIdle' | 'suspendAllInactive' | 'restoreAll') => Promise<void>;
  activate: (tab: TabView) => Promise<void>;
  toast: (t: Omit<Toast, 'id'>) => void;
}

const Ctx = createContext<Actions | null>(null);

export function useActions(): Actions {
  const v = useContext(Ctx);
  if (!v) throw new Error('ActionsProvider missing');
  return v;
}

function summarize(
  results: OpResult[],
  verb: string,
  names: Map<number, string>,
): Omit<Toast, 'id'> {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  if (results.length === 0) return { tone: 'ok', text: `No tabs to ${verb.toLowerCase()}.` };
  if (failed.length === 0)
    return {
      tone: 'ok',
      text: `${verb === 'Suspend' ? 'Suspended' : 'Restored'} ${ok} tab${ok === 1 ? '' : 's'}.`,
    };
  return {
    tone: 'error',
    text:
      ok > 0
        ? `${verb === 'Suspend' ? 'Suspended' : 'Restored'} ${ok}; ${failed.length} failed.`
        : `Could not ${verb.toLowerCase()} ${failed.length === 1 ? 'the tab' : `${failed.length} tabs`}.`,
    details: failed
      .slice(0, 4)
      .map((f) => `${names.get(f.tabId) ?? `Tab ${f.tabId}`}: ${f.error ?? 'failed'}`),
  };
}

export function ActionsProvider({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<{ tabs: TabView[]; bulk: boolean } | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(
      () => setToasts((all) => all.filter((x) => x.id !== id)),
      t.tone === 'error' ? 7000 : 3000,
    );
  }, []);

  const track = useCallback(
    async <T,>(ids: number[], fn: () => Promise<T>): Promise<T> => {
      setBusy((s) => new Set([...s, ...ids]));
      try {
        return await fn();
      } finally {
        setBusy((s) => {
          const n = new Set(s);
          ids.forEach((i) => n.delete(i));
          return n;
        });
        onDone();
      }
    },
    [onDone],
  );

  const runSuspend = useCallback(
    async (tabs: TabView[], bulk: boolean, force: boolean) => {
      const ids = tabs.map((t) => t.id);
      const names = new Map(tabs.map((t) => [t.id, t.title]));
      try {
        const res = await track(ids, () =>
          call({
            type: 'suspend',
            tabIds: ids,
            method: bulk ? 'manual-bulk' : 'manual-single',
            force,
          }),
        );
        toast(summarize(res, 'Suspend', names));
      } catch (e) {
        toast({ tone: 'error', text: e instanceof Error ? e.message : 'Suspend failed' });
      }
    },
    [toast, track],
  );

  const suspend = useCallback(
    async (tabs: TabView[], bulk = tabs.length > 1) => {
      const needsOverride = tabs.filter((t) => !t.manualAllowed && t.manualForceAllowed);
      if (needsOverride.length > 0) {
        setConfirm({ tabs, bulk });
        return;
      }
      await runSuspend(tabs, bulk, false);
    },
    [runSuspend],
  );

  const restore = useCallback(
    async (tabs: TabView[]) => {
      const ids = tabs.map((t) => t.id);
      const names = new Map(tabs.map((t) => [t.id, t.title]));
      try {
        toast(
          summarize(
            await track(ids, () => call({ type: 'restore', tabIds: ids })),
            'Restore',
            names,
          ),
        );
      } catch (e) {
        toast({ tone: 'error', text: e instanceof Error ? e.message : 'Restore failed' });
      }
    },
    [toast, track],
  );

  const bulk = useCallback(
    async (kind: 'suspendIdle' | 'suspendAllInactive' | 'restoreAll') => {
      setBulkBusy(kind);
      try {
        const res = await call({ type: kind });
        toast(summarize(res, kind === 'restoreAll' ? 'Restore' : 'Suspend', new Map()));
      } catch (e) {
        toast({ tone: 'error', text: e instanceof Error ? e.message : 'Action failed' });
      } finally {
        setBulkBusy(null);
        onDone();
      }
    },
    [toast, onDone],
  );

  const activate = useCallback(
    async (tab: TabView) => {
      try {
        await call({ type: 'activate', tabId: tab.id });
      } catch (e) {
        toast({ tone: 'error', text: e instanceof Error ? e.message : 'Could not open tab' });
      }
    },
    [toast],
  );

  const value = useMemo(
    () => ({ busy, bulkBusy, suspend, restore, bulk, activate, toast }),
    [busy, bulkBusy, suspend, restore, bulk, activate, toast],
  );

  const overrideTabs = confirm?.tabs.filter((t) => !t.manualAllowed && t.manualForceAllowed) ?? [];
  const reasons = [
    ...new Set(
      overrideTabs.flatMap((t) => t.blockers.filter(isSoftBlocker).map((b) => BLOCKER_LABELS[b])),
    ),
  ];

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          overrideTabs.length === 1
            ? 'Suspend a protected tab?'
            : `Suspend ${overrideTabs.length} protected tabs?`
        }
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c) void runSuspend(c.tabs, c.bulk, true);
              }}
            >
              Suspend anyway
            </Button>
          </>
        }
      >
        <p>
          {overrideTabs.length === 1 ? (
            <strong className="text-fg">{overrideTabs[0]?.title}</strong>
          ) : (
            'These tabs are'
          )}{' '}
          protected by your rules ({reasons.join(', ')}). Suspending unloads the page; it reloads
          when you open it again. Unsaved input on the page may be lost.
        </p>
      </Dialog>
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-2 px-3"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg',
              t.tone === 'ok'
                ? 'border-line bg-surface text-fg'
                : 'border-danger/30 bg-danger-soft text-danger',
            )}
          >
            {t.tone === 'ok' ? (
              <CheckIcon className="mt-0.5 shrink-0 text-accent" />
            ) : (
              <AlertIcon className="mt-0.5 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.text}</p>
              {t.details?.map((d) => (
                <p key={d} className="mt-0.5 truncate opacity-90" title={d}>
                  {d}
                </p>
              ))}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              className="opacity-60 hover:opacity-100"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              <XIcon width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
