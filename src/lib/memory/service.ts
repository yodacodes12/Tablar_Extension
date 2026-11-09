import { ChromiumProcessesProvider, detectProcessesApi } from './chromium-processes';
import { EstimateProvider } from './estimate';
import { detectSystemMemoryApi, readSystemMemory, type SystemMemoryApi } from './system-memory';
import {
  UNAVAILABLE,
  type MemoryCapabilities,
  type MemoryMeasurement,
  type MemoryProvider,
  type SystemMemory,
  type TabMemoryInput,
} from './types';

export interface MemoryReport {
  capabilities: MemoryCapabilities;
  tabs: Record<number, MemoryMeasurement>;
  system: SystemMemory | null;
}

const CACHE_MS = 10_000;

/**
 * Picks the best available provider per tab at runtime: actual measurements first,
 * qualitative estimates as the fallback. Results are cached briefly so opening the popup
 * repeatedly does not hammer the browser.
 */
export class MemoryService {
  private cache: { at: number; key: string; report: MemoryReport } | null = null;

  constructor(
    private readonly actual: MemoryProvider[],
    private readonly fallback: MemoryProvider,
    private readonly systemApi: SystemMemoryApi | null,
    private readonly now: () => number = Date.now,
  ) {}

  static fromBrowser(root: unknown): MemoryService {
    return new MemoryService(
      [new ChromiumProcessesProvider(detectProcessesApi(root))],
      new EstimateProvider(),
      detectSystemMemoryApi(root),
    );
  }

  capabilities(enabled: boolean): MemoryCapabilities {
    const all = [...this.actual, this.fallback];
    return {
      enabled,
      perTab: false, // no supported browser exposes true per-tab memory to extensions
      perProcess: enabled && this.actual.some((p) => p.isSupported()),
      system: enabled && this.systemApi !== null,
      providers: [
        ...all.map((p) => ({
          id: p.id,
          label: p.label,
          available: p.isSupported(),
          detail: p.describe(),
        })),
        {
          id: 'system-memory',
          label: 'System memory (chrome.system.memory)',
          available: this.systemApi !== null,
          detail: this.systemApi
            ? 'Whole-computer RAM capacity and availability. Not attributable to tabs.'
            : 'Not available in this browser.',
        },
      ],
    };
  }

  async report(tabs: readonly TabMemoryInput[], enabled: boolean): Promise<MemoryReport> {
    const capabilities = this.capabilities(enabled);
    if (!enabled) {
      const off = UNAVAILABLE('Memory monitoring is turned off in settings.');
      return { capabilities, system: null, tabs: Object.fromEntries(tabs.map((t) => [t.id, off])) };
    }
    const key = tabs.map((t) => `${t.id}:${t.discarded ? 1 : 0}`).join(',');
    const now = this.now();
    if (this.cache && this.cache.key === key && now - this.cache.at < CACHE_MS)
      return this.cache.report;

    const result: Record<number, MemoryMeasurement> = {};
    for (const provider of this.actual) {
      if (!provider.isSupported()) continue;
      const pending = tabs.filter((t) => !result[t.id]);
      if (!pending.length) break;
      try {
        for (const [id, m] of await provider.measureTabs(pending)) result[id] = m;
      } catch {
        /* a failing optional provider must never break the extension */
      }
    }
    const rest = tabs.filter((t) => !result[t.id]);
    if (rest.length) {
      for (const [id, m] of await this.fallback.measureTabs(rest)) result[id] = m;
    }
    const report: MemoryReport = {
      capabilities,
      tabs: result,
      system: await readSystemMemory(this.systemApi, now),
    };
    this.cache = { at: now, key, report };
    return report;
  }

  invalidate(): void {
    this.cache = null;
  }
}
