import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { ThemePreference } from '../core/types';
import type { MemoryReport } from '../memory/service';
import { CHANGED_EVENT, type Snapshot } from '../messages';
import { call } from './client';

/** Live snapshot from the background; refreshes when the background reports a change. */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const queued = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    try {
      setSnapshot(await call({ type: 'getSnapshot' }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tabs');
    } finally {
      inflight.current = false;
      if (queued.current) {
        queued.current = false;
        void refresh();
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onMsg = (msg: unknown) => {
      if (msg && typeof msg === 'object' && (msg as { type?: string }).type === CHANGED_EVENT)
        void refresh();
    };
    browser.runtime.onMessage.addListener(onMsg);
    // Inactivity durations change with time even without events: tick every 30 s while open.
    const tick = setInterval(() => void refresh(), 30_000);
    return () => {
      browser.runtime.onMessage.removeListener(onMsg);
      clearInterval(tick);
    };
  }, [refresh]);

  return { snapshot, error, refresh };
}

/** Memory report, fetched on demand (and when tabs change) — never polled in the background. */
export function useMemory(snapshot: Snapshot | null) {
  const [report, setReport] = useState<MemoryReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = snapshot
    ? `${snapshot.settings.memoryMonitoring}|${snapshot.tabs.map((t) => `${t.id}:${t.discarded ? 1 : 0}`).join(',')}`
    : '';

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    call({ type: 'getMemory' })
      .then((r) => !cancelled && (setReport(r), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Memory unavailable'));
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { report, error };
}

export function useTheme(pref: ThemePreference | undefined) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = pref === 'dark' || ((pref ?? 'system') === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [pref]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
