import type { MemoryMeasurement, MemoryProvider, TabMemoryInput } from './types';

/** Minimal shape of chrome.processes (Dev channel only, needs the "processes" permission). */
export interface ProcessesApi {
  getProcessIdForTab(tabId: number): Promise<number>;
  getProcessInfo(
    processIds: number | number[],
    includeMemory: boolean,
  ): Promise<
    Record<
      string,
      { id: number; type: string; privateMemory?: number; tasks: { tabId?: number }[] }
    >
  >;
}

export function detectProcessesApi(root: unknown): ProcessesApi | null {
  const api = (root as { processes?: Partial<ProcessesApi> } | undefined)?.processes;
  if (
    api &&
    typeof api.getProcessIdForTab === 'function' &&
    typeof api.getProcessInfo === 'function'
  ) {
    return api as ProcessesApi;
  }
  return null;
}

/**
 * Real renderer-process memory. Process memory is reported with scope "process" and the
 * number of tabs sharing it — the full value is never assigned to a tab as if it were its own.
 */
export class ChromiumProcessesProvider implements MemoryProvider {
  readonly id = 'chromium-processes';
  readonly label = 'Chromium processes API';

  constructor(
    private readonly api: ProcessesApi | null,
    private readonly now: () => number = Date.now,
  ) {}

  isSupported(): boolean {
    return this.api !== null;
  }

  describe(): string {
    return this.api
      ? 'Renderer-process private memory from chrome.processes.'
      : 'chrome.processes is only available on the Chromium Dev channel with the "processes" permission.';
  }

  async measureTabs(tabs: readonly TabMemoryInput[]): Promise<Map<number, MemoryMeasurement>> {
    const out = new Map<number, MemoryMeasurement>();
    if (!this.api) return out;
    const api = this.api;
    const loaded = tabs.filter((t) => !t.discarded);

    const pidByTab = new Map<number, number>();
    await Promise.all(
      loaded.map(async (t) => {
        try {
          const pid = await api.getProcessIdForTab(t.id);
          if (Number.isInteger(pid) && pid >= 0) pidByTab.set(t.id, pid);
        } catch {
          /* tab gone or has no renderer — leave unmeasured */
        }
      }),
    );
    const pids = [...new Set(pidByTab.values())];
    if (pids.length === 0) return out;

    let info: Awaited<ReturnType<ProcessesApi['getProcessInfo']>>;
    try {
      info = await api.getProcessInfo(pids, true);
    } catch {
      return out;
    }
    const at = this.now();
    for (const [tabId, pid] of pidByTab) {
      const proc = info[String(pid)];
      const bytes = proc?.privateMemory;
      if (!proc || typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) continue;
      const tabTasks = new Set(
        proc.tasks.map((task) => task.tabId).filter((id): id is number => typeof id === 'number'),
      );
      const shared = Math.max(1, tabTasks.size);
      out.set(tabId, {
        valueBytes: bytes,
        source: 'actual',
        scope: 'process',
        confidence: 'high',
        measuredAt: at,
        sharedByTabs: shared,
        processId: pid,
        basis:
          shared === 1
            ? 'Private memory of the renderer process hosting only this tab.'
            : `Private memory of a renderer process shared by ${shared} tabs (not divided).`,
      });
    }
    return out;
  }
}
