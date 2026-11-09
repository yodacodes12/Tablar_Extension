import type { MemoryMeasurement, MemoryProvider, TabMemoryInput } from './types';

/**
 * Qualitative indicator from signals the tabs API actually reports.
 * The only signal with a defensible meaning is "the page is not loaded" (discarded or
 * Chromium's status "unloaded"), which reliably means low. Everything else is Unknown —
 * an open page can use 20 MB or 2 GB and the tabs API cannot tell them apart.
 */
export function estimateTab(tab: TabMemoryInput, now: number): MemoryMeasurement {
  if (tab.discarded || tab.status === 'unloaded') {
    return {
      valueBytes: null,
      source: 'estimated',
      scope: 'tab',
      confidence: 'medium',
      measuredAt: now,
      level: 'low',
      basis: 'Page content is unloaded (discarded), so it holds little memory.',
    };
  }
  return {
    valueBytes: null,
    source: 'estimated',
    scope: 'tab',
    confidence: 'none',
    measuredAt: now,
    level: 'unknown',
    basis: 'This browser does not report per-tab memory for loaded pages.',
  };
}

export class EstimateProvider implements MemoryProvider {
  readonly id = 'estimate';
  readonly label = 'Qualitative estimate';
  constructor(private readonly now: () => number = Date.now) {}
  isSupported(): boolean {
    return true;
  }
  describe(): string {
    return 'Labels unloaded tabs as Low; loaded tabs are Unknown. Never a byte figure.';
  }
  async measureTabs(tabs: readonly TabMemoryInput[]) {
    const now = this.now();
    return new Map(tabs.map((t) => [t.id, estimateTab(t, now)] as const));
  }
}
